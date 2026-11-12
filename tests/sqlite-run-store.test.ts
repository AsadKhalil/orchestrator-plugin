import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RunRepository } from '../src/run-store.js';
import { SqliteRunStore } from '../src/sqlite-run-store.js';
const exec = promisify(execFile);

test('serializes revision changes across independent processes', async () => {
  const dir=await mkdtemp(join(tmpdir(),'fp-runs-')), path=join(dir,'runs.sqlite');
  try {
    const store=new SqliteRunStore(path, '/project'), repo=new RunRepository(store); await repo.create('run','Original','base'); store.close();
    const results=await Promise.all(Array.from({length:5},(_,i)=>exec(process.execPath,['--import','tsx','tests/fixtures/sqlite-run-store/worker.ts',path,String(i)])));
    assert.equal(results.filter(r=>r.stdout.trim()==='updated').length,1); assert.equal(results.filter(r=>r.stdout.trim()==='stale').length,4);
    const reopened=new SqliteRunStore(path, '/project'), record=await new RunRepository(reopened).get('run');
    assert.equal(record.revision,1); assert.match(record.requirement,/^Requirement /); reopened.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('rolls back invalid transitions and does not allow direct writes', async () => {
  const dir=await mkdtemp(join(tmpdir(),'fp-runs-')), path=join(dir,'runs.sqlite');
  try {
    const store=new SqliteRunStore(path, '/project'), repo=new RunRepository(store), run=await repo.create('run','Original','base');
    await assert.rejects(repo.create('run','Duplicate','base'),/exists/i);
    await assert.rejects(repo.changeRequirement('run',9,'Wrong'),/stale/i);
    await assert.rejects(store.set('runs/run',run),/transaction/i);
    assert.equal((await repo.get('run')).requirement,'Original'); store.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('isolates and lists runs by project even when run IDs are identical', async () => {
  const dir=await mkdtemp(join(tmpdir(),'fp-run-project-')),path=join(dir,'runs.sqlite');
  try {
    const one=new SqliteRunStore(path,'/one'),two=new SqliteRunStore(path,'/two');
    const a=new RunRepository(one),b=new RunRepository(two);
    await a.create('same','First requirement','base');await b.create('same','Second requirement','base');
    await a.changeRequirement('same',0,'First changed');
    assert.equal((await a.get('same')).requirement,'First changed');assert.equal((await b.get('same')).requirement,'Second requirement');
    assert.deepEqual((await one.list()).map(run=>run.requirement),['First changed']);
    assert.deepEqual((await two.list()).map(run=>run.requirement),['Second requirement']);
    assert.throws(()=>new SqliteRunStore(path,''),/project/i);one.close();two.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('does not silently hide existing unscoped prototype data', async () => {
  const { DatabaseSync }=await import('node:sqlite');
  const dir=await mkdtemp(join(tmpdir(),'fp-run-legacy-')),path=join(dir,'runs.sqlite');
  try {
    const legacy=new DatabaseSync(path);legacy.exec("CREATE TABLE run_records (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO run_records VALUES ('runs/old','{}')");legacy.close();
    assert.throws(()=>new SqliteRunStore(path,'/project'),/migration/i);
    const check=new DatabaseSync(path);assert.equal(check.prepare('SELECT count(*) AS n FROM run_records').get()?.n,1);check.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});
