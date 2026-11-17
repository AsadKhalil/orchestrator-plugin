import { For, Show, createMemo, createResource, createSignal, onCleanup, type JSX } from 'solid-js';
import { Command, ComposerPill, Panel, Plugin, type MountedSession, type PanelTab } from '@opencode/plugin/gui';
import { FeaturePilot } from './contract.js';
import { offered, type ModelChoice } from './settings.js';
import type { ModelCostView } from './inventory.js';
import { USE_FOR_MAX, type Decision, type Mode, type ModeChoice, type RelaySettings } from './relay-store.js';
import { describeError, modeLabel, reviewRules } from './router.js';
import { cheapestFirst, checksLine, decisionLine, noDeciderNote, pickerModel, pillView, priceLabel, privacyNote, recentLine, switchHint, tryLine } from './relay-view.js';
import { panelCss } from './gui-styles.js';

type Model = { providerID: string; id: string; name: string; enabled: boolean; status: string; variants: string[]; capabilities: { input: string[]; tools: boolean }; cost: ModelCostView };
const modeCards = [['plan', 'Thinks, explains and plans. Cannot change files.'], ['execute', 'Writes, changes, fixes and runs. Can change files.'], ['review', 'Checks existing work and reports. Cannot change files. Helpers that check work use these models too.']] as const;
type RelayView = { directory: string; settings: RelaySettings; decisions: Decision[]; deciders: Model[]; checks: { active: boolean; note: string | null } };
// The body is built the first time the section is opened, so closed sections cost nothing.
const Acc = (props: { title: string; sub?: string; children: JSX.Element }) => {
  const [seen, setSeen] = createSignal(false);
  return <details class="rl-acc" onToggle={event => { if (event.currentTarget.open) setSeen(true); }}>
    <summary>{props.title}<Show when={props.sub}><span class="rl-sub">{props.sub}</span></Show></summary>
    <div class="rl-acc-body"><Show when={seen()}>{props.children}</Show></div>
  </details>;
};

export default Plugin.define({
  setup(ctx) {
    // The panel keeps the id `models` it had when it also held the older pipeline's tabs, so a layout that saved it still opens it.
    const tab: PanelTab = { id: 'models', title: 'Relay', closable: 'compact', fallback: true };
    ctx.add(Command, () => ({
      id: 'open', title: 'Open Relay', keywords: 'relay models modes plan execute review decider',
      enabled: !!ctx.sessions.current(),
      run: () => { const session = ctx.sessions.current(); if (session) ctx.layout.toggle(`${ctx.id}:models`, session); },
    }));
    ctx.add(Panel, {
      id: 'models', region: 'side', width: 380,
      list: input => input.open.includes('models') ? [tab] : [],
      render: props => {
        type Session = typeof props.session;
        const api = (session: Session) => ({ rpc: session.server.client.rpc(FeaturePilot), options: { location: { directory: session.directory } } });
        const call = async <T extends object>(session: Session, run: (client: ReturnType<typeof api>) => Promise<unknown>) => {
          const value = await run(api(session)) as T & { directory: string };
          if (value.directory !== session.directory) throw new Error('Wrong project');
          return value;
        };
        const [saving, setSaving] = createSignal(false);
        const [saveError, setSaveError] = createSignal('');
        const [response, { refetch }] = createResource(() => props.session, async session => {
          const { rpc, options } = api(session);
          const [value, relay] = await Promise.all([rpc.listModels({}, options), rpc.getRelay({}, options)]) as [{ directory: string; models: Model[] }, RelayView];
          if (value.directory !== session.directory || relay.directory !== session.directory) throw new Error('Data came from a different project');
          return { session, models: value.models, relay };
        });
        const data = createMemo(() => response()?.session === props.session ? response() : undefined);
        const result = createMemo(() => data()?.models);
        // Recent choices, asked for again every 5 seconds while the panel is open, so a /relay sent meanwhile shows up without a Refresh.
        const [recent, setRecent] = createSignal<{ session: Session; decisions: Decision[] }>();
        const loadRecent = async () => {
          const session = props.session;
          try {
            const value = await call<{ decisions: Decision[] }>(session, ({ rpc, options }) => rpc.getRelayDecisions({}, options));
            if (props.session === session) setRecent({ session, decisions: value.decisions });
          } catch { /* the list keeps what it showed */ }
        };
        const poll = setInterval(() => void loadRecent(), 5000); onCleanup(() => clearInterval(poll));
        const decisions = createMemo(() => recent()?.session === props.session ? recent()!.decisions : data()?.relay.decisions ?? []);
        const when = (at: string) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const [order, setOrder] = createSignal<'provider' | 'price'>('provider');
        const same = (a: ModelChoice, b: ModelChoice) => a.providerID === b.providerID && a.id === b.id && a.variant === b.variant;
        const keyOf = (choice: ModelChoice) => JSON.stringify([choice.providerID, choice.id, choice.variant]);
        const chosen = (mode: Mode): ModeChoice[] => data()?.relay.settings.modes[mode] ?? [];
        /** Saves Relay's settings with one part changed, then reloads them. When the server refuses, its own words are shown. */
        const saveRelay = async (change: Partial<Pick<RelaySettings, 'modes' | 'decider'>>) => {
          const current = data(); if (!current || saving()) return;
          const { revision, modes, decider } = current.relay.settings;
          setSaving(true); setSaveError('');
          try { await call(current.session, ({ rpc, options }) => rpc.saveRelay({ revision, modes, decider, ...change }, options)); }
          catch (error) { setSaveError(describeError(error, 'Could not save. The settings may have changed; refresh and try again.')); }
          finally {
            try { if (props.session === current.session) await refetch(); }
            catch { setSaveError('Could not refresh the settings. Try Refresh.'); }
            finally { setSaving(false); }
          }
        };
        const setList = (mode: Mode, list: ModeChoice[]) => { const current = data(); if (current) void saveRelay({ modes: { ...current.relay.settings.modes, [mode]: list } }); };
        // The test box: what Relay would do with a sample message. Nothing is switched, sent or recorded.
        const [sample, setSample] = createSignal('');
        const [trying, setTrying] = createSignal(false);
        const [tried, setTried] = createSignal<{ session: Session; text: string; bad: boolean }>();
        const tryDecider = async () => {
          const session = props.session, text = sample(); if (trying() || !text.trim()) return;
          setTrying(true);
          try {
            const value = await call<Parameters<typeof tryLine>[0]>(session, ({ rpc, options }) => rpc.testDecider({ text }, options));
            if (props.session === session) setTried({ session, text: tryLine(value), bad: value.mode === null });
          } catch (error) { if (props.session === session) setTried({ session, text: describeError(error, 'Could not ask the decider.'), bad: true }); }
          finally { setTrying(false); }
        };
        /** The same test the router uses, so a chip says "unavailable" exactly when /relay would pass the model over. */
        const unavailable = (choice: ModelChoice) => { const models = result(); return models !== undefined && !offered(models, choice); };
        /** The decision models on offer, each with its efforts. A saved decider that is no longer offered stays in the list so the select can show it. */
        const deciderChoices = createMemo(() => {
          const relay = data()?.relay; if (!relay) return [];
          const list = relay.deciders.filter(model => model.enabled && model.status !== 'deprecated').flatMap(model => [null, ...model.variants].map(variant => { const choice: ModelChoice = { providerID: model.providerID, id: model.id, variant }; return { key: keyOf(choice), choice, label: `${model.name}${variant ? ` · ${variant}` : ''} · ${priceLabel(model.cost)}` }; }));
          const saved = relay.settings.decider;
          return saved && !list.some(item => item.key === keyOf(saved)) ? [...list, { key: keyOf(saved), choice: saved, label: `${saved.id} · not offered now` }] : list;
        });
        const deciderKey = () => { const saved = data()?.relay.settings.decider; return saved ? keyOf(saved) : ''; };
        const addableGroups = (mode: Mode) => {
          const items = (result() ?? []).filter(model => model.enabled && model.status !== 'deprecated').flatMap(model => [null, ...model.variants].map(variant => ({ model, variant, choice: { providerID: model.providerID, id: model.id, variant } as ModelChoice }))).filter(item => !chosen(mode).some(choice => same(choice, item.choice)));
          if (order() === 'price') return [['Cheapest first', [...items].sort((a, b) => cheapestFirst(a.model, b.model))] as const];
          return [...new Set(items.map(item => item.model.providerID))].map(provider => [provider, items.filter(item => item.model.providerID === provider)] as const);
        };
        const addModel = (mode: Mode, key: string) => { const found = addableGroups(mode).flatMap(([, items]) => items).find(item => keyOf(item.choice) === key); if (found) setList(mode, [...chosen(mode), { ...found.choice, useFor: '' }]); };

        return <section class="rl" aria-label="Relay">
          <style>{panelCss}</style>
          <header class="rl-top">
            <div class="rl-brand">
              <span class="rl-logo" aria-hidden="true">R</span><h2 class="rl-name">Relay</h2>
              <span class="rl-tag">Plan · Execute · Review</span>
            </div>
          </header>
          <div class="rl-body">
            <p class="rl-hint">Type <strong>/relay</strong> and your message in the chat. Relay picks Plan, Execute or Review for it, switches the chat to a model you chose for that mode, and sends your message. These settings are the same in every project.</p>
            <Show when={!response.error} fallback={<div class="rl-note n-bad" role="alert">Could not load the settings. Check the server connection and try again.</div>}>
              <Show when={data() && data()!.relay.settings.decider === null}><div class="rl-note n-warn" role="status">{noDeciderNote}</div></Show>
              <label class="rl-inline"><span class="rl-hint">Order the “Add a model” lists</span>
                <select class="rl-in" style={{ width: 'auto' }} value={order()} onChange={event => setOrder(event.currentTarget.value === 'price' ? 'price' : 'provider')}><option value="provider">By provider</option><option value="price">Cheapest first</option></select>
              </label>
              <For each={modeCards}>{([mode, blurb]) => <div class="rl-card">
                <div><strong class="rl-role">{modeLabel(mode)}</strong><span class="rl-hint">{blurb}</span></div>
                <For each={chosen(mode)}>{choice => <div class="rl-pick">
                  <span class={`rl-chip ${unavailable(choice) ? 'bad' : ''}`}>
                    <span class="rl-chip-t" title={`${choice.providerID} / ${choice.id}`}>{choice.id}{choice.variant ? ` · ${choice.variant}` : ''}</span>
                    <Show when={unavailable(choice)}><small>unavailable</small></Show>
                    <button type="button" class="rl-x" aria-label={`Remove ${choice.providerID} / ${choice.id} / ${choice.variant ?? 'default'} from ${modeLabel(mode)}`} disabled={saving()} onClick={() => setList(mode, chosen(mode).filter(item => !same(item, choice)))}>×</button>
                  </span>
                  <Show when={result() && offered(result()!, choice)}>{model => <span class="rl-hint">{priceLabel(model().cost)}</span>}</Show>
                  <input class="rl-in" type="text" maxlength={USE_FOR_MAX} aria-label={`What ${choice.id} is for in ${modeLabel(mode)}`} placeholder="Use it for… (your own words, optional)" value={choice.useFor} disabled={saving()}
                    onChange={event => { const useFor = event.currentTarget.value.replace(/\s+/g, ' ').trim(); if (useFor !== choice.useFor) setList(mode, chosen(mode).map(item => same(item, choice) ? { ...item, useFor } : item)); }} />
                </div>}</For>
                <Show when={!chosen(mode).length}><span class="rl-hint">None chosen yet. /relay leaves the chat as it is for {modeLabel(mode)}.</span></Show>
                <Show when={chosen(mode).length > 1}><span class="rl-hint">Several models: the decider picks the one whose line fits your message. When no line fits clearly, the chat keeps its model if it is in this list; otherwise the first is used. With no lines written, the first is always used.</span></Show>
                <select class="rl-in" aria-label={`Add a model for ${modeLabel(mode)}`} disabled={saving() || response.loading} onChange={event => { const key = event.currentTarget.value; event.currentTarget.value = ''; addModel(mode, key); }}>
                  <option value="">+ Add a model…</option>
                  <For each={addableGroups(mode)}>{([provider, items]) => <optgroup label={provider}><For each={items}>{item => <option value={keyOf(item.choice)}>{item.model.name} · {item.variant ?? 'default effort'} · {priceLabel(item.model.cost)}{item.model.capabilities.tools ? '' : ' · no tools'}</option>}</For></optgroup>}</For>
                </select>
              </div>}</For>
              <div class="rl-card">
                <div><strong class="rl-role">Decider</strong><span class="rl-hint">A small decision model. It picks the mode, and the model inside the mode, for each /relay message.</span></div>
                <select class="rl-in" aria-label="Decision model" disabled={saving() || response.loading} onChange={event => { const key = event.currentTarget.value; void saveRelay({ decider: deciderChoices().find(item => item.key === key)?.choice ?? null }); }}>
                  <option value="" selected={deciderKey() === ''}>No decider: /relay sends without switching</option>
                  <For each={deciderChoices()}>{item => <option value={item.key} selected={item.key === deciderKey()}>{item.label}</option>}</For>
                </select>
                <span class="rl-hint">{privacyNote(data()?.relay.settings.decider?.providerID ?? null)}</span>
                <div class="rl-inline">
                  <input class="rl-in" type="text" aria-label="A sample message to try the decider with" placeholder="Try a message, e.g. fix the login test" value={sample()} onInput={event => setSample(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void tryDecider(); }} />
                  <button type="button" class="rl-btn sm" disabled={trying() || !sample().trim() || !data()?.relay.settings.decider} onClick={() => void tryDecider()}>{trying() ? 'Asking…' : 'Try'}</button>
                </div>
                <Show when={tried()?.session === props.session ? tried() : undefined}>{shown => <div class={`rl-note ${shown().bad ? 'n-bad' : ''}`} role="status">{shown().text}</div>}</Show>
                <span class="rl-hint" aria-live="polite">{decisionLine(decisions()[0])}</span>
                <span class="rl-hint">{data() ? checksLine(data()!.relay.checks) : ''}</span>
                <span class="rl-hint">{switchHint}</span>
              </div>
              <Acc title="Recent choices" sub="the last 20, newest first">
                <Show when={decisions().length} fallback={<p class="rl-hint">No /relay message yet.</p>}>
                  <ol class="rl-plain"><For each={decisions()}>{item => <li class="rl-hint"><time dateTime={item.at}>{when(item.at)}</time> · {recentLine(item)}</li>}</For></ol>
                </Show>
              </Acc>
              <Acc title="Review rules" sub="added to every review"><pre class="rl-pre">{reviewRules}</pre></Acc>
              <div class="rl-row"><span class="rl-hint" aria-live="polite">{response.loading ? 'Loading…' : `${result()?.length ?? 0} models available`}{saving() ? ' · saving…' : ''}</span><button type="button" class="rl-btn sm" disabled={response.loading} onClick={() => void refetch()}>Refresh</button></div>
              <Show when={saveError()}><div class="rl-note n-bad" role="alert">{saveError()}</div></Show>
            </Show>
          </div>
        </section>;
      },
    });

    // The pill above each chat box: whether every message in that chat goes through Relay, the row that turns it, and the chat's last choice.
    // shortcut: it asks the server again every 5 seconds for the chats shown in the last 15; a server event would do better if OpenCode gives plugins one.
    const [chats, setChats] = createSignal<Record<string, { on: boolean; last: Decision | null; decider: boolean }>>({});
    const seen = new Map<string, { session: MountedSession; at: number }>();
    const relayOf = (session: MountedSession) => ({ rpc: session.server.client.rpc(FeaturePilot), options: { location: { directory: session.directory } } });
    // Desktop sends its model picker's choice with every message (2.3.0, 17 Nov), so after Relay switches a chat the picker must follow, or
    // the next message goes back to the old model. Only a switch made while the pill watches the chat is followed, once, and only while that
    // chat is on screen, so a model the person picks afterwards stands.
    // shortcut: a chat switched while another one is on screen is followed when it is shown again; a pick made in the picker within the
    // few seconds before that is overridden.
    const followed = new Map<string, string>();
    const follow = (session: MountedSession, last: Decision | null) => {
      const at = last?.at ?? '';
      if (!followed.has(session.key)) { followed.set(session.key, at); return; }
      if (!last || followed.get(session.key) === at) return;
      const model = pickerModel(last);
      if (!model) { followed.set(session.key, at); return; }
      if (ctx.sessions.current()?.key !== session.key) return;
      if (ctx.screen.current()?.composer.setModel(model)) followed.set(session.key, at);
    };
    const refresh = async (session: MountedSession) => {
      try {
        const { rpc, options } = relayOf(session);
        const value = await rpc.getRelayChat({ sessionID: session.id }, options) as { on: boolean; last: Decision | null; decider: boolean };
        setChats(previous => ({ ...previous, [session.key]: value }));
        follow(session, value.last);
      } catch { /* the pill keeps what it showed, or stays hidden */ }
    };
    const turn = async (session: MountedSession, on: boolean) => {
      try { const { rpc, options } = relayOf(session); await rpc.setRelayChat({ sessionID: session.id, on }, options); } catch { /* shown by the refresh below */ }
      await refresh(session);
    };
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of seen) if (now - entry.at > 15_000) seen.delete(key); else void refresh(entry.session);
    }, 5000);
    try {
      ctx.add(ComposerPill, {
        id: 'relay',
        show: input => {
          const session = input.session, first = !seen.has(session.key);
          seen.set(session.key, { session, at: Date.now() });
          if (first) void refresh(session);
          const state = chats()[session.key];
          if (!state) return undefined;
          const view = pillView(state);
          const run = (id: string) => id === 'toggle' ? () => void turn(session, !state.on) : id === 'decider' ? () => ctx.layout.open(`${ctx.id}:models`, session) : undefined;
          return {
            label: view.label, icon: view.icon, tone: view.tone, title: 'Relay',
            rows: view.rows.map(row => ({ id: row.id, label: row.label, tone: row.tone, run: run(row.id) })),
          };
        },
      });
    } catch { /* a host without the pill registry loses only the pill */ }
    return () => clearInterval(timer);
  },
});
