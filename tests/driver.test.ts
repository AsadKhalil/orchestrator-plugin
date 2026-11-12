import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, criterion } from './fixtures/plan-data.js';
import { RunRepository } from '../src/run-store.js';
import { createDriver } from '../src/driver.js';
import type { Ports } from '../src/orchestrator.js';

const memory = () => { const records = new Map<string, unknown>(); return { async get(k: string) { return structuredClone(records.get(k)); }, async set(k: string, v: unknown) { records.set(k, structuredClone(v)); } }; };
const plan = { steps: [step('Implement')], acceptance: [criterion('Works')], questions: [], areas: ['src'], rollback: 'revert', validationCommands: ['test'] };

function setup(hold?: Promise<void>) {
  const repo = new RunRepository(memory()), calls: string[] = [], interrupted: string[] = []; let live: string[] = [], version = 0;
  const ports: Ports & { activeSessions(id: string): string[] } = {
    plan: async run => { calls.push('plan'); return repo.setPlan(run.id, run.revision, plan); }, prepareWorktree: async () => {}, identity: async () => `tree:${version}`,
    code: async () => { calls.push('code'); live = ['ses_coder']; try { if (hold) await hold; } finally { live = []; } version++; },
    validate: async () => ({ status: 'passed', commands: [{ command: 'test', exitCode: 0 }] }),
    reviewer: async () => ({ reviewer: { providerID: 'p', id: 'r', variant: null, vendor: 'rv', modelVersion: '1' }, contributingVendors: ['pv', 'cv'] }),
    review: async run => repo.recordReview(run.id, run.revision, { planHash: run.planHash!, diffHash: run.review!.pending!.diffHash, verdict: 'approve', findings: [] }),
    budgetAvailable: async () => true, activeSessions: () => live,
  };
  const host = { async ownsSession() { return true; }, async interrupt(sessionID: string) { interrupted.push(sessionID); return { interrupted: true }; } };
  const errors: unknown[] = [];
  return { repo, ports, calls, interrupted, driver: createDriver({ repo, ports, host: host as never, store: { async get() { return undefined; } }, onError: (_id, e) => errors.push(e) }), errors };
}

test('a run is driven in the background, once at a time, to its next waiting point', async () => {
  const { repo, driver, calls } = setup(); await repo.create('r', 'Login', 'c0ffee');
  assert.equal(driver.start('r', true), true); assert.equal(driver.start('r', true), false, 'a second start while active is refused'); assert.equal(driver.isActive('r'), true);
  await driver.idle();
  assert.equal(driver.isActive('r'), false); assert.equal((await repo.get('r')).state, 'ready_for_acceptance'); assert.deepEqual(calls, ['plan', 'code']);
});

test('errors end the drive without losing the persisted state', async () => {
  const { repo, driver, errors } = setup(); await repo.create('r', 'Login', 'c0ffee');
  driver.start('missing'); await driver.idle();
  assert.equal(errors.length, 1); assert.match(String((errors[0] as Error).message), /not found/i);
  assert.equal((await repo.get('r')).state, 'planning');
});

test('stop interrupts the in-flight stage and the run ends cancelled', async () => {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  const { repo, driver, interrupted } = setup(hold); await repo.create('r', 'Login', 'c0ffee');
  driver.start('r', true);
  for (let i = 0; i < 100 && (await repo.get('r')).state !== 'implementing'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  await new Promise(resolve => setTimeout(resolve, 20));
  const stopped = await driver.stop('r', (await repo.get('r')).revision);
  assert.equal(stopped.stopRequested, true); assert.deepEqual(interrupted, ['ses_coder']);
  release(); await driver.idle();
  const final = await repo.get('r'); assert.equal(final.state, 'cancelled'); assert.ok(final.planHash);
});

test('stopping an idle waiting run cancels it', async () => {
  const { repo, driver } = setup(); await repo.create('r', 'Login', 'c0ffee'); driver.start('r'); await driver.idle();
  assert.equal((await repo.get('r')).state, 'awaiting_approval');
  await driver.stop('r', (await repo.get('r')).revision); await driver.idle();
  assert.equal((await repo.get('r')).state, 'cancelled');
});

test('an unexpected failure leaves the run paused with a visible reason instead of looking live', async () => {
  const { repo, ports, driver, errors } = setup(); await repo.create('r', 'Login', 'c0ffee');
  ports.budgetAvailable = async () => { throw new Error('ledger contention'); };
  driver.start('r'); await driver.idle();
  const run = await repo.get('r'); assert.equal(errors.length, 1); assert.equal(run.state, 'needs_attention'); assert.equal(run.attention?.reason, 'drive_error'); assert.equal(run.attention?.resumeState, 'planning');
});
