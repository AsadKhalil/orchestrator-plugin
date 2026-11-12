import { newRun, validateRun } from './run.js';

type ShellResult = { status: 'passed' | 'failed' | 'unknown'; exitCode: number | null; output: string; truncated: boolean };
type CommandResult = ShellResult & { command: string };
type Report = { diffHash: string; status: 'passed' | 'failed' | 'unknown' | 'timed_out' | 'stale'; commands: CommandResult[] };
const outputLimit = 16_384;

/** Recognizes only the matching, completed result shape observed from OpenCode's shell tool. */
export function normalizeShellResult(value: unknown): ShellResult {
  const unknown: ShellResult = { status: 'unknown', exitCode: null, output: '', truncated: false };
  if (!value || typeof value !== 'object') return unknown;
  const result = value as { output?: Record<string, unknown>; metadata?: Record<string, unknown> };
  const output = result.output, meta = result.metadata;
  if (!output || !meta || output.status !== 'completed' || meta.status !== 'completed' || typeof output.output !== 'string' || typeof output.truncated !== 'boolean' || meta.truncated !== output.truncated || !Number.isSafeInteger(output.exit) || (output.exit as number) < 0 || (output.exit as number) > 255 || meta.exit !== output.exit) return unknown;
  const bytes = Buffer.from(output.output, 'utf8');
  return { status: output.exit === 0 ? 'passed' : 'failed', exitCode: output.exit as number, output: bytes.subarray(0, outputLimit).toString('utf8'), truncated: output.truncated || bytes.length > outputLimit };
}

/** The host must provide an authorized executor and a reliable whole-worktree diff identity. */
export async function runApprovedValidation(run: ReturnType<typeof newRun>, input: { diffHash: string; timeoutMs: number; currentDiff(): Promise<string>; execute(command: string, signal: AbortSignal): Promise<unknown> }): Promise<Report> {
  const checked = validateRun(run);
  if (!['implementing', 'repairing'].includes(checked.state) || !checked.plan) throw new Error('Approved implementation state required');
  if (typeof input.diffHash !== 'string' || !input.diffHash.trim() || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 3_600_000) throw new Error('Invalid validation request');
  const report: Report = { diffHash: input.diffHash, status: 'unknown', commands: [] };
  for (const command of checked.plan.validationCommands) {
    try { if (await input.currentDiff() !== input.diffHash) return { ...report, status: 'stale' }; }
    catch { return report; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol('timeout');
    const deadline = new Promise<typeof timedOut>(resolve => { timer = setTimeout(() => { resolve(timedOut); controller.abort(); }, input.timeoutMs); });
    let value: unknown;
    try { value = await Promise.race([input.execute(command, controller.signal), deadline]); }
    catch { return report; }
    finally { if (timer) clearTimeout(timer); }
    if (value === timedOut) return { ...report, status: 'timed_out' };
    const result = normalizeShellResult(value); report.commands.push({ command, ...result });
    try { if (await input.currentDiff() !== input.diffHash) return { ...report, status: 'stale' }; }
    catch { return report; }
    if (result.status !== 'passed') return { ...report, status: result.status };
  }
  return { ...report, status: 'passed' };
}
