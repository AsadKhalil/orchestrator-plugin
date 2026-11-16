import type { RunRepository } from './run-store.js';
import type { createOpenCodeHost } from './host.js';
import { hostVariant } from './types.js';

type Host = Pick<ReturnType<typeof createOpenCodeHost>, 'ownsPrompt' | 'roleForSession' | 'stageModels' | 'readStage'>;
type Input = { runID: string; revision: number; sessionID: string; promptID: string };
/**
 * The host's own refusal of a call to a tool the session does not have. The call never ran, so it cannot have had an effect. Seen on 2.2.7 when
 * global plugin instructions make a model try a `skill` tool; without this a harmless refused call would fail the whole stage.
 */
// shortcut: recognised by the host's error type and message prefix, which 2.2.7 does not document; a host that words it differently makes such a stage fail closed instead.
const isUnavailableTool = (tool: { state: unknown }) => {
  const state = tool.state as { status?: string; error?: { type?: string; message?: string } };
  return state.status === 'error' && state.error?.type === 'tool.execution' && /^No tool named /.test(state.error.message ?? '');
};

/** Read an owned, completed read-only stage; dispatch and accounting are separate. */
async function readStageReply(host: Host, input: Input, role: 'planner' | 'reviewer', pinned?: { providerID: string; id: string; variant: string | null }) {
  if (await host.roleForSession(input.sessionID) !== role) throw new Error('Unowned stage prompt');
  const { expected, current } = await host.stageModels(input.sessionID, input.runID);
  if (!current || current.providerID !== expected.providerID || current.id !== expected.id || hostVariant(current.variant) !== hostVariant(expected.variant)) throw new Error('Stage model changed');
  if (pinned && (expected.providerID !== pinned.providerID || expected.id !== pinned.id || (expected.variant ?? null) !== pinned.variant)) throw new Error('Pinned reviewer model changed');
  const result = await host.readStage(input.sessionID, input.runID);
  if (result.outcome !== 'succeeded') throw new Error('Planner did not complete successfully');
  const messages = result.messages;
  const promptIndexes = messages.flatMap((message, i) => message.type === 'user' && message.id === input.promptID ? [i] : []);
  if (promptIndexes.length !== 1) throw new Error('Planner prompt is absent or ambiguous');
  const prompt = messages[promptIndexes[0]];
  if (prompt.type !== 'user' || !await host.ownsPrompt(input.sessionID, input.runID, input.promptID, prompt.text)) throw new Error('Unowned or changed planner prompt');
  const after = messages.slice(promptIndexes[0] + 1);
  const replies = after.filter(message => message.type === 'assistant');
  if (after.some(message => message.type !== 'assistant' && message.type !== 'idle') || replies.length < 1 || replies.length > 50) throw new Error('Planner response is ambiguous');
  const allowedTools = new Set(['read', 'glob', 'grep', 'question', 'webfetch', 'websearch']);
  for (const [index, message] of replies.entries()) {
    if (message.type !== 'assistant' || message.error || message.model.providerID !== expected.providerID || message.model.id !== expected.id || hostVariant(message.model.variant) !== hostVariant(expected.variant)) throw new Error('Planner response is incomplete or mismatched');
    const tools = message.content.filter(part => part.type === 'tool');
    if (index === replies.length - 1 ? message.finish !== 'stop' || tools.length !== 0 : message.finish !== 'tool-calls' || !tools.length || tools.some(tool => (!allowedTools.has(tool.name) && !isUnavailableTool(tool)) || !['completed', 'error'].includes(tool.state.status))) throw new Error('Planner tool sequence is incomplete or disallowed');
  }
  const reply = replies[replies.length - 1];
  if (reply.type !== 'assistant') throw new Error('Invalid planner response');
  const text = reply.content.filter(part => part.type === 'text').map(part => part.text).join('');
  if (!text.trim()) throw new Error('Planner response is empty');
  return text;
}
export async function savePlannerReply(repo: RunRepository, host: Host, input: Input) {
  const run = await repo.get(input.runID);
  if (run.revision !== input.revision || run.state !== 'planning') throw new Error('Stale planning state');
  return repo.applyPlannerOutput(input.runID, input.revision, await readStageReply(host, input, 'planner'));
}
export async function saveReviewerReply(repo: RunRepository, host: Host, input: Input) {
  const run = await repo.get(input.runID);
  if (run.revision !== input.revision || run.state !== 'reviewing' || !run.review?.pending) throw new Error('Stale review state');
  const text = await readStageReply(host, input, 'reviewer', run.review.reviewer);
  return repo.applyReviewerOutput(input.runID, input.revision, text);
}
