import { Schema } from 'effect';
import { Session } from '@opencode/schema/session';
import type { Plugin } from '@opencode/plugin';
import { aggregateUsage } from './usage.js';
import { formatUsd, parseUsd } from './costs.js';

type Row = Parameters<typeof aggregateUsage>[0][number];
const prefix = 'owned-session/';
// shortcut: only the first 100 sessions are scanned; use a durable usage ledger for complete reporting.
const maxSessions = 100;
const maxReadMs = 10_000;
function hostEstimate(value: unknown): string | null {
  // Zero can mean unknown pricing, an allowance, or a free route; do not present it as free.
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000) return null;
  const decimal = value.toFixed(12);
  if (Number(decimal) !== value) return null;
  try { return formatUsd(parseUsd(decimal)); } catch { return null; }
}

/** Partial, read-only observations from current session context; not a billing ledger. */
export async function readObservedUsage(context: Pick<Plugin.Context, 'location' | 'storage' | 'session'>, month: string, timeZone: string) {
  aggregateUsage([], month, timeZone);
  const entries: { key: string; value: unknown }[] = [];
  let after: string | undefined; const cursors = new Set<string>(); let truncated = false;
  do {
    const page = await context.storage.scan({ prefix, after });
    if (!Array.isArray(page.entries)) throw new Error('Invalid ownership scan');
    for (const entry of page.entries) {
      if (entries.length >= maxSessions) { truncated = true; break; }
      entries.push(entry);
    }
    if (truncated) break;
    if (page.next && cursors.has(page.next)) throw new Error('Invalid ownership cursor');
    if (page.next) cursors.add(page.next); after = page.next;
  } while (after);
  const started = Date.now();
  const rows: Row[] = []; let unavailableSessions = 0, skippedMessages = 0, projectSessions = 0;
  for (const entry of entries) {
    if (Date.now() - started >= maxReadMs) { truncated = true; break; }
    if (!entry.key.startsWith(prefix) || typeof entry.value !== 'string' || !entry.value.trim()) { unavailableSessions++; continue; }
    let sessionID: string;
    try { sessionID = decodeURIComponent(entry.key.slice(prefix.length)); Schema.decodeUnknownSync(Session.ID)(sessionID); }
    catch { unavailableSessions++; continue; }
    try {
      const session = await context.session.get({ sessionID: Schema.decodeUnknownSync(Session.ID)(sessionID) }, { signal: AbortSignal.timeout(Math.min(2000, Math.max(1, maxReadMs - (Date.now() - started)))) });
      if (session.location.directory !== context.location.directory) continue;
      const role = await context.storage.get(`owned-role/${encodeURIComponent(sessionID)}`);
      if (role !== 'planner' && role !== 'coder' && role !== 'reviewer') { unavailableSessions++; continue; }
      const messages = await context.session.context({ sessionID: Schema.decodeUnknownSync(Session.ID)(sessionID) }, { signal: AbortSignal.timeout(Math.min(2000, Math.max(1, maxReadMs - (Date.now() - started)))) });
      projectSessions++;
      for (const message of messages) {
        if (message.type !== 'assistant') continue;
        if (!message.id || !message.model?.providerID || !message.model.id || !Number.isSafeInteger(message.time?.created)) { skippedMessages++; continue; }
        let startedAt: string; try { startedAt = new Date(message.time.created).toISOString(); } catch { skippedMessages++; continue; }
        rows.push({ attemptID: JSON.stringify([sessionID, message.id]), revision: 0, startedAt, grossUsd: hostEstimate(message.cost), creditUsd: null, cashUsd: null, provenance: 'estimated', providerID: message.model.providerID, modelID: message.model.id, effort: typeof message.model.variant === 'string' && message.model.variant.trim() ? message.model.variant : null, role, projectID: context.location.directory });
      }
    } catch { unavailableSessions++; }
  }
  return { summary: aggregateUsage(rows, month, timeZone), coverage: { complete: false as const, projectSessions, unavailableSessions, skippedMessages, truncated, timestamp: 'assistant_message_created' as const } };
}
