type Role = 'planner' | 'reviewer' | 'coder' | 'unknown';
type Evaluation = { sessionID: string; action: string; effect: 'allow' | 'ask' | 'deny' };
const readOnlyActions = new Set(['read', 'glob', 'grep', 'question', 'webfetch', 'websearch']);
/** The only actions a coder session may be granted, and only when the operator has enabled the coder in policy. */
export const coderProfile = { allowedActions: ['read', 'glob', 'grep', 'edit', 'shell'] as readonly string[] };
const coderActions = new Set([...readOnlyActions, 'edit', 'shell']);

/** Never grants permission; unrelated sessions and existing denials remain unchanged. */
export async function restrictRoleAction(event: Evaluation, lookup: (sessionID: string) => Promise<Role | null>, coderProfile?: { allowedActions: readonly string[] }): Promise<void> {
  const role = await lookup(event.sessionID);
  if (role === null) return;
  if (role === 'planner' || role === 'reviewer') { if (!readOnlyActions.has(event.action)) event.effect = 'deny'; return; }
  if (role !== 'coder' || !coderActions.has(event.action) || !coderProfile?.allowedActions.includes(event.action)) event.effect = 'deny';
}
