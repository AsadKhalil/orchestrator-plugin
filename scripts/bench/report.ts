// Prints the proof test's table from the results.json files that scripts/bench/run.ts wrote. Several files (runs in different 5-hour
// windows, say) make one table; the first file names the plan, the version and the models.
// Usage: npx tsx scripts/bench/report.ts <folder or results.json> [more ...]
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseUsd } from '../../src/costs.js';
import { sideTotals, table, type ChatResult, type Side } from './lib.js';

const paths = process.argv.slice(2);
if (paths.length === 0) throw new Error('Usage: npx tsx scripts/bench/report.ts <folder or results.json> [more ...]');
type Results = { plan: string; opencodeVersion: string; models: Record<string, string>; stoppedBecause: string | null; chats: { task: string; side: Side; passed: boolean; entries: { cost: string; month: string }[] }[] };
const runs = paths.map(path => JSON.parse(readFileSync(statSync(path).isDirectory() ? join(path, 'results.json') : path, 'utf8')) as Results);
const results = { ...runs[0], chats: runs.flatMap(run => run.chats), stoppedBecause: runs.map(run => run.stoppedBecause).filter(Boolean).join('; ') || null };

const chats: ChatResult[] = results.chats.map(chat => ({
  task: chat.task, side: chat.side, passed: chat.passed,
  cost: chat.entries.reduce((sum, entry) => sum + parseUsd(entry.cost), 0n),
  month: chat.entries.reduce((sum, entry) => sum + BigInt(entry.month), 0n),
}));
const tasks = new Set(chats.map(chat => chat.task)).size;
console.log(`OpenCode Go (${results.plan} plan), OpenCode ${results.opencodeVersion}. Strong: ${results.models.strong}. Cheap: ${results.models.cheap}. Decider: ${results.models.decider}.\n`);
console.log(table(sideTotals(chats)));
console.log(`\n${tasks} task${tasks === 1 ? '' : 's'}, 1 run: only large differences mean anything.${results.stoppedBecause ? ` The run stopped early: ${results.stoppedBecause}.` : ''}`);
