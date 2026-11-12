import { formatUsd, parseUsd } from './costs.js';

type Usage = {
  attemptID: string; revision: number; startedAt: string;
  grossUsd: string | null; creditUsd: string | null; cashUsd: string | null;
  provenance: 'estimated' | 'provider_reported';
  providerID: string; modelID: string; effort: string | null; role: string; projectID: string;
};
type Bucket = { attempts: number; gross: bigint; credit: bigint; cash: bigint; grossUnknown: number; creditUnknown: number; cashUnknown: number; estimated: number; providerReported: number };
const empty = (): Bucket => ({ attempts: 0, gross: 0n, credit: 0n, cash: 0n, grossUnknown: 0, creditUnknown: 0, cashUnknown: 0, estimated: 0, providerReported: 0 });
const identity = (u: Usage) => JSON.stringify([u.startedAt, u.providerID, u.modelID, u.effort, u.role, u.projectID]);
const content = (u: Usage) => JSON.stringify([identity(u), u.grossUsd, u.creditUsd, u.cashUsd, u.provenance]);
function add(bucket: Bucket, item: Usage) {
  bucket.attempts++;
  if (item.grossUsd === null) bucket.grossUnknown++; else bucket.gross += parseUsd(item.grossUsd);
  if (item.creditUsd === null) bucket.creditUnknown++; else bucket.credit += parseUsd(item.creditUsd);
  if (item.cashUsd === null) bucket.cashUnknown++; else bucket.cash += parseUsd(item.cashUsd);
  if (item.provenance === 'estimated') bucket.estimated++; else bucket.providerReported++;
}
function present(bucket: Bucket) {
  return { attempts: bucket.attempts, gross: { knownUsd: formatUsd(bucket.gross), unknownCount: bucket.grossUnknown },
    credit: { knownUsd: formatUsd(bucket.credit), unknownCount: bucket.creditUnknown },
    cash: { knownUsd: formatUsd(bucket.cash), unknownCount: bucket.cashUnknown }, estimated: bucket.estimated, providerReported: bucket.providerReported };
}

/** Aggregate already-normalized attempt records; callers must include all billed attempts. */
export function aggregateUsage(records: readonly Usage[], calendarMonth: string, timeZone: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(calendarMonth)) throw new Error('Invalid calendar month');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const latest = new Map<string, Usage>();
  const revisions = new Map<string, Map<number, string>>();
  for (const u of records) {
    if (!u.attemptID?.trim() || !Number.isSafeInteger(u.revision) || u.revision < 0 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(u.startedAt) ||
      !Number.isFinite(Date.parse(u.startedAt)) || new Date(u.startedAt).toISOString() !== u.startedAt ||
      !u.providerID?.trim() || !u.modelID?.trim() || !u.role?.trim() || !u.projectID?.trim() ||
      !(u.effort === null || (typeof u.effort === 'string' && u.effort.trim())) ||
      !['estimated', 'provider_reported'].includes(u.provenance)) throw new Error('Invalid usage record');
    for (const cost of [u.grossUsd, u.creditUsd, u.cashUsd]) if (cost !== null) parseUsd(cost);
    const previous = latest.get(u.attemptID);
    if (previous && identity(previous) !== identity(u)) throw new Error('Usage identity conflict');
    const seen = revisions.get(u.attemptID) ?? new Map<number, string>();
    const fingerprint = content(u);
    if (seen.has(u.revision) && seen.get(u.revision) !== fingerprint) throw new Error('Usage replay conflict');
    seen.set(u.revision, fingerprint);
    revisions.set(u.attemptID, seen);
    if (!previous || u.revision > previous.revision) latest.set(u.attemptID, u);
  }
  const total = empty();
  const days = new Map<string, Bucket>();
  const groups = { provider: new Map<string, Bucket>(), model: new Map<string, Bucket>(), effort: new Map<string, Bucket>(), role: new Map<string, Bucket>(), project: new Map<string, Bucket>() };
  for (const u of latest.values()) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(u.startedAt)).map(p => [p.type, p.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (!date.startsWith(`${calendarMonth}-`)) continue;
    add(total, u);
    if (!days.has(date)) days.set(date, empty());
    add(days.get(date)!, u);
    for (const [map, key] of [[groups.provider, u.providerID], [groups.model, JSON.stringify([u.providerID, u.modelID])], [groups.effort, u.effort ?? '(not reported)'], [groups.role, u.role], [groups.project, u.projectID]] as const) {
      if (!map.has(key)) map.set(key, empty());
      add(map.get(key)!, u);
    }
  }
  const breakdown = Object.fromEntries(Object.entries(groups).map(([name, map]) => [name, [...map].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, ...present(value) }))]));
  return { calendarMonth, timeZone, total: present(total), days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...present(value) })), breakdown };
}
