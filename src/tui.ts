import type { Plugin } from '@opencode/plugin/tui';
import { RelayRpc } from './contract.js';
import type { UsageRow } from './relay-store.js';
import { usageText } from './relay-view.js';
import { describeError } from './router.js';

// Relay's part in OpenCode's terminal app: `/relay-stats` shows Usage by model in a dialog, as the panel shows it. The server part keeps the
// totals; this only asks for them. Only types come from `@opencode/plugin/tui`: its index loads the terminal's Solid runtime, which this does not need.

const TITLE = 'Relay: usage by model';
type UsageView = { since: string | null; rows: UsageRow[]; credit: string | null };

/** Asks Relay for the totals and shows them. It never throws: a failure becomes an error toast. */
async function showUsage(ctx: Plugin.Context): Promise<void> {
  try {
    const location = ctx.location ?? ctx.data.location.default();
    const view = await ctx.client.rpc(RelayRpc).getRelayUsage({}, { location }) as UsageView;
    await ctx.ui.dialog.alert({ title: TITLE, message: usageText(view) });
  } catch (error) {
    ctx.ui.toast.show({ variant: 'error', title: 'Relay', message: `Relay could not read its usage: ${describeError(error, 'no answer')}` });
  }
}

const tui: Plugin.Definition = {
  id: 'relay-opencode',
  setup(ctx) {
    ctx.keymap.layer(() => ({
      commands: [{ id: 'relay-opencode.stats', title: TITLE, description: 'Every message Relay placed, by model and effort: requests, tokens and cost', group: 'Relay', palette: true, slash: { name: 'relay-stats' }, run: () => showUsage(ctx) }],
    }));
  },
};
export default tui;
