// Prints the proof test's table from the results.json files that scripts/bench/run.ts wrote. Several files (runs in different 5-hour
// windows, say) make one table; the first file names the plan, the version and the models. Stopped chats are left out, a task finished
// twice on one side is refused, and only the tasks that every side finished are compared; what was left out is listed under the table.
// Usage: npx tsx scripts/bench/report.ts <folder or results.json> [more ...]
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseUsd } from '../../src/costs.js';
import { commonChats, sideTotals, table, type ChatResult, type Side } from './lib.js';

const paths = process.argv.slice(2);
if (paths.length === 0) throw new Error('Usage: npx tsx scripts/bench/report.ts <folder or results.json> [more ...]');
type Results = { plan: string; opencodeVersion: string; models: Record<string, string>; chats: { task: string; side: Side; passed: boolean; stopped?: string | null; entries: { cost: string; month: string }[] }[] };
const runs = paths.map(path => JSON.parse(readFileSync(statSync(path).isDirectory() ? join(path, 'results.json') : path, 'utf8')) as Results);

const chats: ChatResult[] = runs.flatMap(run => run.chats).map(chat => ({
  task: chat.task, side: chat.side, passed: chat.passed, stopped: chat.stopped ?? null,
  cost: chat.entries.reduce((sum, entry) => sum + parseUsd(entry.cost), 0n),
  month: chat.entries.reduce((sum, entry) => sum + BigInt(entry.month), 0n),
}));
const { kept, dropped } = commonChats(chats);
const tasks = new Set(kept.map(chat => chat.task)).size, first = runs[0];
console.log(`OpenCode Go (${first.plan} plan), OpenCode ${first.opencodeVersion}. Strong: ${first.models.strong}. Cheap: ${first.models.cheap}. Decider: ${first.models.decider}.\n`);
console.log(table(sideTotals(kept)));
console.log(`\n${tasks} task${tasks === 1 ? '' : 's'}, one run each: only large differences mean anything. The limit rows are list cost over Go's published monthly limits, not Go's own meter.`);
if (dropped.length > 0) console.log(`Left out: ${dropped.join('; ')}.`);
