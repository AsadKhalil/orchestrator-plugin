import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCode } from '@opencode/client/promise';

const fork = resolve(dirname(fileURLToPath(import.meta.url)), '../../opencode-host-fork');
const root = await mkdtemp(join(tmpdir(), 'fp-fork-shell-'));
const project = join(root, 'project');
const password = 'synthetic-only';
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'SHELL'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
let server;
try {
  await Promise.all(['project', 'config', 'data', 'cache', 'state'].map(name => mkdir(join(root, name), { recursive: true })));
  await writeFile(join(project, 'opencode.json'), JSON.stringify({ plugins: [join(fork, 'packages/core/test/fixture/plugin-shell-probe')] }));
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw Error('No loopback port');
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  Object.assign(env, { XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), OPENCODE_TEST_HOME: root, OPENCODE_SERVER_PASSWORD: password });
  server = spawn(process.env.FEATURE_PILOT_BUN ?? 'bun', [join(fork, 'packages/cli/src/index.ts'), 'serve', '--hostname', '127.0.0.1', '--port', String(address.port)], { cwd: join(fork, 'packages/cli'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', chunk => { log += chunk.toString(); }); server.stderr.on('data', chunk => { log += chunk.toString(); });
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${address.port}`, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
  const deadline = Date.now() + 30000; let initialized = false;
  while (Date.now() < deadline && !log.includes('FORK_SHELL_PROBE_PASS')) {
    if (server.exitCode !== null) throw Error(`Fork server exited before probe: ${log.slice(-1200)}`);
    if (log.includes('FORK_SHELL_PROBE_ERROR')) throw Error(log.slice(log.indexOf('FORK_SHELL_PROBE_ERROR'), log.indexOf('FORK_SHELL_PROBE_ERROR') + 300));
    if (!initialized) try { await client.plugin.list({ location: { directory: project } }, { signal: AbortSignal.timeout(2000) }); initialized = true; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!log.includes('FORK_SHELL_PROBE_PASS')) throw Error(`Probe did not complete: ${log.slice(-1200)}`);
  console.log('PASS: Feature Pilot stop helper stopped an owned synthetic shell on the isolated fork and retained output');
} finally {
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit'); const escalation = setTimeout(() => server.kill('SIGKILL'), 5000);
    server.kill('SIGTERM'); try { await exited; } finally { clearTimeout(escalation); }
  }
  await rm(root, { recursive: true, force: true });
}
