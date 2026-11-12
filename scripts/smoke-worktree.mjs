import assert from 'node:assert/strict';
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { OpenCode } from '@opencode/client/promise';

const execFile = promisify(execFileCallback);
const cli = process.env.FEATURE_PILOT_SMOKE_CLI ?? 'opencode';
const root = await mkdtemp(join(tmpdir(), 'feature-pilot-worktree-'));
const project = join(root, 'project'), destination = join(root, 'worktrees');
const password = 'synthetic-local-smoke';
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'SystemRoot', 'COMSPEC'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
let server, spawnError;
try {
  await Promise.all(['project', 'worktrees', 'config', 'data', 'cache', 'state'].map(name => mkdir(join(root, name), { recursive: true })));
  const git = async (...args) => (await execFile('git', ['-C', project, ...args], { timeout: 15_000, env })).stdout.trim();
  await git('init', '-q');
  await writeFile(join(project, 'tracked.txt'), 'baseline\n');
  await git('add', 'tracked.txt');
  await git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'synthetic baseline');
  const baseline = await git('rev-parse', 'HEAD');
  await writeFile(join(project, 'tracked.txt'), 'dirty source\n');
  await writeFile(join(project, 'untracked.bin'), Buffer.from([0, 1, 2, 3]));
  const before = await git('status', '--porcelain=v1', '-z');
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('Cannot allocate local port');
  const port = address.port; await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  Object.assign(env, { XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), OPENCODE_SERVER_PASSWORD: password });
  server = spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.on('error', error => { spawnError = error; });
  let log = ''; server.stdout.on('data', chunk => { log += chunk.toString(); }); server.stderr.on('data', chunk => { log += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = OpenCode.make({ baseUrl, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
  let location;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error(`OpenCode exited before startup: ${log.slice(-2000)}`);
    try { location = await client.location.get({ location: { directory: project } }, { signal: AbortSignal.timeout(1000) }); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!location) throw new Error(`OpenCode did not become ready: ${log.slice(-2000)}`);
  const created = await client.worktree.create({ projectID: location.project.id, from: project, directory: destination, branch: baseline });
  const actual = await realpath(created.directory), parent = await realpath(destination);
  const child = relative(parent, actual);
  assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'host returned a directory outside the disposable destination');
  assert.equal((await execFile('git', ['-C', actual, 'rev-parse', 'HEAD'], { timeout: 15_000, env })).stdout.trim(), baseline);
  assert.equal((await readFile(join(actual, 'tracked.txt'), 'utf8')), 'baseline\n');
  assert.equal((await readFile(join(project, 'tracked.txt'), 'utf8')), 'dirty source\n');
  assert.deepEqual(await readFile(join(project, 'untracked.bin')), Buffer.from([0, 1, 2, 3]));
  assert.equal(await git('status', '--porcelain=v1', '-z'), before);
  await client.worktree.remove({ projectID: location.project.id, directory: actual, force: false });
  console.log('PASS: native worktree started at the requested commit and preserved the dirty source checkout');
  console.log('LIMIT: synthetic project had no startup script; this does not verify snapshots, permissions, or the Desktop panel');
} finally {
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    const escalation = setTimeout(() => server.kill('SIGKILL'), 5000);
    server.kill('SIGTERM');
    try { await exited; } finally { clearTimeout(escalation); }
  }
  await rm(root, { recursive: true, force: true });
}
