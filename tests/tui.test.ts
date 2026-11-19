import { test } from 'node:test';
import assert from 'node:assert/strict';
import tui from '../src/tui.js';
import { usageText } from '../src/relay-view.js';

/** A terminal app with just what Relay's terminal part uses: the location, the RPC client, the keymap, a dialog and a toast. */
function terminal(answer: (options: unknown) => Promise<unknown>, location: { directory: string } | null = { directory: '/repo' }) {
  const layers: { commands: { id: string; title: string; palette?: true; slash?: { name: string }; run: () => void | Promise<void> }[] }[] = [];
  const alerts: unknown[] = [], toasts: unknown[] = [], asked: unknown[] = [];
  const ctx = {
    location: location ?? undefined, data: { location: { default: () => ({ directory: '/home' }) } },
    client: { rpc: (definition: { id: string }) => ({ getRelayUsage: async (input: unknown, options: unknown) => { asked.push({ id: definition.id, input, options }); return answer(options); } }) },
    keymap: { layer: (factory: () => (typeof layers)[number]) => { layers.push(factory()); } },
    ui: { dialog: { alert: async (options: unknown) => { alerts.push(options); } }, toast: { show: (options: unknown) => { toasts.push(options); } } },
  };
  return { ctx, layers, alerts, toasts, asked };
}

test('the terminal part adds /relay-stats, which shows usage by model in a dialog', async () => {
  const view = { directory: '/repo', since: null, rows: [], credit: null }, app = terminal(async () => view);
  await tui.setup(app.ctx as never);
  const [command] = app.layers[0].commands;
  assert.deepEqual([tui.id, command.id, command.title, command.palette, command.slash], ['relay-opencode', 'relay-opencode.stats', 'Relay: usage by model', true, { name: 'relay-stats' }]);
  await command.run();
  assert.deepEqual(app.asked, [{ id: 'relay-opencode', input: {}, options: { location: { directory: '/repo' } } }]);
  assert.deepEqual([app.alerts, app.toasts], [[{ title: 'Relay: usage by model', message: usageText(view) }], []]);
});

test('/relay-stats asks for the default folder when none is open, and a failing call shows an error toast and never throws', async () => {
  const app = terminal(async () => { throw new Error('RPC call failed'); }, null);
  await tui.setup(app.ctx as never);
  await assert.doesNotReject(async () => app.layers[0].commands[0].run());
  assert.deepEqual(app.asked, [{ id: 'relay-opencode', input: {}, options: { location: { directory: '/home' } } }]);
  assert.deepEqual([app.alerts, app.toasts], [[], [{ variant: 'error', title: 'Relay', message: 'Relay could not read its usage: RPC call failed' }]]);
});
