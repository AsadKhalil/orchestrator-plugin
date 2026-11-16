import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortUsd, stageIndex, stages, stateTone, usedPercent } from '../src/gui-model.js';

test('the progress strip places each active or waiting state, and gives no position to a paused or ended run', () => {
  assert.deepEqual(stages, ['Plan', 'Approve', 'Build', 'Review', 'Done']);
  const expected: Record<string, number> = { clarifying: 0, planning: 0, awaiting_approval: 1, implementing: 2, validating: 2, repairing: 2, reviewing: 3, ready_for_acceptance: 4, accepted: 5 };
  for (const [state, index] of Object.entries(expected)) assert.equal(stageIndex(state), index, state);
  // A paused or cancelled run does not remember where it stopped, so a position would be a guess.
  for (const state of ['needs_attention', 'cancelled', 'something_new']) assert.equal(stageIndex(state), null, state);
});

test('the status colour says whether the run is working, waiting on you, finished, stuck or ended', () => {
  for (const state of ['planning', 'implementing', 'validating', 'reviewing', 'repairing']) assert.equal(stateTone(state), 'busy', state);
  for (const state of ['clarifying', 'awaiting_approval', 'ready_for_acceptance']) assert.equal(stateTone(state), 'wait', state);
  assert.equal(stateTone('needs_attention'), 'warn');
  assert.equal(stateTone('accepted'), 'ok');
  assert.equal(stateTone('cancelled'), 'idle');
  assert.equal(stateTone('something_new'), 'idle');
});

test('the budget bar is a whole percent of the limit, never above 100, and absent when there is no usable limit', () => {
  assert.equal(usedPercent('5', '20'), 25);
  assert.equal(usedPercent('3.43431296', '5'), 68);
  assert.equal(usedPercent('25', '20'), 100);
  assert.equal(usedPercent('0', '20'), 0);
  assert.equal(usedPercent('5', null), null);
  assert.equal(usedPercent('5', '0'), null);
  assert.equal(usedPercent('not money', '20'), null);
  assert.equal(usedPercent('5', 'not money'), null);
});

test('short amounts are for reading only: cents, a floor marker for tiny sums, and the original text when it is not an amount', () => {
  assert.equal(shortUsd('0'), '$0');
  assert.equal(shortUsd('3.43431296'), '$3.43');
  assert.equal(shortUsd('15.22875264'), '$15.23');
  assert.equal(shortUsd('20'), '$20.00');
  assert.equal(shortUsd('0.009'), '$0.01');
  assert.equal(shortUsd('0.004'), '<$0.01');
  assert.equal(shortUsd(null), 'unknown');
  assert.equal(shortUsd('n/a'), 'n/a');
});
