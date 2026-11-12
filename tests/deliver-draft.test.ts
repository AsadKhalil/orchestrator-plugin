import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliverDraft, deliveryRecordKey } from '../src/deliver-draft.js';
import { getDelivery, saveDelivery } from '../src/delivery-settings.js';
import { worktreeKey } from '../src/host-ports.js';
import { acceptRun, type Run } from '../src/run.js';
import { branch, fixture, harness, ready, runID, type Fixture } from './fixtures/delivery-fixture.js';

const github = (f: Fixture) => ({ remote: 'origin', remoteURL: f.remote, baseBranch: 'main', branchPrefix: 'feature-pilot/' });
function memory() { const data = new Map<string, unknown>(); return { data, get: async (key: string) => structuredClone(data.get(key)), set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } }; }
async function setup(options: { enable?: boolean; accept?: boolean } = {}) {
  const f = fixture(), store = memory(), h = harness(f), { run: reviewed } = await ready(f);
  const run: Run = options.accept === false ? reviewed : acceptRun(reviewed, reviewed.revision);
  await store.set(worktreeKey(run.id), f.dir);
  if (options.enable !== false) await saveDelivery(store as never, f.dir, 0, { publicationEnabled: true, github: github(f) });
  const env = { directory: f.dir, store, repo: { get: async () => run }, exec: h.exec, repoOf: () => 'github.com/example/widgets' };
  return { f, store, h, run, env, done: f.done };
}
const gh = (h: ReturnType<typeof harness>) => h.state.calls.filter(call => call.file === 'gh');

test('publication is off by default: nothing is run and nothing leaves the machine', async () => {
  const s = await setup({ enable: false });
  try {
    const result = await deliverDraft(s.env, s.run.id, s.run.revision, 'github');
    assert.equal(result.status, 'refused'); assert.match(result.reason ?? '', /not enabled/i); assert.equal(s.h.state.calls.length, 0);
    assert.deepEqual(await getDelivery(s.store as never, s.f.dir), { revision: 0, publicationEnabled: false, github: null });
  } finally { s.done(); }
});

test('only an accepted run is published, even when publication is enabled', async () => {
  const s = await setup({ accept: false });
  try {
    const result = await deliverDraft(s.env, s.run.id, s.run.revision, 'github');
    assert.equal(result.status, 'refused'); assert.match(result.reason ?? '', /accept the run/i); assert.equal(s.h.state.calls.length, 0);
    await assert.rejects(deliverDraft(s.env, s.run.id, s.run.revision + 1, 'github'), /stale/i);
  } finally { s.done(); }
});

test('an accepted run becomes a draft pull request, the record is saved, and a second click reuses it', async () => {
  const s = await setup();
  try {
    const first = await deliverDraft(s.env, s.run.id, s.run.revision, 'github');
    assert.equal(first.status, 'delivered'); assert.equal(first.branch, branch); assert.equal(first.prUrl, 'https://github.com/example/widgets/pull/1'); assert.equal(first.reusedPR, false);
    assert.ok(gh(s.h).some(call => call.args.includes('--draft')), 'always a draft');
    assert.equal(gh(s.h).some(call => call.args.includes('merge')), false, 'never merges');
    assert.equal(JSON.parse(String(s.store.data.get(deliveryRecordKey(s.run.id)))).phase, 'delivered');
    const second = await deliverDraft(s.env, s.run.id, s.run.revision, 'github');
    assert.equal(second.status, 'delivered'); assert.equal(second.reusedPR, true); assert.equal(s.h.state.prs.length, 1, 'no second pull request');
  } finally { s.done(); }
});

test('two deliveries of the same run cannot overlap', async () => {
  const s = await setup();
  try {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const slow = { ...s.env, exec: async (...args: Parameters<typeof s.h.exec>) => { await gate; return s.h.exec(...args); } };
    const first = deliverDraft(slow, s.run.id, s.run.revision, 'github');
    await assert.rejects(deliverDraft(s.env, s.run.id, s.run.revision, 'github'), /already in progress/i);
    release(); assert.equal((await first).status, 'delivered');
    assert.equal((await deliverDraft(s.env, s.run.id, s.run.revision, 'github')).status, 'delivered', 'the guard is released afterwards');
  } finally { s.done(); }
});

test('an unreadable saved record stops delivery instead of guessing', async () => {
  const s = await setup();
  try {
    await s.store.set(deliveryRecordKey(s.run.id), '{not json');
    const result = await deliverDraft(s.env, s.run.id, s.run.revision, 'github');
    assert.equal(result.status, 'needs_attention'); assert.equal(s.h.state.calls.length, 0);
  } finally { s.done(); }
});

test('a local export is written beside the run worktrees, not inside the project', async () => {
  const s = await setup({ enable: false, accept: false });
  try {
    const result = await deliverDraft(s.env, s.run.id, s.run.revision, 'local');
    assert.equal(result.status, 'exported'); assert.equal(result.paths.length, 2);
    for (const path of result.paths) assert.ok(path.startsWith(`${s.f.dir}.feature-pilot`) && existsSync(path), path);
    assert.match(readFileSync(result.paths[1], 'utf8'), /Feature Pilot|requirement/i);
    assert.equal(existsSync(join(s.f.dir, 'feature-pilot-' + s.run.id)), false);
  } finally { s.done(); }
});

test('delivery settings reject credentials, odd names, contradictions and stale writes', async () => {
  const s = await setup({ enable: false });
  try {
    const save = (revision: number, input: unknown) => saveDelivery(s.store as never, s.f.dir, revision, input);
    const ok = github(s.f);
    await assert.rejects(save(0, { publicationEnabled: true, github: { ...ok, remoteURL: 'https://user:token@github.com/o/r.git' } }), /credentials/i);
    await assert.rejects(save(0, { publicationEnabled: true, github: { ...ok, remote: '--upload-pack=x' } }), /plain/i);
    await assert.rejects(save(0, { publicationEnabled: true, github: { ...ok, baseBranch: '../main' } }), /plain/i);
    await assert.rejects(save(0, { publicationEnabled: true, github: { ...ok, branchPrefix: 'feature-pilot' } }), /prefix/i);
    await assert.rejects(save(0, { publicationEnabled: true, github: null }), /destination/i);
    await assert.rejects(save(0, { publicationEnabled: true, github: { ...ok, extra: 1 } }), /invalid/i);
    assert.equal((await save(0, { publicationEnabled: true, github: ok })).revision, 1);
    await assert.rejects(save(0, { publicationEnabled: false, github: ok }), /stale/i);
    assert.deepEqual(await getDelivery(s.store as never, s.f.dir), { revision: 1, publicationEnabled: true, github: ok });
  } finally { s.done(); }
});
