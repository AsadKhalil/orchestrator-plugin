import { usdString } from './costs.js';
import { modes, type Mode } from './relay-store.js';
import { brief, safeHead, MAX_LINES, type DeciderAnswer, type LineAnswer } from './router.js';
import type { ModelChoice } from './settings.js';

// One request to a decision model: which mode fits the text, and, for each mode that has a choice to make, which "use it for" line fits it.
// The decider is given the text, the names and sizes of attached files and the lines. Never file contents, pictures, earlier messages, model names or prices.
// Its requests are not reserved in the budget ledger (the owner, 2026-11-14); what is sent is capped instead. Nothing here may import from `node:`.

export const MAX_CHARS = 4000;
export const TIMEOUT_MS = 5000;
export const MAX_FILE_NAMES = 10;
const MAX_NAME = 80;

export type FileFact = { name: string; bytes: number | null };
export type DecideInput = { kind: 'chat' | 'helper'; text: string; agent: string | null; files: readonly FileFact[]; images: number; lines: Partial<Record<Mode, readonly string[]>> };
export type DecisionsRequest = { model: { providerID: string; id: string; variant?: string }; input: { type: 'text'; text: string }[]; questions: { type: 'choice'; name: string; instructions: string; choices: { value: string; description: string }[] }[] };
export type DecisionsHost = { decisions(request: DecisionsRequest): Promise<unknown> };

/** Text over the limit keeps its first and last half, and is never cut inside a two-unit character. */
export function capText(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const head = safeHead(text, MAX_CHARS / 2);
  let tail = text.slice(-MAX_CHARS / 2);
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
  return `${head}\n[...]\n${tail}`;
}

const flat = (text: string, max: number) => safeHead(text.replace(/[\s\x00-\x1f\x7f]+/g, ' ').trim(), max);
/** Only the last part of a path is sent, so the name of a home folder never leaves the machine. */
const fileName = (name: string) => flat(name.split(/[\\/]/).pop() ?? '', MAX_NAME) || 'file';
const size = (bytes: number | null) => bytes === null ? 'size unknown' : bytes < 1000 ? `${bytes} B` : bytes < 1_000_000 ? `${Math.round(bytes / 1000)} kB` : `${Math.round(bytes / 1_000_000)} MB`;

function describe(input: DecideInput): string {
  const text = capText(input.text);
  if (input.kind === 'helper') return `A task that a model is handing to a helper: "${text}"`;
  const shown = input.files.slice(0, MAX_FILE_NAMES).map(file => `${fileName(file.name)} (${size(file.bytes)})`).join(', '), more = input.files.length - MAX_FILE_NAMES;
  const files = input.files.length ? `${shown}${more > 0 ? ` and ${more} more` : ''}` : 'none';
  return `The person's message: "${text}"\nThe chat is on the agent: ${flat(input.agent ?? '', MAX_NAME) || 'unknown'}. Attached files: ${files}. Attached pictures: ${input.images}.`;
}

const modeQuestion = {
  type: 'choice' as const, name: 'mode',
  instructions: 'Which mode fits the text? Choose execute only when it clearly asks to change, create, fix or run something now. Choose review when it asks to check existing work and report, with nothing to change. Otherwise choose plan.',
  choices: [
    { value: 'plan', description: 'Think, explain, investigate, design or plan. Nothing is changed.' },
    { value: 'execute', description: 'Write, change, create, fix or run something now.' },
    { value: 'review', description: 'Check existing work for mistakes and risks, and report them.' },
  ],
};
const lineQuestion = (mode: Mode, lines: readonly string[]) => ({
  type: 'choice' as const, name: `${mode}_line`,
  instructions: 'Which description of work fits the text best? Choose none when no description fits clearly.',
  choices: [...lines.slice(0, MAX_LINES).map((line, index) => ({ value: String(index + 1), description: line })), { value: 'none', description: 'None of these fits clearly.' }],
});

export function buildDecisionRequest(decider: ModelChoice, input: DecideInput): DecisionsRequest {
  return {
    model: { providerID: decider.providerID, id: decider.id, ...(decider.variant === null ? {} : { variant: decider.variant }) },
    input: [{ type: 'text', text: describe(input) }],
    questions: [{ ...modeQuestion, choices: [...modeQuestion.choices] }, ...modes.flatMap(mode => input.lines[mode]?.length ? [lineQuestion(mode, input.lines[mode])] : [])],
  };
}

type RawAnswer = { type?: unknown; name?: unknown; choice?: unknown; confidence?: unknown; reason?: unknown; message?: unknown };
const sure = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;

/** The mode answer must be exactly right, or there is no answer. A line answer that cannot be used is left out, and the router then falls back by its rule. */
function read(result: unknown, input: DecideInput, ms: number): DeciderAnswer {
  const unreadable: DeciderAnswer = { kind: 'none', reason: "the decider's answer could not be read", ms };
  const answers = (result as { answers?: unknown } | null | undefined)?.answers;
  if (!Array.isArray(answers)) return unreadable;
  const named = (name: string): RawAnswer | undefined => answers.find(item => item !== null && typeof item === 'object' && (item as RawAnswer).name === name);
  const mode = named('mode');
  if (mode?.type === 'error') return { kind: 'none', reason: `the decider gave no answer: ${brief(typeof mode.reason === 'string' && mode.reason.trim() ? mode.reason : mode.message)}`, ms };
  const found = modes.find(item => item === mode?.choice);
  if (mode?.type !== 'choice' || !found || !sure(mode.confidence)) return unreadable;
  const lines: Partial<Record<Mode, LineAnswer>> = {};
  for (const item of modes) {
    const sent = Math.min(input.lines[item]?.length ?? 0, MAX_LINES), line = named(`${item}_line`);
    if (!sent || line?.type !== 'choice' || !sure(line.confidence)) continue;
    if (line.choice === 'none') lines[item] = { index: null, confidence: line.confidence };
    else if (typeof line.choice === 'string' && /^[1-8]$/.test(line.choice) && Number(line.choice) <= sent) lines[item] = { index: Number(line.choice) - 1, confidence: line.confidence };
  }
  return { kind: 'answer', mode: found, confidence: mode.confidence, lines, ms, costUsd: usdString((result as { cost?: unknown }).cost) };
}

export const LATE = Symbol('late');
/** What the work gives, or LATE when it takes longer than `ms`. Work that is given up on cannot be stopped; the race keeps a handler on it, so its late failure is not an unhandled rejection. */
export async function within<T>(work: () => T | Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(work), new Promise<typeof LATE>(done => { timer = setTimeout(() => done(LATE), ms); })]); }
  finally { clearTimeout(timer); }
}

/** Asks the decider once and never throws. A late answer and a late failure are both dropped. */
export async function decide(host: DecisionsHost, decider: ModelChoice | null, input: DecideInput, timeoutMs = TIMEOUT_MS): Promise<DeciderAnswer> {
  if (!decider) return { kind: 'none', reason: 'no decider chosen', ms: 0 };
  const started = Date.now();
  try {
    const result = await within(() => host.decisions(buildDecisionRequest(decider, input)), timeoutMs);
    if (result === LATE) return { kind: 'none', reason: `the decider took longer than ${timeoutMs / 1000} seconds`, ms: Date.now() - started };
    return read(result, input, Date.now() - started);
  } catch (error) {
    return { kind: 'none', reason: `the decider gave no answer: ${brief(error)}`, ms: Date.now() - started };
  }
}
