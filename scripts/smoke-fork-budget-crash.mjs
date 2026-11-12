import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCode } from '@opencode/client/promise';

const fork = resolve(dirname(fileURLToPath(import.meta.url)), '../../opencode-host-fork');
const root = await mkdtemp(join(tmpdir(), 'fp-budget-crash-')), project = join(root, 'project');
const password = 'synthetic-only', servers = [];
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'SHELL'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const sleep = () => new Promise(resolve => setTimeout(resolve, 50));
try {
  await Promise.all(['project', 'config', 'data', 'cache', 'state'].map(name => mkdir(join(root, name), { recursive: true })));
  await writeFile(join(project, 'opencode.json'), JSON.stringify({ plugins: [join(fork, 'packages/core/test/fixture/plugin-budget-crash')] }));
  Object.assign(env, { XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), OPENCODE_TEST_HOME: root, OPENCODE_SERVER_PASSWORD: password });
  async function start(role, marker) {
    const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
    const address = listener.address(); if (!address || typeof address === 'string') throw Error('No loopback port');
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    const child = spawn(process.env.FEATURE_PILOT_BUN ?? 'bun', [join(fork, 'packages/cli/src/index.ts'), 'serve', '--hostname', '127.0.0.1', '--port', String(address.port)], { cwd: join(fork, 'packages/cli'), env: { ...env, FEATURE_PILOT_CRASH_ROLE: role }, stdio: ['ignore', 'pipe', 'pipe'] });
    const instance = { child, log: '' }; servers.push(instance);
    child.stdout.on('data', chunk => { instance.log += chunk.toString(); }); child.stderr.on('data', chunk => { instance.log += chunk.toString(); });
    const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${address.port}`, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
    const deadline = Date.now() + 30000; let initialized = false;
    while (!instance.log.includes(marker) && Date.now() < deadline) {
      if (child.exitCode !== null || instance.log.includes('BUDGET_CRASH_ERROR')) throw Error(`Probe failed: ${instance.log.slice(-600)}`);
      if (!initialized) try { await client.plugin.list({ location: { directory: project } }, { signal: AbortSignal.timeout(1500) }); initialized = true; } catch {}
      await sleep();
    }
    if (!instance.log.includes(marker)) throw Error(`Probe timed out: ${instance.log.slice(-600)}`);
    return child;
  }
  const writer = await start('writer', 'BUDGET_CRASH_COMMITTED');
  const exited = once(writer, 'exit'); writer.kill('SIGKILL'); await exited;
  await start('reader', 'BUDGET_CRASH_RECOVERED');
  console.log('PASS: a committed pending reservation survived a fork server process crash and still blocked overspending');
} finally {
  await Promise.all(servers.map(async ({ child }) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); const escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.kill('SIGTERM'); try { await exited; } finally { clearTimeout(escalation); }
  }));
  await rm(root, { recursive: true, force: true });
}
