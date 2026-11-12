export type ModelChoice = { providerID: string; id: string; variant: string | null };
export type Roles = { planner: ModelChoice[]; coder: ModelChoice[]; reviewer: ModelChoice[] };
type Settings = { revision: number; roles: Roles };
type Store = { get(key: string): Promise<unknown>; set(key: string, value: Settings): Promise<void>; compareAndSet?(key: string, expected: unknown, value: Settings): Promise<boolean> };
type Model = { providerID: string; id: string; enabled: boolean; status: string; variants: readonly string[] };
const roleNames = ['planner', 'coder', 'reviewer'] as const;
const key = (directory: string) => `model-selections/${encodeURIComponent(directory)}`;
const id = (choice: ModelChoice) => JSON.stringify([choice.providerID, choice.id, choice.variant]);
// shortcut: this serializes one loaded module; use host-wide transactions before using selections for execution.
let queue: Promise<void> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task); queue = result.then(() => undefined, () => undefined); return result;
}
function validateRoles(value: unknown): Roles {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'coder,planner,reviewer') throw new Error('Invalid roles');
  const roles = value as Roles;
  for (const role of roleNames) {
    if (!Array.isArray(roles[role])) throw new Error('Invalid role choices');
    const seen = new Set<string>();
    for (const choice of roles[role]) {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice) || Object.keys(choice).sort().join(',') !== 'id,providerID,variant' || typeof choice.providerID !== 'string' || !choice.providerID.trim() || typeof choice.id !== 'string' || !choice.id.trim() || !(choice.variant === null || (typeof choice.variant === 'string' && choice.variant.trim()))) throw new Error('Invalid model choice');
      const identity = id(choice); if (seen.has(identity)) throw new Error('Duplicate model choice'); seen.add(identity);
    }
  }
  return structuredClone(roles);
}
function decode(value: unknown, directory: string): Settings {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Invalid project');
  if (value === undefined) return { revision: 0, roles: { planner: [], coder: [], reviewer: [] } };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings');
  const saved = value as Settings;
  if (!Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error('Invalid settings revision');
  return { revision: saved.revision, roles: validateRoles(saved.roles) };
}
export function getSelections(store: Store, directory: string): Promise<Settings> { return serial(async () => decode(await store.get(key(directory)), directory)); }
export function saveSelections(store: Store, directory: string, revision: number, input: Roles, models: readonly Model[]): Promise<Settings> {
  return serial(async () => {
    const roles = validateRoles(input), raw = await store.get(key(directory)), previous = decode(raw, directory);
    if (!Number.isSafeInteger(revision) || revision !== previous.revision || revision === Number.MAX_SAFE_INTEGER) throw new Error('Stale settings revision');
    for (const role of roleNames) for (const choice of roles[role]) {
      if (previous.roles[role].some(old => id(old) === id(choice))) continue;
      const model = models.find(m => m.providerID === choice.providerID && m.id === choice.id);
      if (!model || !model.enabled || model.status === 'deprecated' || (choice.variant !== null && !model.variants.includes(choice.variant))) throw new Error('Selected model or variant is unavailable');
    }
    const saved = { revision: revision + 1, roles };
    if (typeof store.compareAndSet === 'function') {
      const updated = await store.compareAndSet(key(directory), raw, saved);
      if (updated === false) throw new Error('Stale settings revision');
      if (updated !== true) throw new Error('Invalid compare-and-set response');
    } else await store.set(key(directory), saved);
    return structuredClone(saved);
  });
}
