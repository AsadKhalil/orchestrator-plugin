import { plainName } from './delivery.js';
import { serial } from './settings.js';

/**
 * The only place a project authorizes publication. Off by default; a GitHub destination is one remote the user typed, never inferred.
 * `deliverRun` re-checks that the worktree's remote URL still equals `remoteURL`, so a retargeted remote is refused.
 */
export type GithubTarget = { remote: string; remoteURL: string; baseBranch: string; branchPrefix: string };
export type DeliverySettings = { revision: number; publicationEnabled: boolean; github: GithubTarget | null };
type Body = Omit<DeliverySettings, 'revision'>;
type Store = { get(key: string): Promise<unknown>; set(key: string, value: DeliverySettings): Promise<void>; compareAndSet?(key: string, expected: unknown, value: DeliverySettings): Promise<boolean> };
const key = (directory: string) => `delivery/${encodeURIComponent(directory)}`;
const keys = (value: unknown, expected: string) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected;

function validate(value: unknown): Body {
  if (!keys(value, 'github,publicationEnabled') && !keys(value, 'github,publicationEnabled,revision')) throw new Error('Invalid delivery settings');
  const { publicationEnabled, github } = value as Body;
  if (typeof publicationEnabled !== 'boolean') throw new Error('Invalid delivery settings');
  if (github === null) { if (publicationEnabled) throw new Error('Choose a destination before enabling publication'); return { publicationEnabled, github }; }
  if (!keys(github, 'baseBranch,branchPrefix,remote,remoteURL')) throw new Error('Invalid destination');
  const { remote, remoteURL, baseBranch, branchPrefix } = github;
  if (typeof remote !== 'string' || typeof baseBranch !== 'string' || typeof branchPrefix !== 'string' || typeof remoteURL !== 'string') throw new Error('Invalid destination');
  if (!plainName(remote) || !plainName(baseBranch)) throw new Error('Remote and base branch must be plain names');
  if (!branchPrefix.endsWith('/') || !plainName(`${branchPrefix}x`)) throw new Error('Branch prefix must be a plain name ending in /');
  // A URL with embedded credentials would be stored and echoed back; credentials belong to git and gh, not to this setting.
  if (!remoteURL.trim() || remoteURL.length > 2000 || /[\s\u0000-\u001f\u007f]/.test(remoteURL) || /^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(remoteURL)) throw new Error('Remote URL must be a single line without embedded credentials');
  return { publicationEnabled, github: { remote, remoteURL, baseBranch, branchPrefix } };
}
function decode(value: unknown, directory: string): DeliverySettings {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Invalid project');
  if (value === undefined) return { revision: 0, publicationEnabled: false, github: null };
  const saved = value as DeliverySettings;
  if (!saved || typeof saved !== 'object' || !Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error('Invalid delivery revision');
  return { revision: saved.revision, ...validate(saved) };
}
export function getDelivery(store: Pick<Store, 'get'>, directory: string): Promise<DeliverySettings> { return serial(async () => decode(await store.get(key(directory)), directory)); }
export function saveDelivery(store: Store, directory: string, revision: number, input: unknown): Promise<DeliverySettings> {
  return serial(async () => {
    const next = validate({ publicationEnabled: (input as Body)?.publicationEnabled, github: (input as Body)?.github });
    const raw = await store.get(key(directory)), previous = decode(raw, directory);
    if (!Number.isSafeInteger(revision) || revision !== previous.revision || revision === Number.MAX_SAFE_INTEGER) throw new Error('Stale delivery revision');
    const saved: DeliverySettings = { revision: revision + 1, ...next };
    if (typeof store.compareAndSet === 'function') {
      const updated = await store.compareAndSet(key(directory), raw, saved);
      if (updated === false) throw new Error('Stale delivery revision');
      if (updated !== true) throw new Error('Invalid compare-and-set response');
    } else await store.set(key(directory), saved);
    return structuredClone(saved);
  });
}
