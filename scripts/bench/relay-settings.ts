// Putting Relay's settings back after a proof-test run, in the owner's own OpenCode.
import { isDeepStrictEqual } from 'node:util';

type Settings = { modes: unknown; decider: unknown };
/** The two calls of Relay's RPC this needs, as the real store answers them. */
export type RelaySettingsRpc = {
  getRelay(input: object, options: object): Promise<{ settings: Settings & { revision: number } }>;
  saveRelay(input: Settings & { revision: number }, options: object): Promise<unknown>;
};

/**
 * Puts back the settings the run found, then reads them again to check that they are back. It never throws: after a failure it says that the
 * settings were not put back, and where the ones from before the run were saved.
 */
export async function restoreSettings(rpc: RelaySettingsRpc, options: object, before: Settings, backup: string): Promise<{ ok: boolean; message: string }> {
  try {
    const now = await rpc.getRelay({}, options);
    await rpc.saveRelay({ revision: now.settings.revision, modes: before.modes, decider: before.decider }, options);
    const after = (await rpc.getRelay({}, options)).settings;
    if (isDeepStrictEqual({ modes: after.modes, decider: after.decider }, { modes: before.modes, decider: before.decider })) {
      return { ok: true, message: `Relay's settings are back as they were (checked, revision ${after.revision}).` };
    }
    return { ok: false, message: `Relay's settings were saved but do NOT read back as they were. The ones from before the run are in ${backup} (settingsBefore).` };
  } catch (error) {
    return { ok: false, message: `Relay's settings were NOT put back (${error instanceof Error ? error.message : String(error)}). The ones from before the run are in ${backup} (settingsBefore).` };
  }
}
