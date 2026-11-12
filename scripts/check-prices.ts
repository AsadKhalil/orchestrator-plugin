// Compares user-proposed per-million rates with the OpenRouter catalog and prints a delta for review. Read-only: it never writes
// files or changes any rate. OpenRouter is a community catalog; official-provider prices must be verified manually.
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatUsd, parseUsd } from '../src/costs.js';
import { parseOpenRouterPrices, refreshOpenRouterPrices } from '../src/prices.js';

export type ProposedRate = { providerID: string; id: string; inputPerMillion: string; outputPerMillion: string; sourceURL: string };
type Side = { proposed: string; catalog: string | null; /** catalog minus proposed, signed; null when the catalog has no usable value. */ delta: string | null };
export type RateDelta = {
  providerID: string; id: string; catalogID: string; status: 'unchanged' | 'changed' | 'missing';
  input: Side; output: Side; note: string | null; sourceURL: string;
};

export const officialPricePages = [
  ['OpenAI', 'https://developers.openai.com/api/docs/pricing'],
  ['Anthropic', 'https://platform.claude.com/docs/en/about-claude/pricing'],
  ['Gemini', 'https://aistudio.google.com/docs/pricing'],
  ['DeepSeek', 'https://api-docs.deepseek.com/quick_start/pricing/'],
] as const;

/** Validates the user's rate file; every rate is an exact decimal string, never a float. */
export function parseRates(value: unknown): ProposedRate[] {
  if (!Array.isArray(value) || !value.length) throw new Error('Rates file must be a non-empty JSON array');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const r = item as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`Rate ${index}: expected an object`);
    for (const key of ['providerID', 'id', 'inputPerMillion', 'outputPerMillion', 'sourceURL'] as const) {
      if (typeof r[key] !== 'string' || !(r[key] as string).trim()) throw new Error(`Rate ${index}: ${key} must be a non-empty string`);
    }
    const rate = r as unknown as ProposedRate;
    try { parseUsd(rate.inputPerMillion); parseUsd(rate.outputPerMillion); } catch { throw new Error(`Rate ${index}: rates must be non-negative decimal strings with at most 12 places`); }
    const key = `${rate.providerID}/${rate.id}`;
    if (seen.has(key)) throw new Error(`Rate ${index}: duplicate ${key}`);
    seen.add(key);
    return { providerID: rate.providerID, id: rate.id, inputPerMillion: rate.inputPerMillion, outputPerMillion: rate.outputPerMillion, sourceURL: rate.sourceURL };
  });
}

function side(proposed: string, catalog: string | null): Side {
  if (catalog === null) return { proposed, catalog, delta: null };
  const diff = parseUsd(catalog) - parseUsd(proposed);
  return { proposed, catalog, delta: diff === 0n ? '0' : `${diff < 0n ? '-' : '+'}${formatUsd(diff < 0n ? -diff : diff)}` };
}

/** Pure comparison against a parsed OpenRouter snapshot. Matches the catalog id `<providerID>/<id>` exactly. */
export function compareRates(rates: readonly ProposedRate[], catalog: ReturnType<typeof parseOpenRouterPrices>): RateDelta[] {
  const models = new Map(catalog.models.map(m => [m.id, m]));
  return rates.map(rate => {
    const catalogID = `${rate.providerID}/${rate.id}`;
    const model = models.get(catalogID);
    const input = side(rate.inputPerMillion, model?.inputPerMillionUsd ?? null), output = side(rate.outputPerMillion, model?.outputPerMillionUsd ?? null);
    const base = { providerID: rate.providerID, id: rate.id, catalogID, input, output, sourceURL: rate.sourceURL };
    if (!model) return { ...base, status: 'missing' as const, note: 'not in the catalog under this exact id' };
    if (input.delta === null || output.delta === null) return { ...base, status: 'missing' as const, note: model.dynamicRouter ? 'router model; the catalog has no fixed price' : 'catalog has no usable base price' };
    const notes = [model.conditional ? 'catalog lists conditional pricing; only base rates compared' : '', model.extraPriceFields.length ? `extra price fields not compared: ${model.extraPriceFields.join(', ')}` : ''].filter(Boolean);
    return { ...base, status: input.delta === '0' && output.delta === '0' ? 'unchanged' as const : 'changed' as const, note: notes.join('; ') || null };
  });
}

export function formatReport(rows: readonly RateDelta[], source: string): string {
  const cell = (s: Side) => s.catalog === null ? `${s.proposed} -> (none)` : `${s.proposed} -> ${s.catalog} (${s.delta})`;
  const lines = [`Catalog: ${source}`, '', ...rows.map(r => `${r.status.toUpperCase().padEnd(9)} ${r.catalogID}\n          input/M  ${cell(r.input)}\n          output/M ${cell(r.output)}${r.note ? `\n          note     ${r.note}` : ''}`)];
  const count = (status: RateDelta['status']) => rows.filter(r => r.status === status).length;
  lines.push('', `Summary: ${count('changed')} changed, ${count('missing')} missing, ${count('unchanged')} unchanged. Nothing was written; no rate was changed.`, '',
    'OpenRouter is a community catalog, not an official price. Verify OpenAI, Anthropic, Gemini and DeepSeek rates manually on the official pages (also check batch, cache, long-context and regional rates):',
    ...officialPricePages.map(([name, url]) => `  ${name}: ${url}`));
  return lines.join('\n');
}

async function readJSON(file: string): Promise<unknown> {
  if ((await stat(file)).size > 4_000_000) throw new Error(`${file} is too large`);
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main(argv: string[]): Promise<void> {
  const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const ratesFile = option('--rates'), catalogFile = option('--catalog');
  if (!ratesFile || argv.includes('--help')) throw new Error('Usage: check-prices --rates <rates.json> [--catalog <openrouter-models.json>]\nRates: [{"providerID","id","inputPerMillion","outputPerMillion","sourceURL"}] as decimal strings. Read-only.');
  const rates = parseRates(await readJSON(ratesFile));
  let snapshot: ReturnType<typeof parseOpenRouterPrices>, source: string;
  if (catalogFile) {
    snapshot = parseOpenRouterPrices(await readJSON(catalogFile), (await stat(catalogFile)).mtime.toISOString());
    source = `${catalogFile} (offline file, last modified ${snapshot.checkedAt}; not live)`;
  } else {
    let stored: unknown;
    const result = await refreshOpenRouterPrices({ get: async () => stored, set: async v => { stored = v; } }, fetch, new Date().toISOString(), true);
    snapshot = result.snapshot;
    source = `${snapshot.source} (${result.status}, checked ${snapshot.checkedAt})`;
  }
  console.log(formatReport(compareRates(rates, snapshot), source));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
