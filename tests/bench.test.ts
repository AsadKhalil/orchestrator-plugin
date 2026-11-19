import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProject, permissionAnswer, resetFolder, TEST_CONFIG } from '../scripts/bench/folder.js';
import { formatUsd, parseUsd } from '../src/costs.js';
import { commonChats, limitShare, monthShare, nextFits, requestCost, sideTotals, stopReason, table, type ChatResult, type Cost } from '../scripts/bench/lib.js';
import { restoreSettings } from '../scripts/bench/relay-settings.js';

// The proof test's exercises (scripts/bench/tasks): Exercism's Python exercises, as Aider's polyglot benchmark chose them.
const tasks = fileURLToPath(new URL('../scripts/bench/tasks/', import.meta.url));
const exercises = ['affine-cipher', 'variable-length-quantity', 'wordy', 'book-store', 'bowling', 'forth'];

test('the six exercises are complete and hold no solution', () => {
  for (const exercise of exercises) {
    const folder = `${tasks}${exercise}`, module = exercise.replaceAll('-', '_');
    assert.ok(existsSync(folder), `${exercise} is missing`);
    assert.ok(readFileSync(`${folder}/instructions.md`, 'utf8').trim().length > 0, `${exercise}: instructions.md is empty`);
    const files = readdirSync(folder);
    assert.deepEqual(files.filter(name => name.endsWith('.py')).sort(), [`${module}.py`, `${module}_test.py`], `${exercise}: one stub and its tests`);
    assert.ok(!files.includes('example.py') && !files.includes('.meta'), `${exercise} holds a solution`);
  }
});

// Kimi K3.1 Pro on OpenCode Go, as Go's model list priced it on 18 Nov 2026: $2 in, $10 out, $0.20 read from the cache, no write price.
const kimi: Cost = { inputPerMillion: '2', outputPerMillion: '10', cacheReadPerMillion: '0.2', cacheWritePerMillion: null, steps: [] };

test('a request costs its new, cached and written tokens and its output at the list price', () => {
  const cost = requestCost({ input: 1000, output: 500, reasoning: 0, cache: { read: 8000, write: 0 } }, kimi);
  assert.equal(cost, 8_600_000_000n);
  assert.equal(formatUsd(cost), '0.0086');
});

test('a request above a price step is priced by that step', () => {
  const stepped: Cost = { ...kimi, steps: [{ above: 200_000, inputPerMillion: '4', outputPerMillion: '20', cacheReadPerMillion: '0.4', cacheWritePerMillion: null }] };
  assert.equal(requestCost({ input: 250_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, stepped), parseUsd('1'));
});

test('a share of Go\'s limits follows its docs: $1.50 on a model with a $15 monthly limit is 10% of the month', () => {
  assert.deepEqual(limitShare(parseUsd('1.5'), '15'), { month: '10.0', fiveHour: '50.0', week: '20.0' });
  assert.equal(limitShare(parseUsd('6'), '60').month, '10.0');
});

const chat = (task: string, side: ChatResult['side'], passed: boolean, usd: string, stopped: string | null = null): ChatResult =>
  ({ task, side, passed, cost: parseUsd(usd), month: monthShare(parseUsd(usd), '15'), stopped });

test('the table shows tasks passed and the saving against Off', () => {
  const printed = table(sideTotals([chat('wordy', 'off', true, '0.1'), chat('wordy', 'on-one', false, '0.04')]));
  assert.ok(printed.includes('| Tasks passed | 1 of 1 | 0 of 1 |'), printed);
  assert.ok(printed.includes('| Saved, against Off | - | 60.0% (passed fewer) |'), printed);
});

test('a side that used two models counts each against its own monthly limit, and the limit rows say they are estimates', () => {
  // $1.50 on a model with a $15 limit and $6 on one with a $60 limit are 10% of the month each (Go's docs), so 20% together.
  const month = monthShare(parseUsd('1.5'), '15') + monthShare(parseUsd('6'), '60');
  const printed = table(sideTotals([{ task: 'wordy', side: 'on-one', passed: true, cost: parseUsd('7.5'), month }]));
  assert.ok(printed.includes('| 5-hour limit used (estimated) | 100.0% |'), printed);
  assert.ok(printed.includes('| Weekly limit used (estimated) | 40.0% |'), printed);
});

test('a side that passed as many tasks as Off shows its saving unmarked', () => {
  const printed = table(sideTotals([chat('wordy', 'off', true, '0.1'), chat('wordy', 'cheap', true, '0.01')]));
  assert.ok(printed.includes('| Saved, against Off | - | 90.0% |'), printed);
});

test('a table for a provider billed per token, such as Ollama Cloud, has no limit rows', () => {
  const printed = table(sideTotals([chat('wordy', 'off', true, '0.1'), chat('wordy', 'on-one', true, '0.04')]), { limits: false });
  assert.ok(printed.includes('| Cost at list price | $0.1000 | $0.0400 |'), printed);
  assert.ok(printed.includes('| Saved, against Off | - | 60.0% |'), printed);
  assert.doesNotMatch(printed, /limit used/);
});

test('one more task starts only when it fits the limit, taken to cost as much as the dearest task so far, so no task is left half run', () => {
  assert.equal(nextFits([], parseUsd('2')), true);
  assert.equal(nextFits([parseUsd('0.5'), parseUsd('0.7')], parseUsd('2')), true);    // 1.2 spent, 0.7 more: 1.9
  assert.equal(nextFits([parseUsd('0.5'), parseUsd('0.8')], parseUsd('2')), false);   // 1.3 spent, 0.8 more: 2.1
  assert.equal(nextFits([parseUsd('1'), parseUsd('0.5')], parseUsd('2.5')), true);    // exactly at the limit still fits
});

test('a stopped chat is left out, and the table compares only the tasks every side finished', () => {
  const { kept, dropped } = commonChats([
    chat('wordy', 'off', true, '0.1'), chat('wordy', 'on-one', true, '0.05'),
    chat('bowling', 'off', true, '0.1'), chat('bowling', 'on-one', false, '0.01', 'no answer within 15 minutes'),
  ]);
  assert.deepEqual(kept.map(item => `${item.task} ${item.side}`), ['wordy off', 'wordy on-one']);
  assert.deepEqual(dropped, ['bowling on-one (stopped: no answer within 15 minutes)', 'bowling (not finished on on-one)']);
});

test('a task that ran twice on one side is refused rather than counted twice', () => {
  assert.throws(() => commonChats([chat('wordy', 'off', true, '0.1'), chat('wordy', 'off', false, '0.1')]), /wordy ran twice on off/);
});

test('a run does not stop when a request failed and the reply went on, as after a dropped connection that OpenCode retried', () => {
  const ok = { model: 'opencode-go/kimi-k3.1-pro', error: null, priced: true }, dropped = { ...ok, error: { type: 'provider.transport', message: 'Connection lost while reading the response' } };
  assert.equal(stopReason([ok, dropped, ok]), null);
  assert.match(stopReason([ok, dropped]) ?? '', /a request failed: .*Connection lost/);
});

test('a run stops at a failed request, or at a request on a model with no price', () => {
  assert.equal(stopReason([{ model: 'opencode-go/kimi-k3.1-pro', error: null, priced: true }]), null);
  assert.match(stopReason([{ model: 'opencode-go/kimi-k3.1-pro', error: { type: 'rate_limit', message: 'limit reached' }, priced: true }]) ?? '', /a request failed: .*limit reached/);
  assert.match(stopReason([{ model: 'other/model', error: null, priced: false }]) ?? '', /other\/model has no list price/);
});

// The test folder is emptied before each chat. Only a folder whose opencode.json is the test's own may be emptied, and that file stays.
test('resetting the test folder keeps opencode.json, removes the rest and writes the task files', () => {
  const folder = mkdtempSync(join(tmpdir(), 'relay-bench-test-')), config = JSON.stringify(TEST_CONFIG, null, 2);
  try {
    writeFileSync(join(folder, 'opencode.json'), config);
    writeFileSync(join(folder, 'left_over.py'), 'x = 1');
    mkdirSync(join(folder, 'sub')); writeFileSync(join(folder, 'sub', 'b.txt'), 'b');
    resetFolder(folder, { 'instructions.md': '# Wordy', 'wordy.py': 'def answer(question):\n    pass\n' });
    assert.deepEqual(readdirSync(folder).sort(), ['instructions.md', 'opencode.json', 'wordy.py']);
    assert.equal(readFileSync(join(folder, 'opencode.json'), 'utf8'), config);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('a folder without the test\'s opencode.json is never emptied', () => {
  const folder = mkdtempSync(join(tmpdir(), 'relay-bench-test-'));
  try {
    writeFileSync(join(folder, 'precious.py'), 'keep me');
    assert.throws(() => resetFolder(folder, { 'wordy.py': '' }), /opencode\.json/);
    assert.deepEqual(readdirSync(folder), ['precious.py']);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('a folder whose opencode.json is not the test\'s own, such as a real project or one a model edited, is never emptied', () => {
  const folder = mkdtempSync(join(tmpdir(), 'relay-bench-test-'));
  try {
    writeFileSync(join(folder, 'opencode.json'), '{"permissions":[]}');
    writeFileSync(join(folder, 'precious.py'), 'keep me');
    assert.throws(() => resetFolder(folder, { 'wordy.py': '' }), /not the test's own/);
    assert.deepEqual(readdirSync(folder).sort(), ['opencode.json', 'precious.py']);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('a permission is allowed once, and only for reading or editing inside the test folder, never its opencode.json', () => {
  const folder = join(tmpdir(), 'relay-bench');
  assert.equal(permissionAnswer({ action: 'edit', resources: [join(folder, 'wordy.py')] }, folder), 'once');
  assert.equal(permissionAnswer({ action: 'read', resources: ['wordy.py'] }, folder), 'once');
  assert.equal(permissionAnswer({ action: 'edit', resources: [join(folder, '..', 'plugin', 'src', 'index.ts')] }, folder), 'reject');
  assert.equal(permissionAnswer({ action: 'edit', resources: ['../outside.py'] }, folder), 'reject');
  assert.equal(permissionAnswer({ action: 'edit', resources: [] }, folder), 'reject');
  assert.equal(permissionAnswer({ action: 'shell', resources: ['python wordy.py'] }, folder), 'reject');
  assert.equal(permissionAnswer({ action: 'edit', resources: [join(folder, 'opencode.json')] }, folder), 'reject');
  assert.equal(permissionAnswer({ action: 'write', resources: ['OpenCode.JSON'] }, folder), 'reject');
});

test('a run only starts in a folder that OpenCode has as a project', () => {
  assert.equal(isProject([{ canonical: 'C:\\Users\\someone\\relay-bench' }], 'c:/users/someone/relay-bench/'), true);
  assert.equal(isProject([{ canonical: 'C:\\Users\\someone\\other' }], 'C:\\Users\\someone\\relay-bench'), false);
  assert.equal(isProject([], 'C:\\Users\\someone\\relay-bench'), false);
});

// A stand-in for Relay's settings RPC that behaves as the real store does: a save with an old revision is refused.
function fakeRelay(failSave = false) {
  let stored = { revision: 3, modes: { plan: [{ providerID: 'p', id: 'big', variant: null, useFor: '' }], execute: [], review: [] } as object, decider: { providerID: 'p', id: 'judge', variant: null } as object | null };
  return {
    stored: () => stored,
    getRelay: async () => ({ settings: structuredClone(stored) }),
    saveRelay: async (input: { revision: number; modes: object; decider: object | null }) => {
      if (failSave) throw new Error('the service went away');
      if (input.revision !== stored.revision) throw new Error('stale revision');
      stored = { revision: stored.revision + 1, modes: input.modes, decider: input.decider };
      return { settings: stored };
    },
  };
}

test('putting Relay\'s settings back restores them and checks that they are back', async () => {
  const relay = fakeRelay(), before = { modes: { plan: [], execute: [], review: [] }, decider: null };
  const result = await restoreSettings(relay, {}, before, 'out/results.json');
  assert.equal(result.ok, true, result.message);
  assert.deepEqual({ modes: relay.stored().modes, decider: relay.stored().decider }, before);
});

test('when the settings cannot be put back, it says so and where the old ones are, instead of throwing', async () => {
  const result = await restoreSettings(fakeRelay(true), {}, { modes: { plan: [], execute: [], review: [] }, decider: null }, 'out/results.json');
  assert.equal(result.ok, false);
  assert.match(result.message, /NOT put back.*the service went away.*out\/results\.json/s);
});
