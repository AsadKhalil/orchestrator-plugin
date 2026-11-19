import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { permissionAnswer, resetFolder } from '../scripts/bench/folder.js';
import { formatUsd, parseUsd } from '../src/costs.js';
import { limitShare, monthShare, requestCost, sideTotals, table, type Cost } from '../scripts/bench/lib.js';

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

test('the table shows tasks passed and the saving against Off', () => {
  const totals = sideTotals([
    { task: 'wordy', side: 'off', passed: true, cost: parseUsd('0.1'), month: monthShare(parseUsd('0.1'), '15') },
    { task: 'wordy', side: 'on-one', passed: false, cost: parseUsd('0.04'), month: monthShare(parseUsd('0.04'), '15') },
  ]);
  const printed = table(totals);
  assert.ok(printed.includes('| Tasks passed | 1 of 1 | 0 of 1 |'), printed);
  assert.ok(printed.includes('| Saved, against Off | - | 60.0% |'), printed);
});

test('a side that used two models counts each against its own monthly limit', () => {
  // $1.50 on a model with a $15 limit and $6 on one with a $60 limit are 10% of the month each (Go's docs), so 20% together.
  const month = monthShare(parseUsd('1.5'), '15') + monthShare(parseUsd('6'), '60');
  const printed = table(sideTotals([{ task: 'wordy', side: 'on-one', passed: true, cost: parseUsd('7.5'), month }]));
  assert.ok(printed.includes('| 5-hour limit used | 100.0% |'), printed);
  assert.ok(printed.includes('| Weekly limit used | 40.0% |'), printed);
});

// The test folder is emptied before each chat. Only a folder holding the test's opencode.json may be emptied, and that file stays.
test('resetting the test folder keeps opencode.json, removes the rest and writes the task files', () => {
  const folder = mkdtempSync(join(tmpdir(), 'relay-bench-test-'));
  try {
    writeFileSync(join(folder, 'opencode.json'), '{"permissions":[]}');
    writeFileSync(join(folder, 'left_over.py'), 'x = 1');
    mkdirSync(join(folder, 'sub')); writeFileSync(join(folder, 'sub', 'b.txt'), 'b');
    resetFolder(folder, { 'instructions.md': '# Wordy', 'wordy.py': 'def answer(question):\n    pass\n' });
    assert.deepEqual(readdirSync(folder).sort(), ['instructions.md', 'opencode.json', 'wordy.py']);
    assert.equal(readFileSync(join(folder, 'opencode.json'), 'utf8'), '{"permissions":[]}');
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

test('a permission is allowed once, and only for reading or editing inside the test folder', () => {
  const folder = join(tmpdir(), 'relay-bench');
  assert.equal(permissionAnswer({ action: 'edit', resources: [join(folder, 'wordy.py')] }, folder), 'once');
  assert.equal(permissionAnswer({ action: 'read', resources: ['wordy.py'] }, folder), 'once');
  assert.equal(permissionAnswer({ action: 'edit', resources: [join(folder, '..', 'plugin', 'src', 'index.ts')] }, folder), 'reject');
  assert.equal(permissionAnswer({ action: 'edit', resources: ['../outside.py'] }, folder), 'reject');
  assert.equal(permissionAnswer({ action: 'edit', resources: [] }, folder), 'reject');
  assert.equal(permissionAnswer({ action: 'shell', resources: ['python wordy.py'] }, folder), 'reject');
});
