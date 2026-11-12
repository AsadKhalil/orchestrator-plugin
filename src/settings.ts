import { parseUsd, formatUsd } from './costs.js';
import type { RateCard, Evidence, BillingRoute } from './types.js';
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
export function serial<T>(task: () => Promise<T>): Promise<T> {
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

// ---- Policy: user-entered route facts the spending guard and recommender rely on. Nothing here is fetched or guessed. ----

export type Route = { providerID: string; id: string; variant: string | null; vendor: string; canonicalID: string; modelVersion: string; rate: RateCard };
export type Policy = { revision: number; maxOutputTokens: number; coderEnabled: boolean; routes: Route[] };
type PolicyStore = { get(key: string): Promise<unknown>; set(key: string, value: Policy): Promise<void>; compareAndSet?(key: string, expected: unknown, value: Policy): Promise<boolean> };
const policyKey = (directory: string) => `policy/${encodeURIComponent(directory)}`;
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const strictKeys = (value: unknown, keys: string) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys;
const optionalUsd = (value: unknown) => value === null ? null : (typeof value === 'string' && value.length <= 40 ? formatUsd(parseUsd(value)) : (() => { throw new Error('Invalid rate'); })());
const requiredUsd = (value: unknown) => { const v = optionalUsd(value); if (v === null) throw new Error('Invalid rate'); return v; };
function validateEvidence(value: unknown): Evidence {
  if (!strictKeys(value, 'checkedAt,kind,sourceURL,verified')) throw new Error('Invalid rate evidence');
  const e = value as Evidence;
  let url: URL; try { url = new URL(e.sourceURL); } catch { throw new Error('Invalid rate evidence'); }
  if (url.protocol !== 'https:' || !text(e.sourceURL, 2000) || !['official', 'catalog', 'provider_reported', 'user_entered'].includes(e.kind) || typeof e.verified !== 'boolean' || !text(e.checkedAt, 40) || Number.isNaN(Date.parse(e.checkedAt))) throw new Error('Invalid rate evidence');
  return { sourceURL: e.sourceURL, checkedAt: e.checkedAt, kind: e.kind, verified: e.verified };
}
function validateRate(value: unknown): RateCard {
  if (!strictKeys(value, 'billing,cacheReadPerMillion,cacheWritePerMillion,conditions,evidence,inputPerMillion,interactive,outputPerMillion,serviceTier')) throw new Error('Invalid rate card');
  const r = value as RateCard;
  if (!['metered_api', 'subscription', 'local'].includes(r.billing) || !text(r.serviceTier, 100) || typeof r.interactive !== 'boolean' || !Array.isArray(r.conditions) || r.conditions.length > 20 || !r.conditions.every(c => text(c, 300))) throw new Error('Invalid rate card');
  return { inputPerMillion: requiredUsd(r.inputPerMillion), outputPerMillion: requiredUsd(r.outputPerMillion), cacheReadPerMillion: optionalUsd(r.cacheReadPerMillion), cacheWritePerMillion: optionalUsd(r.cacheWritePerMillion), billing: r.billing as BillingRoute, serviceTier: r.serviceTier, interactive: r.interactive, conditions: [...r.conditions], evidence: validateEvidence(r.evidence) };
}
function validatePolicy(value: unknown): Omit<Policy, 'revision'> {
  if (!strictKeys(value, 'coderEnabled,maxOutputTokens,revision,routes') && !strictKeys(value, 'coderEnabled,maxOutputTokens,routes')) throw new Error('Invalid policy');
  const p = value as Policy;
  if (typeof p.coderEnabled !== 'boolean' || !Number.isSafeInteger(p.maxOutputTokens) || p.maxOutputTokens < 1 || p.maxOutputTokens > 10_000_000 || !Array.isArray(p.routes) || p.routes.length > 200) throw new Error('Invalid policy');
  const seen = new Set<string>();
  const routes = p.routes.map(route => {
    if (!strictKeys(route, 'canonicalID,id,modelVersion,providerID,rate,variant,vendor')) throw new Error('Invalid route');
    if (!text(route.providerID) || !text(route.id) || !text(route.vendor) || !text(route.canonicalID) || !text(route.modelVersion) || !(route.variant === null || text(route.variant))) throw new Error('Invalid route');
    const identity = JSON.stringify([route.providerID, route.id, route.variant]); if (seen.has(identity)) throw new Error('Duplicate route');
    seen.add(identity);
    return { providerID: route.providerID, id: route.id, variant: route.variant, vendor: route.vendor, canonicalID: route.canonicalID, modelVersion: route.modelVersion, rate: validateRate(route.rate) };
  });
  return { coderEnabled: p.coderEnabled, maxOutputTokens: p.maxOutputTokens, routes };
}
function decodePolicy(value: unknown, directory: string): Policy {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Invalid project');
  if (value === undefined) return { revision: 0, maxOutputTokens: 8192, coderEnabled: false, routes: [] };
  const saved = value as Policy;
  if (!saved || typeof saved !== 'object' || !Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error('Invalid policy revision');
  return { revision: saved.revision, ...validatePolicy(saved) };
}
export function getPolicy(store: Pick<PolicyStore, 'get'>, directory: string): Promise<Policy> { return serial(async () => decodePolicy(await store.get(policyKey(directory)), directory)); }
export function savePolicy(store: PolicyStore, directory: string, revision: number, input: unknown): Promise<Policy> {
  return serial(async () => {
    const next = validatePolicy({ coderEnabled: (input as Policy)?.coderEnabled, maxOutputTokens: (input as Policy)?.maxOutputTokens, routes: (input as Policy)?.routes });
    const raw = await store.get(policyKey(directory)), previous = decodePolicy(raw, directory);
    if (!Number.isSafeInteger(revision) || revision !== previous.revision || revision === Number.MAX_SAFE_INTEGER) throw new Error('Stale policy revision');
    const saved: Policy = { revision: revision + 1, ...next };
    if (typeof store.compareAndSet === 'function') {
      const updated = await store.compareAndSet(policyKey(directory), raw, saved);
      if (updated === false) throw new Error('Stale policy revision');
      if (updated !== true) throw new Error('Invalid compare-and-set response');
    } else await store.set(policyKey(directory), saved);
    return structuredClone(saved);
  });
}
