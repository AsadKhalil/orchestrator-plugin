// Prints the proof test's table from the results.json files that scripts/bench/run.ts wrote. Several files (runs in different 5-hour
// windows, say) make one table; the first file names the plan, the version and the models. Stopped chats are left out, a task finished
// twice on one side is refused, and only the tasks that every side finished are compared; what was left out is listed under the table.
// Usage: npx tsx scripts/bench/report.ts [--sides off,on-one,cheap] <folder or results.json> [more ...]
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { formatUsd, parseUsd, usdString } from '../../src/costs.js';
import { commonChats, sideTotals, table, type ChatResult, type Side } from './lib.js';

const { values: flags, positionals: paths } = parseArgs({ options: { sides: { type: 'string' } }, allowPositionals: true });
if (paths.length === 0) throw new Error('Usage: npx tsx scripts/bench/report.ts [--sides off,on-one,cheap] <folder or results.json> [more ...]');
const only = flags.sides ? new Set(flags.sides.split(',')) : null;
type Results = { plan: string; opencodeVersion: string; models: Record<string, string>; chats: { task: string; side: Side; passed: boolean; stopped?: string | null; entries: { cost: string; month: string; openCodeCost?: number }[] }[] };
const runs = paths.map(path => JSON.parse(readFileSync(statSync(path).isDirectory() ? join(path, 'results.json') : path, 'utf8')) as Results);

const raw = runs.flatMap(run => run.chats).filter(chat => !only || only.has(chat.side));
const recorded = new Map(raw.map(chat => [`${chat.task}|${chat.side}`, chat.entries.reduce((sum, entry) => sum + parseUsd(usdString(entry.openCodeCost ?? 0) ?? '0'), 0n)]));
const chats: ChatResult[] = raw.map(chat => ({
  task: chat.task, side: chat.side, passed: chat.passed, stopped: chat.stopped ?? null,
  cost: chat.entries.reduce((sum, entry) => sum + parseUsd(entry.cost), 0n),
  month: chat.entries.reduce((sum, entry) => sum + BigInt(entry.month), 0n),
}));
const { kept, dropped } = commonChats(chats);
const tasks = new Set(kept.map(chat => chat.task)).size, first = runs[0], onGo = first.plan !== 'ollama';
const where = onGo ? `OpenCode Go (${first.plan} plan)` : 'Ollama Cloud, billed per token';
console.log(`${where}, OpenCode ${first.opencodeVersion}. Strong: ${first.models.strong}. Cheap: ${first.models.cheap}. Decider: ${first.models.decider}.\n`);
console.log(table(sideTotals(kept), { limits: onGo }));
const sample = `${tasks} task${tasks === 1 ? '' : 's'}, one run each: only large differences mean anything.`;
if (onGo) console.log(`\n${sample} The limit rows are list cost over Go's published monthly limits, not Go's own meter.`);
else {
  const total = kept.reduce((sum, chat) => sum + (recorded.get(`${chat.task}|${chat.side}`) ?? 0n), 0n);
  console.log(`\n${sample} OpenCode recorded $${formatUsd(total)} for these chats, against $${formatUsd(kept.reduce((sum, chat) => sum + chat.cost, 0n))} at list price.`);
}
if (dropped.length > 0) console.log(`Left out: ${dropped.join('; ')}.`);
