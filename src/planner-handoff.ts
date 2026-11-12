import type { RunRepository } from './run-store.js';
import type { createOpenCodeHost } from './host.js';

type Host = Pick<ReturnType<typeof createOpenCodeHost>, 'ownsPrompt' | 'roleForSession' | 'stageModels' | 'readStage'>;
type Input = { runID: string; revision: number; sessionID: string; promptID: string };
/** Read an owned, completed read-only stage; dispatch and accounting are separate. */
async function readStageReply(host: Host, input: Input, role: 'planner' | 'reviewer', pinned?: { providerID: string; id: string; variant: string | null }) {
  if (await host.roleForSession(input.sessionID) !== role) throw new Error('Unowned stage prompt');
  const { expected, current } = await host.stageModels(input.sessionID, input.runID);
  if (!current || current.providerID !== expected.providerID || current.id !== expected.id || (current.variant ?? null) !== (expected.variant ?? null)) throw new Error('Stage model changed');
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
    if (message.type !== 'assistant' || message.error || message.model.providerID !== expected.providerID || message.model.id !== expected.id || (message.model.variant ?? null) !== (expected.variant ?? null)) throw new Error('Planner response is incomplete or mismatched');
    const tools = message.content.filter(part => part.type === 'tool');
    if (index === replies.length - 1 ? message.finish !== 'stop' || tools.length !== 0 : message.finish !== 'tool-calls' || !tools.length || tools.some(tool => !allowedTools.has(tool.name) || !['completed', 'error'].includes(tool.state.status))) throw new Error('Planner tool sequence is incomplete or disallowed');
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
