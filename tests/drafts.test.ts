import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDraft, listDrafts, getDraft, answerDraft, approveDraft, exportDraft } from '../src/drafts.js';
import { RunRepository } from '../src/run-store.js';
import { step, criterion } from './fixtures/plan-data.js';

test('rejects duplicate draft identities across storage pages', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const key = `project-runs/${encodeURIComponent('/project')}/runs/${id}`;
  const storage = { async scan({ after }: { after?: string }) { return { entries: [{ key }], ...(after ? {} : { next: 'second' }) }; } };
  await assert.rejects(listDrafts({ location: { directory: '/project' }, storage } as never), /duplicate/i);
});

test('saves the committed baseline and scopes draft discovery to the current project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fp-draft-')), a = join(root, 'a'), b = join(root, 'b');
  const data = new Map<string, unknown>();
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async set(key: string, value: unknown) { data.set(key, structuredClone(value)); }, async scan({prefix}: {prefix:string}) { return { entries: [...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })) }; } };
  try {
    await mkdir(a); await mkdir(b);
    for (const dir of [a, b]) {
      execFileSync('git', ['init', '-q', dir]); await writeFile(join(dir, 'base.txt'), 'baseline');
      execFileSync('git', ['-C', dir, 'add', 'base.txt']);
      execFileSync('git', ['-C', dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
    }
    const expected = execFileSync('git', ['-C', a, 'rev-parse', 'HEAD']).toString().trim();
    await writeFile(join(a, 'base.txt'), 'uncommitted');
    const ctxA = { location: {directory:a}, storage }, ctxB = { location: {directory:b}, storage };
    const draft = await createDraft(ctxA as never, 'Build a feature');
    assert.equal(JSON.parse(await exportDraft(ctxA as never, draft.id, draft.revision)).requirement, 'Build a feature');
    await assert.rejects(exportDraft(ctxA as never, draft.id, draft.revision + 1), /stale/i);
    await assert.rejects(exportDraft(ctxB as never, draft.id, draft.revision), /not found/i);
    assert.equal(draft.baseCommit, expected); assert.equal(draft.state, 'planning');
    assert.deepEqual(await listDrafts(ctxA as never), [draft]);
    assert.deepEqual(await listDrafts(ctxB as never), []);
    await assert.rejects(createDraft(ctxA as never, ' '), /requirement/i);
    assert.equal((await listDrafts(ctxA as never)).length, 1);
    const prefix = `project-runs/${encodeURIComponent(a)}/`;
    const repo = new RunRepository({ get: key => storage.get(prefix + key), set: (key, value) => storage.set(prefix + key, value) });
    let run = await repo.askQuestions(draft.id, draft.revision, [{ id: 'q', question: 'Which behavior?' }]);
    await assert.rejects(getDraft(ctxB as never, draft.id), /not found/i);
    const question = await getDraft(ctxA as never, draft.id); assert.equal(question.clarification[0].question, 'Which behavior?');
    await assert.rejects(answerDraft(ctxA as never, draft.id, draft.revision, [{ id: 'q', answer: 'A' }]), /stale/i);
    const answered = await answerDraft(ctxA as never, draft.id, run.revision, [{ id: 'q', answer: 'A' }]);
    run = await repo.setPlan(draft.id, answered.revision, { steps: [step('Implement')], acceptance: [criterion('Works')], questions: [{ question: 'Which behavior?', answer: 'A' }], areas: ['src'], rollback: 'Revert', validationCommands: ['test'] });
    const plan = await getDraft(ctxA as never, draft.id); assert.match(plan.planJson!, /Implement/);
    await assert.rejects(approveDraft(ctxA as never, draft.id, plan.revision, 'wrong'), /hash/i);
    const approved = await approveDraft(ctxA as never, draft.id, plan.revision, plan.planHash!);
    assert.equal(approved.state, 'approved');
    await assert.rejects(approveDraft(ctxA as never, draft.id, plan.revision, plan.planHash!), /revision/i);

  } finally { await rm(root, { recursive: true, force: true }); }
});
