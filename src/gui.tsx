import { For, Index, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { Command, ComposerPill, Panel, Plugin, type MountedSession, type PanelTab } from '@opencode/plugin/gui';
import { FeaturePilot } from './contract.js';
import { offered, type ModelChoice, type Policy } from './settings.js';
import type { ModelCostView } from './inventory.js';
import { USE_FOR_MAX, type Decision, type Mode, type ModeChoice, type RelaySettings } from './relay-store.js';
import { modeLabel, reviewRules } from './router.js';
import { checksLine, decisionLine, pillView, priceLabel, privacyNote, switchHint, tryLine } from './relay-view.js';
import { canPublish, deliveryFromSettings, deliveryOutcome, deliveryProblems, deliveryRequest, emptyDelivery, publishWarning, type DeliveryDraft } from './gui-model.js';
import { attentionExplanation, attentionTitle, autonomousNote, availableActions, billingModes, budgetBackendNote, coderWarning, describeError, emptyRoute, evidenceKinds, parseTokenLimit, policyProblems, routeFromPolicy, routeToPolicy, runActionError, shouldPoll, stateLabel, truncate, verdictLabel, buildRecommendRequest, emptyRecommendDraft, emptyScore, emptySettle, evidenceLabel, exclusionExplanation, recommendError, recommendProblems, recommendRoles, recommendationNote, reservationWarning, settleProblems, settleRequest, shortUsd, stageIndex, stages, stateTone, usedPercent, type RecommendDraft, type ScoreDraft, type SettleDraft, type RouteDraft } from './gui-model.js';
import { compareMonthlyScenario } from './comparison.js';
import { panelCss } from './gui-styles.js';
import { sortModelInventory } from './model-sort.js';

type Price = { id: string; inputPerMillionUsd: string | null; outputPerMillionUsd: string | null; conditional: boolean; dynamicRouter: boolean; extraPriceFields: string[] };
type UsageBucket = { attempts: number; gross: { knownUsd: string; unknownCount: number }; cash: { knownUsd: string; unknownCount: number }; credit: { knownUsd: string; unknownCount: number } };
type UsageView = { summary: { calendarMonth: string; timeZone: string; total: UsageBucket; days: (UsageBucket & { date: string })[]; breakdown: { provider: (UsageBucket & { key: string })[]; model: (UsageBucket & { key: string })[]; effort: (UsageBucket & { key: string })[]; role: (UsageBucket & { key: string })[] } }; coverage: { complete: boolean; projectSessions: number; unavailableSessions: number; skippedMessages: number; truncated: boolean } };
type IntelligenceEntry = { id: string; slug: string; name: string; creator: string; score: number | null };
type Draft = { id: string; requirement: string; baseCommit: string; revision: number; state: string; planHash: string | null; attention: string | null; stopRequested: boolean };
type DraftDetail = Draft & { clarification: { id: string; question: string; answer: string | null }[]; planJson: string | null; approval: string | null; reviews: { verdict: string; blocking: number; advisory: number }[] };
type Reservation = { attemptID: string; period: string; reservedUsd: string; settledUsd: string | null; evidenceKind: string | null; evidenceReference: string | null };
type Candidate = { providerID: string; id: string; variant: string | null; vendor: string; estimatedCash: string | null; reservationGross: string | null; priceVerified: boolean; score: number | null };
type Recommendation = { snapshotID: string; selectionRevision: number; selected: Candidate | null; alternatives: Candidate[]; excluded: { providerID: string; id: string; variant: string | null; reasons: string[] }[] };
const scoreFields: [keyof ScoreDraft, string, 'decimal'?][] = [['canonicalID', 'Canonical model ID'], ['modelVersion', 'Model version'], ['variant', 'Tested variant (blank = default configuration)'], ['value', 'Score value', 'decimal'], ['source', 'Score source (who published it)']];
const billingLabels = { metered_api: 'Metered API (pay per token)', subscription: 'Subscription', local: 'Local' } as const;
const kindLabels = { official: 'Official provider page', catalog: 'Third-party catalog', provider_reported: 'Reported by the provider API', user_entered: 'Entered by me' } as const;
const routeFields: [keyof RouteDraft, string, ('decimal' | 'numeric')?][] = [['providerID', 'Provider ID'], ['id', 'Model ID'], ['variant', 'Variant (optional)'], ['vendor', 'Vendor'], ['canonicalID', 'Canonical model ID'], ['modelVersion', 'Model version'], ['input', 'Input USD per 1M tokens', 'decimal'], ['output', 'Output USD per 1M tokens', 'decimal'], ['cacheRead', 'Cache read per 1M (optional)', 'decimal'], ['cacheWrite', 'Cache write per 1M (optional)', 'decimal'], ['serviceTier', 'Service tier'], ['sourceURL', 'Rate source URL (https only)'], ['checkedAt', 'Rates checked on (YYYY-MM-DD or ISO date-time)']];
type BudgetUsage = { committedUsd: string; pendingUsd: string; pendingCount: number; remainingUsd: string | null; overLimitUsd: string | null };
type BudgetView = { directory: string; available: boolean; backend: 'host' | 'local_file' | null; period: string | null; monthly: { amount: string; revision: number } | null; feature: { amount: string; revision: number } | null; monthlyUsage: BudgetUsage | null; featureUsage: BudgetUsage | null };
type Model = { providerID: string; id: string; name: string; enabled: boolean; status: string; variants: string[]; capabilities: { input: string[]; tools: boolean }; cost: ModelCostView };
// The tab keeps its id `models`; only its label and content changed when it became the settings for /relay.
const tabs = [['run', 'Run'], ['models', 'Modes'], ['spend', 'Spend'], ['more', 'More']] as const;
type TabId = typeof tabs[number][0];
const modeCards = [['plan', 'Thinks, explains and plans. Cannot change files.'], ['execute', 'Writes, changes, fixes and runs. Can change files.'], ['review', 'Checks existing work and reports. Cannot change files. Helpers that check work use these models too.']] as const;
type RelayView = { directory: string; settings: RelaySettings; decisions: Decision[]; deciders: Model[]; checks: { active: boolean; note: string | null } };
const Field = (props: { label: string; children: JSX.Element }) => <label class="rl-f"><span>{props.label}</span>{props.children}</label>;
// The body is built the first time the section is opened, so closed sections cost nothing.
const Acc = (props: { title: string; sub?: string; onToggle?: (open: boolean) => void; children: JSX.Element }) => {
  const [seen, setSeen] = createSignal(false);
  return <details class="rl-acc" onToggle={event => { const open = event.currentTarget.open; if (open) setSeen(true); props.onToggle?.(open); }}>
    <summary>{props.title}<Show when={props.sub}><span class="rl-sub">{props.sub}</span></Show></summary>
    <div class="rl-acc-body"><Show when={seen()}>{props.children}</Show></div>
  </details>;
};
const Meter = (props: { label: string; usage: BudgetUsage | null; limit: string | null }) => {
  const percent = () => props.usage ? usedPercent(props.usage.committedUsd, props.limit) : null;
  return <div class="rl-meter-box">
    <div class="rl-row"><span>{props.label}</span><span class="rl-hint">{props.usage ? `${shortUsd(props.usage.committedUsd)} of ${props.limit === null ? 'no limit' : shortUsd(props.limit)}` : 'not available'}</span></div>
    <Show when={percent() !== null}><div class="rl-meter" role="progressbar" aria-label={`${props.label} budget used`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent()!}><i class={percent()! >= 100 ? 'full' : percent()! >= 85 ? 'hot' : ''} style={{ width: `${percent()}%` }} /></div></Show>
    <Show when={props.usage}>{usage => <span class="rl-hint" title={`committed $${usage().committedUsd}; pending $${usage().pendingUsd}`}>Includes {shortUsd(usage().pendingUsd)} held for {usage().pendingCount} pending requests · {usage().remainingUsd === null ? 'no limit set' : `${shortUsd(usage().remainingUsd)} left`}{usage().overLimitUsd !== null && usage().overLimitUsd !== '0' ? ` · over the limit by ${shortUsd(usage().overLimitUsd)}` : ''}</span>}</Show>
  </div>;
};

export default Plugin.define({
  setup(ctx) {
    const tab: PanelTab = { id: 'models', title: 'Relay', closable: 'compact', fallback: true };
    ctx.add(Command, () => ({
      id: 'open', title: 'Open Relay', keywords: 'relay feature pilot models modes plan execute review decider',
      enabled: !!ctx.sessions.current(),
      run: () => { const session = ctx.sessions.current(); if (session) ctx.layout.toggle(`${ctx.id}:models`, session); },
    }));
    ctx.add(Panel, {
      id: 'models', region: 'side', width: 380,
      list: input => input.open.includes('models') ? [tab] : [],
      render: props => {
        type Session = typeof props.session;
        const [requirement, setRequirement] = createSignal('');
        const [drafts, setDrafts] = createSignal<{ session: Session; runs: Draft[] }>();
        const [detail, setDetail] = createSignal<{ session: Session; run: DraftDetail }>();
        const [answerText, setAnswerText] = createSignal<Record<string, string>>({});
        const [exportPreview, setExportPreview] = createSignal<{ session: Session; id: string; revision: number; text: string }>();
        const [draftBusy, setDraftBusy] = createSignal(false);
        const [draftError, setDraftError] = createSignal('');
        const [draftNote, setDraftNote] = createSignal('');
        const api = (session: Session) => ({ rpc: session.server.client.rpc(FeaturePilot), options: { location: { directory: session.directory } } });
        const call = async <T extends object>(session: Session, run: (client: ReturnType<typeof api>) => Promise<unknown>) => {
          const value = await run(api(session)) as T & { directory: string };
          if (value.directory !== session.directory) throw new Error('Wrong project');
          return value;
        };
        const currentRun = createMemo(() => detail()?.session === props.session ? detail()!.run : undefined);
        const can = createMemo(() => { const run = currentRun(); return run ? availableActions(run) : undefined; });
        let version = 0, inflight: Promise<void> | undefined;
        const apply = (session: Session, run: DraftDetail) => {
          if (detail()?.run.id !== run.id) setAnswerText({});
          setDetail({ session, run });
          setDrafts(current => current?.session === session ? { session, runs: current.runs.map(item => item.id === run.id ? run : item) } : current);
        };
        // One getDraft at a time. A result that was requested before a later user action is dropped, so it cannot overwrite newer data.
        const refresh = async (id: string, open = false) => {
          while (inflight) await inflight;
          const session = props.session, stamp = version;
          inflight = (async () => {
            try {
              const value = await call<{ run: DraftDetail }>(session, ({ rpc, options }) => rpc.getDraft({ id }, options));
              if (props.session === session && stamp === version && (open || detail()?.run.id === id)) apply(session, value.run);
            } catch (error) { if (props.session === session) setDraftError(current => current || describeError(error, 'Could not refresh the run.')); }
          })().finally(() => { inflight = undefined; });
          await inflight;
        };
        const openDraft = async (id: string) => { version++; setDraftError(''); setDraftNote(''); await refresh(id, true); };
        // Every change uses the revision of the latest fetched detail; a refused (for example stale) call shows its message and reloads the run.
        const act = async (name: 'run' | 'auto' | 'stop' | 'accept' | 'resume' | 'approve' | 'answer') => {
          const current = detail(); if (!current || current.session !== props.session || draftBusy()) return;
          const { session, run } = current, base = { id: run.id, revision: run.revision };
          const answers = run.clarification.filter(item => item.answer === null && (answerText()[item.id] ?? '').trim()).map(item => ({ id: item.id, answer: answerText()[item.id] }));
          setDraftBusy(true); setDraftError(''); setDraftNote(''); version++;
          try {
            const value = await call<{ run: DraftDetail; started?: boolean }>(session, ({ rpc, options }) =>
              name === 'run' || name === 'auto' ? rpc.driveDraft({ id: run.id, autonomous: name === 'auto' }, options)
              : name === 'stop' ? rpc.stopDraft(base, options) : name === 'accept' ? rpc.acceptDraft(base, options) : name === 'resume' ? rpc.resumeDraft(base, options)
              : name === 'approve' ? rpc.approveDraft({ ...base, planHash: run.planHash ?? '' }, options) : rpc.answerDraft({ ...base, answers }, options));
            if (props.session === session) {
              version++; apply(session, value.run); if (name === 'answer') setAnswerText({});
              if (name === 'run' || name === 'auto') setDraftNote(value.started ? 'Started. This view refreshes while the run is working.' : 'Already running.');
            }
          } catch (error) {
            if (props.session === session) { setDraftError(runActionError(error)); version++; await refresh(run.id); }
          } finally { setDraftBusy(false); }
        };
        // Poll only while the driver is working. The next timer is armed after the previous fetch has been applied, so fetches never overlap.
        createEffect(() => {
          const current = detail();
          if (!current || current.session !== props.session || !shouldPoll(current.run.state) || draftBusy()) return;
          const id = current.run.id, timer = setTimeout(() => void refresh(id), 2000);
          onCleanup(() => clearTimeout(timer));
        });
        const loadExport = async () => {
          const current = detail(); if (!current || current.session !== props.session) return;
          const { session, run } = current;
          try {
            const value = await call<{ preview: string }>(session, ({ rpc, options }) => rpc.exportDraft({ id: run.id, revision: run.revision }, options));
            if (props.session === session && detail()?.run.id === run.id) setExportPreview({ session, id: run.id, revision: run.revision, text: value.preview });
          } catch (error) { if (props.session === session) { setDraftError(runActionError(error)); await refresh(run.id); } }
        };
        const loadDrafts = async () => {
          const session = props.session;
          try {
            const value = await call<{ runs: Draft[] }>(session, ({ rpc, options }) => rpc.listDrafts({}, options));
            if (props.session === session) setDrafts({ session, runs: value.runs });
          } catch (error) { if (props.session === session) setDraftError(describeError(error, 'Could not load feature runs.')); }
        };
        const saveDraft = async () => {
          const session = props.session, text = requirement(); if (draftBusy() || !text.trim()) return;
          setDraftBusy(true); setDraftError(''); setDraftNote('');
          try {
            const value = await call<{ run: Draft }>(session, ({ rpc, options }) => rpc.createDraft({ requirement: text }, options));
            if (props.session === session) { setRequirement(''); await loadDrafts(); await openDraft(value.run.id); }
          } catch (error) { if (props.session === session) setDraftError(describeError(error, 'Could not start the run. Check that this project has a Git commit.')); }
          finally { setDraftBusy(false); }
        };
        const [saving, setSaving] = createSignal(false);
        const [saveError, setSaveError] = createSignal('');
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const localDate = () => { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
        const [today, setToday] = createSignal(localDate());
        const clock = setInterval(() => setToday(localDate()), 60_000); onCleanup(() => clearInterval(clock));
        const [month, setMonth] = createSignal(today().slice(0, 7));
        const [usageLoading, setUsageLoading] = createSignal(false);
        const [usageError, setUsageError] = createSignal('');
        const [usage, setUsage] = createSignal<{ session: typeof props.session; report: UsageView }>();
        const [budget, setBudget] = createSignal<{ session: typeof props.session; runID: string | null; value: BudgetView }>();
        const [budgetBusy, setBudgetBusy] = createSignal(false);
        const [budgetError, setBudgetError] = createSignal('');
        const [monthlyLimit, setMonthlyLimit] = createSignal('');
        const [featureLimit, setFeatureLimit] = createSignal('');
        const selectedRunID = createMemo(() => detail()?.session === props.session ? detail()!.run.id : null);
        const currentBudget = createMemo(() => budget()?.session === props.session && budget()?.runID === selectedRunID() ? budget()?.value : undefined);
        const loadBudget = async (scope?: 'monthly' | 'feature') => {
          const session = props.session, runID = selectedRunID(), previous = currentBudget();
          if (budgetBusy() || (scope && !previous)) return;
          setBudgetBusy(true); setBudgetError('');
          try {
            const rpc = session.server.client.rpc(FeaturePilot), options = { location: { directory: session.directory } };
            const value = (scope ? await rpc.setBudget({ scope, runID, amount: scope === 'monthly' ? monthlyLimit() : featureLimit(), revision: (scope === 'monthly' ? previous!.monthly : previous!.feature)?.revision ?? 0 }, options) : await rpc.getBudget({ runID }, options)) as BudgetView;
            if (value.directory !== session.directory) throw new Error('Wrong project');
            if (props.session === session && selectedRunID() === runID) { setBudget({ session, runID, value }); setMonthlyLimit(value.monthly?.amount ?? ''); setFeatureLimit(value.feature?.amount ?? ''); }
          } catch { if (props.session === session) setBudgetError('Could not load or save the budget. Check the amount and refresh if another window changed it.'); }
          finally { setBudgetBusy(false); }
        };
        const currentUsage = createMemo(() => usage()?.session === props.session && usage()?.report.summary.calendarMonth === month() ? usage()?.report : undefined);
        const [apiEstimate, setApiEstimate] = createSignal('');
        const [fee, setFee] = createSignal('');
        const [overage, setOverage] = createSignal('');
        const [externalReview, setExternalReview] = createSignal('');
        const scenario = createMemo(() => { try { return compareMonthlyScenario({ apiUsd: apiEstimate(), feeUsd: fee(), nativeOverageUsd: overage(), independentReviewUsd: externalReview() }); } catch { return null; } });
        const [modelSort, setModelSort] = createSignal<'provider' | 'input' | 'output'>('provider');
        const [intelligenceLoading, setIntelligenceLoading] = createSignal(false);
        const [intelligenceError, setIntelligenceError] = createSignal('');
        const [intelligenceSearch, setIntelligenceSearch] = createSignal('');
        const [comparisonModel, setComparisonModel] = createSignal<{ session: typeof props.session; value: string }>();
        const [comparisonIndex, setComparisonIndex] = createSignal<{ session: typeof props.session; value: string }>();

        const [intelligence, setIntelligence] = createSignal<{ session: typeof props.session; indexVersion: number; entries: IntelligenceEntry[] }>();
        const visibleIntelligence = createMemo(() => intelligence()?.session === props.session ? [...intelligence()!.entries].filter(item => `${item.name} ${item.creator} ${item.slug}`.toLowerCase().includes(intelligenceSearch().toLowerCase())).sort((a,b) => a.score === null ? (b.score === null ? a.name.localeCompare(b.name) : 1) : b.score === null ? -1 : b.score - a.score || a.name.localeCompare(b.name)) : []);
        const loadIntelligence = async () => {
          const session = props.session; if (intelligenceLoading()) return;
          setIntelligenceLoading(true); setIntelligenceError('');
          try {
            const value = await session.server.client.rpc(FeaturePilot).listIntelligence({}, { location: { directory: session.directory } }) as { directory: string; indexVersion: number; entries: IntelligenceEntry[] };
            if (value.directory !== session.directory) throw new Error('Wrong project');
            if (props.session === session) setIntelligence({ session, indexVersion: value.indexVersion, entries: value.entries });
          } catch { if (props.session === session) setIntelligenceError('Could not load Artificial Analysis data. Check the server API key and access.'); }
          finally { setIntelligenceLoading(false); }
        };
        const [priceLoading, setPriceLoading] = createSignal(false);
        const [priceError, setPriceError] = createSignal('');
        const [prices, setPrices] = createSignal<{ session: typeof props.session; status: string; checkedAt: string; models: Price[] }>();
        const [response, { refetch }] = createResource(() => props.session, async session => {
          const rpc = session.server.client.rpc(FeaturePilot), options = { location: { directory: session.directory } };
          const [value, relay] = await Promise.all([rpc.listModels({}, options), rpc.getRelay({}, options)]) as [{ directory: string; models: Model[] }, RelayView];
          if (value.directory !== session.directory || relay.directory !== session.directory) throw new Error('Data came from a different project');
          return { session, models: value.models, relay };
        });
        const data = createMemo(() => response()?.session === props.session ? response() : undefined);
        const result = createMemo(() => data()?.models);
        const same = (a: ModelChoice, b: ModelChoice) => a.providerID === b.providerID && a.id === b.id && a.variant === b.variant;
        const keyOf = (choice: ModelChoice) => JSON.stringify([choice.providerID, choice.id, choice.variant]);
        const chosen = (mode: Mode): ModeChoice[] => data()?.relay.settings.modes[mode] ?? [];
        /** Saves Relay's settings with one part changed, then reloads them. When the server refuses, its own words are shown. */
        const saveRelay = async (change: Partial<Pick<RelaySettings, 'modes' | 'decider'>>) => {
          const current = data(); if (!current || saving()) return;
          const { revision, modes, decider } = current.relay.settings;
          setSaving(true); setSaveError('');
          try {
            const value = await current.session.server.client.rpc(FeaturePilot).saveRelay({ revision, modes, decider, ...change }, { location: { directory: current.session.directory } }) as { directory: string };
            if (value.directory !== current.session.directory) throw new Error('Wrong project');
          } catch (error) { setSaveError(describeError(error, 'Could not save. The settings may have changed; refresh and try again.')); }
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
        const loadUsage = async () => {
          const session = props.session, selectedMonth = month(); if (usageLoading() || !selectedMonth) return;
          setUsageLoading(true); setUsageError('');
          try {
            const value = await session.server.client.rpc(FeaturePilot).observedUsage({ month: selectedMonth, timeZone }, { location: { directory: session.directory } }) as UsageView & { directory: string };
            if (value.directory !== session.directory) throw new Error('Wrong project');
            if (props.session === session && month() === selectedMonth) setUsage({ session, report: value });
          } catch { if (props.session === session) setUsageError('Could not load observed usage.'); }
          finally { setUsageLoading(false); }
        };
        const loadPrices = async () => {
          const session = props.session; if (priceLoading()) return;
          setPriceLoading(true); setPriceError('');
          try {
            const value = await session.server.client.rpc(FeaturePilot).refreshPrices({}, { location: { directory: session.directory } }) as { directory: string; status: string; snapshot: { checkedAt: string; models: Price[] } };
            if (value.directory !== session.directory) throw new Error('Wrong project');
            if (props.session === session) setPrices({ session, status: value.status, checkedAt: value.snapshot.checkedAt, models: value.snapshot.models });
          } catch { if (props.session === session) setPriceError('Could not load OpenRouter prices.'); }
          finally { setPriceLoading(false); }
        };
        const sortedModels = createMemo(() => sortModelInventory(result() ?? [], prices()?.session === props.session ? prices()!.models : [], modelSort()));
        const priceFor = (model: Model) => model.providerID === 'openrouter' && prices()?.session === props.session ? prices()?.models.find(item => item.id === model.id) : undefined;
        const comparedChoice = createMemo(() => {
          if (comparisonModel()?.session !== props.session) return undefined;
          const choices = (result() ?? []).flatMap(model => [null, ...model.variants].map(variant => ({ model, variant, key: JSON.stringify([model.providerID, model.id, variant]) })));
          return choices.find(choice => choice.key === comparisonModel()?.value);
        });
        const comparedEntry = createMemo(() => comparisonIndex()?.session === props.session && intelligence()?.session === props.session ? visibleIntelligence().find(entry => entry.id === comparisonIndex()?.value) : undefined);

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

        const [policy, setPolicy] = createSignal<{ session: Session; revision: number }>();
        const [maxTokens, setMaxTokens] = createSignal('');
        const [coderEnabled, setCoderEnabled] = createSignal(false);
        const [routes, setRoutes] = createSignal<RouteDraft[]>([]);
        const [policyBusy, setPolicyBusy] = createSignal(false);
        const [policyErrors, setPolicyErrors] = createSignal<string[]>([]);
        const [policyNote, setPolicyNote] = createSignal('');
        const showPolicy = (session: Session, value: { policy: Policy }) => { setPolicy({ session, revision: value.policy.revision }); setMaxTokens(String(value.policy.maxOutputTokens)); setCoderEnabled(value.policy.coderEnabled); setRoutes(value.policy.routes.map(routeFromPolicy)); };
        const loadPolicy = async () => {
          const session = props.session; if (policyBusy()) return;
          setPolicyBusy(true); setPolicyErrors([]); setPolicyNote('');
          try {
            const value = await call<{ policy: Policy }>(session, ({ rpc, options }) => rpc.getPolicy({}, options));
            if (props.session === session) showPolicy(session, value);
          } catch (error) { if (props.session === session) setPolicyErrors([describeError(error, 'Could not load spending settings.')]); }
          finally { setPolicyBusy(false); }
        };
        // Sends the complete policy with the fetched revision; the backend's refusal text is shown unchanged.
        const submitPolicy = async () => {
          const current = policy(); if (!current || current.session !== props.session || policyBusy()) return;
          const problems = policyProblems(maxTokens(), routes()), tokens = parseTokenLimit(maxTokens());
          setPolicyNote('');
          if (problems.length || tokens === null) { setPolicyErrors(problems); return; }
          const session = current.session; setPolicyBusy(true); setPolicyErrors([]);
          try {
            const value = await call<{ policy: Policy }>(session, ({ rpc, options }) => rpc.savePolicy({ revision: current.revision, maxOutputTokens: tokens, coderEnabled: coderEnabled(), routes: routes().map(routeToPolicy) }, options));
            if (props.session === session) { showPolicy(session, value); setPolicyNote(`Saved (revision ${value.policy.revision}).`); }
          } catch (error) { if (props.session === session) setPolicyErrors([describeError(error, 'Could not save spending settings.')]); }
          finally { setPolicyBusy(false); }
        };
        const [delivery, setDelivery] = createSignal<{ session: Session; revision: number }>();
        const [deliveryDraft, setDeliveryDraft] = createSignal<DeliveryDraft>(emptyDelivery());
        const [deliveryBusy, setDeliveryBusy] = createSignal(false);
        const [deliveryErrors, setDeliveryErrors] = createSignal<string[]>([]);
        const [deliveryNote, setDeliveryNote] = createSignal('');
        const showDelivery = (session: Session, value: { delivery: { revision: number; publicationEnabled: boolean; github: { remote: string; remoteURL: string; baseBranch: string; branchPrefix: string } | null } }) => { setDelivery({ session, revision: value.delivery.revision }); setDeliveryDraft(deliveryFromSettings(value.delivery)); };
        const loadDelivery = async () => {
          const session = props.session; if (deliveryBusy()) return;
          setDeliveryBusy(true); setDeliveryErrors([]); setDeliveryNote('');
          try {
            const value = await call<{ delivery: Parameters<typeof showDelivery>[1]['delivery'] }>(session, ({ rpc, options }) => rpc.getDelivery({}, options));
            if (props.session === session) showDelivery(session, value);
          } catch (error) { if (props.session === session) setDeliveryErrors([describeError(error, 'Could not load delivery settings.')]); }
          finally { setDeliveryBusy(false); }
        };
        const submitDelivery = async () => {
          const current = delivery(); if (!current || current.session !== props.session || deliveryBusy()) return;
          const problems = deliveryProblems(deliveryDraft()); setDeliveryNote('');
          if (problems.length) { setDeliveryErrors(problems); return; }
          const session = current.session; setDeliveryBusy(true); setDeliveryErrors([]);
          try {
            const value = await call<{ delivery: Parameters<typeof showDelivery>[1]['delivery'] }>(session, ({ rpc, options }) => rpc.saveDelivery(deliveryRequest(deliveryDraft(), current.revision), options));
            if (props.session === session) { showDelivery(session, value); setDeliveryNote(`Saved (revision ${value.delivery.revision}).`); }
          } catch (error) { if (props.session === session) setDeliveryErrors([describeError(error, 'Could not save delivery settings.')]); }
          finally { setDeliveryBusy(false); }
        };
        const editDelivery = <K extends keyof DeliveryDraft>(key: K, value: DeliveryDraft[K]) => setDeliveryDraft(current => ({ ...current, [key]: value }));
        // Publishing needs a second, explicit click that restates what will happen; nothing leaves the machine on the first click.
        const [confirmPublish, setConfirmPublish] = createSignal<string>();
        const [deliveryResult, setDeliveryResult] = createSignal<{ session: Session; id: string; text: string }>();
        const deliver = async (target: 'local' | 'github') => {
          const current = detail(); if (!current || current.session !== props.session || draftBusy()) return;
          const { session, run } = current;
          setDraftBusy(true); setDraftError(''); setDraftNote(''); setConfirmPublish(undefined); version++;
          try {
            const value = await call<{ run: DraftDetail; status: string; reason: string | null; paths: string[]; branch: string | null; commit: string | null; prUrl: string | null; reusedPR: boolean | null }>(session, ({ rpc, options }) => rpc.deliverDraft({ id: run.id, revision: run.revision, target }, options));
            if (props.session === session) { version++; apply(session, value.run); setDeliveryResult({ session, id: run.id, text: deliveryOutcome(value) }); }
          } catch (error) {
            if (props.session === session) { setDraftError(runActionError(error)); version++; await refresh(run.id); }
          } finally { setDraftBusy(false); }
        };
        const editRoute = <K extends keyof RouteDraft>(index: number, key: K, value: RouteDraft[K]) => setRoutes(list => list.map((route, i) => i === index ? { ...route, [key]: value } : route));
        const [reservations, setReservations] = createSignal<{ session: Session; runID: string; items: Reservation[] }>();
        const [reservationBusy, setReservationBusy] = createSignal(false);
        const [reservationErrors, setReservationErrors] = createSignal<string[]>([]);
        const [reservationNote, setReservationNote] = createSignal('');
        const [settleDrafts, setSettleDrafts] = createSignal(new Map<string, SettleDraft>());
        const settleDraft = (attemptID: string) => settleDrafts().get(attemptID) ?? emptySettle();
        const editSettle = (attemptID: string, key: keyof SettleDraft, value: string) => setSettleDrafts(current => new Map(current).set(attemptID, { ...(current.get(attemptID) ?? emptySettle()), [key]: value }));
        createEffect(on(() => currentRun()?.id, () => { setReservationErrors([]); setReservationNote(''); }, { defer: true }));
        const loadReservations = async () => {
          const run = currentRun(); if (!run || reservationBusy()) return;
          const session = props.session, runID = run.id;
          setReservationBusy(true); setReservationErrors([]); setReservationNote('');
          try {
            const value = await call<{ reservations: Reservation[] }>(session, ({ rpc, options }) => rpc.listReservations({ runID }, options));
            if (props.session === session) setReservations({ session, runID, items: value.reservations });
          } catch (error) { if (props.session === session) setReservationErrors([describeError(error, 'Could not load reservations.')]); }
          finally { setReservationBusy(false); }
        };
        // The backend answers with the run's updated list, which replaces the one shown.
        const settleReservation = async (attemptID: string) => {
          const run = currentRun(); if (!run || reservationBusy()) return;
          const session = props.session, runID = run.id, draft = settleDraft(attemptID), problems = settleProblems(draft);
          setReservationNote('');
          if (problems.length) { setReservationErrors(problems); return; }
          setReservationBusy(true); setReservationErrors([]);
          try {
            const value = await call<{ reservations: Reservation[] }>(session, ({ rpc, options }) => rpc.settleReservation(settleRequest(runID, attemptID, draft), options));
            if (props.session === session) { setReservations({ session, runID, items: value.reservations }); setSettleDrafts(current => { const next = new Map(current); next.delete(attemptID); return next; }); setReservationNote('Reservation settled.'); }
          } catch (error) { if (props.session === session) setReservationErrors([describeError(error, 'Could not settle the reservation.')]); }
          finally { setReservationBusy(false); }
        };
        const [rec, setRec] = createSignal<RecommendDraft>(emptyRecommendDraft());
        const [recResult, setRecResult] = createSignal<{ session: Session; value: Recommendation }>();
        const [recBusy, setRecBusy] = createSignal(false);
        const [recErrors, setRecErrors] = createSignal<string[]>([]);
        const editRec = <K extends keyof RecommendDraft>(key: K, value: RecommendDraft[K]) => setRec(current => ({ ...current, [key]: value }));
        const editScore = (index: number, key: keyof ScoreDraft, value: string) => setRec(current => ({ ...current, scores: current.scores.map((score, i) => i === index ? { ...score, [key]: value } : score) }));
        const submitRec = async () => {
          if (recBusy()) return;
          const session = props.session, draft = rec(), request = buildRecommendRequest(draft, currentRun()?.id ?? null);
          setRecResult(undefined);
          if (!request) { setRecErrors(recommendProblems(draft)); return; }
          setRecBusy(true); setRecErrors([]);
          try {
            const value = await call<Recommendation>(session, ({ rpc, options }) => rpc.recommendRoutes(request, options));
            if (props.session === session) setRecResult({ session, value });
          } catch (error) { if (props.session === session) setRecErrors([recommendError(error)]); }
          finally { setRecBusy(false); }
        };
        const candidateLine = (item: Candidate) => `${item.providerID} / ${item.id} / ${item.variant ?? 'default effort'} · vendor ${item.vendor} · estimated cost $${item.estimatedCash ?? 'unknown'} · worst-case reservation $${item.reservationGross ?? 'unknown'} · score ${item.score ?? 'unknown'} · price ${item.priceVerified ? 'marked verified' : 'not verified'}`;
        const otherRoutes = (value: Recommendation) => value.alternatives.filter(item => item.providerID !== value.selected?.providerID || item.id !== value.selected?.id || item.variant !== value.selected?.variant);
        createEffect(on(() => props.session, () => { void loadDrafts(); void loadPolicy(); void loadDelivery(); }));

        const [tab, setTab] = createSignal<TabId>('models');
        const primary = createMemo(() => can()?.approve ? 'approve' : can()?.accept ? 'accept' : can()?.run ? 'run' : can()?.resume ? 'resume' : null);
        const addableGroups = (mode: Mode) => {
          const items = (result() ?? []).filter(model => model.enabled && model.status !== 'deprecated').flatMap(model => [null, ...model.variants].map(variant => ({ model, variant, choice: { providerID: model.providerID, id: model.id, variant } as ModelChoice }))).filter(item => !chosen(mode).some(choice => same(choice, item.choice)));
          return [...new Set(items.map(item => item.model.providerID))].map(provider => [provider, items.filter(item => item.model.providerID === provider)] as const);
        };
        const addModel = (mode: Mode, key: string) => { const found = addableGroups(mode).flatMap(([, items]) => items).find(item => keyOf(item.choice) === key); if (found) setList(mode, [...chosen(mode), { ...found.choice, useFor: '' }]); };
        const moveTab = (event: KeyboardEvent) => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (!step) return;
          event.preventDefault(); const next = tabs[(tabs.findIndex(([id]) => id === tab()) + step + tabs.length) % tabs.length][0]; setTab(next); document.getElementById(`rl-tab-${next}`)?.focus();
        };
        createEffect(on([tab, selectedRunID, () => props.session], () => { if (tab() === 'spend') void loadBudget(); }, { defer: true }));
        const errorList = (items: () => string[]) => <Show when={items().length}><div class="rl-note n-bad" role="alert"><ul><For each={items()}>{problem => <li>{problem}</li>}</For></ul></div></Show>;

        return <section class="rl" aria-label="Relay">
          <style>{panelCss}</style>
          <header class="rl-top">
            <div class="rl-brand">
              <span class="rl-logo" aria-hidden="true">R</span><h2 class="rl-name">Relay</h2>
              <span class="rl-tag">Plan · Execute · Review</span>
            </div>
            <div class="rl-tabs" role="tablist" aria-label="Relay sections" onKeyDown={moveTab}>
              <For each={tabs}>{([id, label]) => <button type="button" role="tab" id={`rl-tab-${id}`} class="rl-tab" aria-selected={tab() === id ? 'true' : 'false'} aria-controls="rl-panel" tabindex={tab() === id ? 0 : -1} onClick={() => setTab(id)}>{label}</button>}</For>
            </div>
          </header>
          <div class="rl-body" role="tabpanel" id="rl-panel" aria-labelledby={`rl-tab-${tab()}`}>

            <Show when={tab() === 'run'}>
              <div class="rl-card">
                <textarea class="rl-in" rows="3" aria-label="Feature requirement" placeholder="Describe the feature you want built…" maxlength={10000} value={requirement()} onInput={event => setRequirement(event.currentTarget.value)} />
                <div class="rl-row"><span class="rl-hint">Starts from this project's latest commit.</span><button type="button" class="rl-btn pri" disabled={draftBusy() || !requirement().trim()} onClick={() => void saveDraft()}>{draftBusy() ? 'Working…' : 'Start'}</button></div>
              </div>
              <Show when={draftError()}><div class="rl-note n-bad" role="alert">{draftError()}</div></Show>
              <Show when={draftNote()}><div class="rl-note" role="status">{draftNote()}</div></Show>
              <div class="rl-row"><h3 class="rl-h">Runs</h3><button type="button" class="rl-btn sm ghost" aria-label="Refresh run list" title="Refresh run list" onClick={() => { setDraftError(''); void loadDrafts(); }}>↻</button></div>
              <Show when={drafts()?.session === props.session}>
                <Show when={drafts()?.runs.length} fallback={<p class="rl-empty">No runs yet. Describe a feature above and press Start.</p>}>
                  <div class="rl-list"><Index each={drafts()?.runs}>{run => <button type="button" class="rl-run" aria-label={`Open run: ${truncate(run().requirement, 60)}`} aria-current={selectedRunID() === run().id ? 'true' : undefined} disabled={draftBusy()} onClick={() => void openDraft(run().id)}>
                    <span class="rl-run-t">{truncate(run().requirement, 70)}</span>
                    <span class="rl-run-m"><span class={`rl-pill t-${stateTone(run().state)}`}>{stateLabel(run().state)}{run().stopRequested ? ' · stopping' : ''}</span><span>{run().baseCommit.slice(0, 7)} · rev {run().revision}</span></span>
                  </button>}</Index></div>
                </Show>
              </Show>
              <Show when={currentRun()}>{run => <div class="rl-card rl-detail">
                <div class="rl-row"><span class={`rl-pill t-${stateTone(run().state)}`} role="status">{stateLabel(run().state)}{run().stopRequested ? ' · stopping' : ''}</span><span class="rl-hint">revision {run().revision}</span></div>
                <Show when={stageIndex(run().state) !== null}><ol class="rl-steps" aria-label="Progress"><For each={stages}>{(name, index) => <li class={index() < stageIndex(run().state)! ? 'd' : index() === stageIndex(run().state) ? 'c' : ''} aria-current={index() === stageIndex(run().state) ? 'step' : undefined}><i /><span>{name}</span></li>}</For></ol></Show>
                <details class="rl-req"><summary>{truncate(run().requirement, 90)}</summary><p>{run().requirement}</p></details>
                <Show when={run().attention}>{reason => <div class="rl-note n-warn" role="alert"><strong>Needs attention: {attentionTitle(reason())}</strong><span>{attentionExplanation(reason())}</span></div>}</Show>
                <Show when={run().approval}><span class="rl-hint">Plan approved ({run().approval}).</span></Show>
                <Show when={run().clarification.length}><div style={{ display: 'grid', gap: '8px' }}>
                  <strong>Questions</strong>
                  <Index each={run().clarification}>{question => <Show when={question().answer === null && !run().stopRequested} fallback={<p class="rl-hint">{question().question}<br />Answer: {question().answer ?? 'not answered'}</p>}>
                    <label class="rl-f">{question().question}<textarea class="rl-in" value={answerText()[question().id] ?? ''} onInput={event => setAnswerText({ ...answerText(), [question().id]: event.currentTarget.value })} /></label>
                  </Show>}</Index>
                  <Show when={!run().stopRequested && run().clarification.some(question => question.answer === null)}><div><button type="button" class="rl-btn pri" disabled={draftBusy() || !run().clarification.some(question => question.answer === null && (answerText()[question.id] ?? '').trim())} onClick={() => void act('answer')}>Save answers</button></div></Show>
                </div></Show>
                <Show when={run().planJson}>{plan => <details class="rl-mini"><summary>View plan</summary><pre class="rl-pre" tabindex="0" aria-label="Proposed plan (JSON, read only)">{plan()}</pre></details>}</Show>
                <Show when={run().reviews.length}><div class="rl-actions"><Index each={run().reviews}>{(review, index) => <span class={`rl-pill ${review().verdict === 'approve' ? 't-ok' : 't-warn'}`}>Review {index + 1}: {verdictLabel(review().verdict)} · {review().blocking} blocking · {review().advisory} advisory</span>}</Index></div></Show>
                <div class="rl-actions">
                  <Show when={can()?.approve}><button type="button" class={`rl-btn ${primary() === 'approve' ? 'pri' : ''}`} aria-describedby="approve-note" disabled={draftBusy()} onClick={() => void act('approve')}>Approve plan</button></Show>
                  <Show when={can()?.accept}><button type="button" class={`rl-btn ${primary() === 'accept' ? 'pri' : ''}`} disabled={draftBusy()} onClick={() => void act('accept')}>Accept</button></Show>
                  <Show when={can()?.run}><button type="button" class={`rl-btn ${primary() === 'run' ? 'pri' : ''}`} disabled={draftBusy()} onClick={() => void act('run')}>Run</button></Show>
                  <Show when={can()?.resume}><button type="button" class={`rl-btn ${primary() === 'resume' ? 'pri' : ''}`} disabled={draftBusy()} onClick={() => void act('resume')}>Resume</button></Show>
                  <Show when={can()?.runAutonomously}><button type="button" class="rl-btn" aria-describedby="autonomous-note" disabled={draftBusy()} onClick={() => void act('auto')}>Run autonomously</button></Show>
                  <Show when={can()?.stop}><button type="button" class="rl-btn dng" disabled={draftBusy()} onClick={() => void act('stop')}>Stop</button></Show>
                </div>
                <Show when={can()?.approve}><span class="rl-hint" id="approve-note">Approves exactly this plan{run().planHash ? ` (hash ${run().planHash!.slice(0, 12)})` : ''}, then choose Run.</span></Show>
                <Show when={can()?.runAutonomously}><span class="rl-hint" id="autonomous-note"><strong>Autonomous:</strong> {autonomousNote}</span></Show>
                <details class="rl-menu"><summary class="rl-btn sm">More ▾</summary><div class="rl-menu-body">
                  <button type="button" class="rl-btn sm" onClick={() => { setDraftError(''); void refresh(run().id); }}>Refresh run</button>
                  <button type="button" class="rl-btn sm" onClick={() => void loadExport()}>Export preview</button>
                  <button type="button" class="rl-btn sm" disabled={draftBusy()} onClick={() => void deliver('local')}>Export summary to disk</button>
                  <Show when={canPublish(run().state)}><button type="button" class="rl-btn sm" aria-describedby="publish-note" disabled={draftBusy()} onClick={() => setConfirmPublish(run().id)}>Publish draft pull request…</button></Show>
                </div></details>
                <Show when={canPublish(run().state) && confirmPublish() === run().id}><div class="rl-note n-warn" role="group" aria-label="Confirm publishing">
                  <span id="publish-note">{publishWarning}</span>
                  <div class="rl-actions" style={{ 'margin-top': '6px' }}><button type="button" class="rl-btn pri" disabled={draftBusy()} onClick={() => void deliver('github')}>Push the branch and open a draft pull request</button><button type="button" class="rl-btn" onClick={() => setConfirmPublish(undefined)}>Cancel</button></div>
                </div></Show>
                <Show when={deliveryResult()?.session === props.session && deliveryResult()?.id === run().id}><div class="rl-note n-ok" role="status">{deliveryResult()!.text}</div></Show>
                <Show when={exportPreview()?.session === props.session && exportPreview()?.id === run().id && exportPreview()?.revision === run().revision}><div><strong id="export-heading">Export preview</strong> <span class="rl-hint">read only; check for sensitive information before sharing</span><pre class="rl-pre" tabindex="0" aria-labelledby="export-heading">{exportPreview()?.text}</pre></div></Show>
                <Acc title="Reservations" sub="budget held per request" onToggle={open => { if (open) void loadReservations(); }}>
                  <details class="rl-mini"><summary>How a reservation is released</summary><p>{reservationWarning}</p></details>
                  {errorList(reservationErrors)}
                  <Show when={reservationNote()}><div class="rl-note n-ok" role="status">{reservationNote()}</div></Show>
                  <Show when={reservations()?.session === props.session && reservations()?.runID === run().id} fallback={<p class="rl-hint">{reservationBusy() ? 'Loading…' : 'Open to load.'}</p>}>
                    <Show when={reservations()?.items.length} fallback={<span class="rl-hint">This run has no reservations.</span>}><ul class="rl-plain"><Index each={reservations()?.items}>{item => <li class="rl-card-row">
                      <span>Attempt {item().attemptID.slice(0, 8)} · {item().period}</span>
                      <span>Reserved ${item().reservedUsd} · {item().settledUsd === null ? 'pending' : `settled $${item().settledUsd}`}</span>
                      <Show when={item().settledUsd !== null}><span class="rl-hint">Evidence: {evidenceLabel(item().evidenceKind)}{item().evidenceReference ? ` · ${item().evidenceReference}` : ''}</span></Show>
                      <Show when={item().settledUsd === null}><fieldset>
                        <legend>Settle this reservation</legend>
                        <Field label="Settle with"><select class="rl-in" onChange={event => editSettle(item().attemptID, 'kind', event.currentTarget.value)}><option value="" selected={settleDraft(item().attemptID).kind === ''}>Choose evidence</option><option value="provider_gross_charge" selected={settleDraft(item().attemptID).kind === 'provider_gross_charge'}>Provider’s own charge</option><option value="confirmed_not_dispatched" selected={settleDraft(item().attemptID).kind === 'confirmed_not_dispatched'}>Confirmed never sent</option></select></Field>
                        <Field label="Actual USD charged by the provider"><input class="rl-in" inputmode="decimal" disabled={settleDraft(item().attemptID).kind === 'confirmed_not_dispatched'} value={settleDraft(item().attemptID).kind === 'confirmed_not_dispatched' ? '0' : settleDraft(item().attemptID).actualUsd} onInput={event => editSettle(item().attemptID, 'actualUsd', event.currentTarget.value)} /></Field>
                        <Field label="Reference (required): charge id, or what shows nothing was sent"><input class="rl-in" maxlength={512} aria-required="true" value={settleDraft(item().attemptID).reference} onInput={event => editSettle(item().attemptID, 'reference', event.currentTarget.value)} /></Field>
                        <div><button type="button" class="rl-btn sm" disabled={reservationBusy()} onClick={() => void settleReservation(item().attemptID)}>Settle</button></div>
                      </fieldset></Show>
                    </li>}</Index></ul></Show>
                  </Show>
                </Acc>
              </div>}</Show>
            </Show>

            <Show when={tab() === 'models'}>
              <p class="rl-hint">Type <strong>/relay</strong> and your message in the chat. Relay picks Plan, Execute or Review for it, switches the chat to a model you chose for that mode, and sends your message. These settings are the same in every project.</p>
              <Show when={!response.error} fallback={<div class="rl-note n-bad" role="alert">Could not load the settings. Check the server connection and try again.</div>}>
                <For each={modeCards}>{([mode, blurb]) => <div class="rl-card">
                  <div><strong class="rl-role">{modeLabel(mode)}</strong><span class="rl-hint">{blurb}</span></div>
                  <For each={chosen(mode)}>{choice => <div class="rl-pick">
                    <span class={`rl-chip ${unavailable(choice) ? 'bad' : ''}`}>
                      <span class="rl-chip-t" title={`${choice.providerID} / ${choice.id}`}>{choice.id}{choice.variant ? ` · ${choice.variant}` : ''}</span>
                      <Show when={unavailable(choice)}><small>unavailable</small></Show>
                      <button type="button" class="rl-x" aria-label={`Remove ${choice.providerID} / ${choice.id} / ${choice.variant ?? 'default'} from ${modeLabel(mode)}`} disabled={saving()} onClick={() => setList(mode, chosen(mode).filter(item => !same(item, choice)))}>×</button>
                    </span>
                    <input class="rl-in" type="text" maxlength={USE_FOR_MAX} aria-label={`What ${choice.id} is for in ${modeLabel(mode)}`} placeholder="Use it for… (your own words, optional)" value={choice.useFor} disabled={saving()}
                      onChange={event => { const useFor = event.currentTarget.value.replace(/\s+/g, ' ').trim(); if (useFor !== choice.useFor) setList(mode, chosen(mode).map(item => same(item, choice) ? { ...item, useFor } : item)); }} />
                  </div>}</For>
                  <Show when={!chosen(mode).length}><span class="rl-hint">None chosen yet. /relay leaves the chat as it is for {modeLabel(mode)}.</span></Show>
                  <Show when={chosen(mode).length > 1}><span class="rl-hint">Several models: the decider picks the one whose line fits your message. When no line fits clearly, the chat keeps its model if it is in this list; otherwise the first is used. With no lines written, the first is always used.</span></Show>
                  <select class="rl-in" aria-label={`Add a model for ${modeLabel(mode)}`} disabled={saving() || response.loading} onChange={event => { const key = event.currentTarget.value; event.currentTarget.value = ''; addModel(mode, key); }}>
                    <option value="">+ Add a model…</option>
                    <For each={addableGroups(mode)}>{([provider, items]) => <optgroup label={provider}><For each={items}>{item => <option value={keyOf(item.choice)}>{item.model.name} · {item.variant ?? 'default effort'}{item.model.capabilities.tools ? '' : ' · no tools'}</option>}</For></optgroup>}</For>
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
                  <span class="rl-hint" aria-live="polite">{decisionLine(data()?.relay.decisions[0])}</span>
                  <span class="rl-hint">{data() ? checksLine(data()!.relay.checks) : ''}</span>
                  <span class="rl-hint">{switchHint}</span>
                </div>
                <Acc title="Review rules" sub="added to every review"><pre class="rl-pre">{reviewRules}</pre></Acc>
                <div class="rl-row"><span class="rl-hint" aria-live="polite">{response.loading ? 'Loading…' : `${result()?.length ?? 0} models available`}{saving() ? ' · saving…' : ''}</span><button type="button" class="rl-btn sm" disabled={response.loading} onClick={() => void refetch()}>Refresh</button></div>
                <Show when={saveError()}><div class="rl-note n-bad" role="alert">{saveError()}</div></Show>
              </Show>
            </Show>

            <Show when={tab() === 'spend'}>
              <div class="rl-card">
                <div class="rl-row"><h3 class="rl-h">Budget</h3><button type="button" class="rl-btn sm ghost" aria-label="Reload budget" title="Reload budget" disabled={budgetBusy()} onClick={() => void loadBudget()}>↻</button></div>
                <Show when={budgetError()}><div class="rl-note n-bad" role="alert">{budgetError()}</div></Show>
                <Show when={currentBudget()} fallback={<p class="rl-hint">{budgetBusy() ? 'Loading…' : 'Budget not loaded yet.'}</p>}>{value => <Show when={value().available} fallback={<p class="rl-hint">{budgetBackendNote(null)}</p>}>
                  <Meter label="Monthly" usage={value().monthlyUsage} limit={value().monthly?.amount ?? null} />
                  <div class="rl-inline"><input class="rl-in" inputmode="decimal" aria-label="Monthly limit (USD)" placeholder="Monthly limit, USD" value={monthlyLimit()} onInput={event => setMonthlyLimit(event.currentTarget.value)} /><button type="button" class="rl-btn sm" disabled={budgetBusy()} onClick={() => void loadBudget('monthly')}>Save</button></div>
                  <Show when={selectedRunID()} fallback={<p class="rl-hint">Open a run to give it its own limit.</p>}>
                    <Meter label="Open run" usage={value().featureUsage} limit={value().feature?.amount ?? null} />
                    <div class="rl-inline"><input class="rl-in" inputmode="decimal" aria-label="Open run limit (USD)" placeholder="Run limit, USD" value={featureLimit()} onInput={event => setFeatureLimit(event.currentTarget.value)} /><button type="button" class="rl-btn sm" disabled={budgetBusy()} onClick={() => void loadBudget('feature')}>Save</button></div>
                  </Show>
                  <details class="rl-mini"><summary>Where the budget is kept</summary><p>{budgetBackendNote(value().backend)} The monthly limit is shared by Relay on this host; the run limit applies to the open run. Period: UTC {value().period}.</p></details>
                </Show>}</Show>
              </div>
              <Show when={policy()?.session === props.session} fallback={<div class="rl-card"><p class="rl-hint">{policyBusy() ? 'Loading settings…' : 'Settings not loaded.'}</p>{errorList(policyErrors)}<div><button type="button" class="rl-btn sm" disabled={policyBusy()} onClick={() => void loadPolicy()}>Reload settings</button></div></div>}>
                <div class="rl-card">
                  <h3 class="rl-h">Coder permission</h3>
                  <label class="rl-sw warn"><input type="checkbox" aria-describedby="coder-warning" checked={coderEnabled()} onChange={event => setCoderEnabled(event.currentTarget.checked)} /><span>Let the coder edit files and run commands</span></label>
                  <p class="rl-hint">Runs in a separate git worktree, but that is not a sandbox: commands use your account’s permissions.</p>
                  <details class="rl-mini"><summary>Read the full warning</summary><p id="coder-warning" class="rl-hint strong">{coderWarning}</p></details>
                </div>
                <div class="rl-card">
                  <div class="rl-row"><h3 class="rl-h">Model prices</h3><button type="button" class="rl-btn sm" onClick={() => setRoutes(list => [...list, emptyRoute()])}>+ Add</button></div>
                  <p class="rl-hint">Enter what each model costs, from the provider’s own pricing page. Without a price, requests are refused.</p>
                  <Show when={routes().length} fallback={<p class="rl-empty">No prices yet.</p>}>
                    <Index each={routes()}>{(route, index) => <details class="rl-acc" ref={element => { if (!route().providerID && !route().id) element.open = true; }}>
                      <summary><span class="rl-sumtext"><span class="rl-sumt">{route().providerID || route().id ? `${route().providerID} / ${route().id}` : `Route ${index + 1}`}</span><span class="rl-sub">{route().input && route().output ? `$${route().input} in · $${route().output} out per 1M tokens` : 'incomplete'}</span></span></summary>
                      <div class="rl-acc-body">
                        <div class="rl-grid2"><For each={routeFields}>{([key, label, mode]) => <label class={`rl-f ${key === 'sourceURL' || key === 'checkedAt' ? 'wide' : ''}`}>{label}<input class="rl-in" inputmode={mode} value={route()[key] as string} onInput={event => editRoute(index, key, event.currentTarget.value)} /></label>}</For>
                          <Field label="Billing"><select class="rl-in" onChange={event => editRoute(index, 'billing', event.currentTarget.value)}><option value="" selected={route().billing === ''}>Choose billing</option><For each={billingModes}>{mode => <option value={mode} selected={route().billing === mode}>{billingLabels[mode]}</option>}</For></select></Field>
                          <Field label="Evidence"><select class="rl-in" onChange={event => editRoute(index, 'kind', event.currentTarget.value)}><option value="" selected={route().kind === ''}>Choose evidence</option><For each={evidenceKinds}>{kind => <option value={kind} selected={route().kind === kind}>{kindLabels[kind]}</option>}</For></select></Field>
                        </div>
                        <Show when={route().conditions.length}><span class="rl-hint">Conditions saved with this route: {route().conditions.join('; ')}. A dollar budget cannot bound a rate with conditions.</span></Show>
                        <div><button type="button" class="rl-btn sm dng" aria-label={`Remove route ${index + 1}`} onClick={() => setRoutes(list => list.filter((_, i) => i !== index))}>Remove route</button></div>
                      </div>
                    </details>}</Index>
                  </Show>
                  <Field label="Planned output tokens per request"><input class="rl-in" inputmode="numeric" value={maxTokens()} onInput={event => setMaxTokens(event.currentTarget.value)} /></Field>
                  <p class="rl-hint">Whole number, 1 to 10,000,000. Used for estimates only; budgets still reserve each request at the model’s full output limit.</p>
                </div>
                <div class="rl-sticky">
                  {errorList(policyErrors)}
                  <Show when={policyNote()}><div class="rl-note n-ok" role="status">{policyNote()}</div></Show>
                  <button type="button" class="rl-btn pri" disabled={policyBusy()} onClick={() => void submitPolicy()}>{policyBusy() ? 'Working…' : 'Save permission & prices'}</button>
                  <span class="rl-hint">Saving replaces this project’s whole spending policy.</span>
                </div>
              </Show>
            </Show>

            <Show when={tab() === 'more'}>
              <Acc title="Delivery" sub="draft pull requests">
                <p class="rl-hint">Exporting a run summary needs no setup. Publishing a draft pull request stays off until you authorize one remote for this project.</p>
                {errorList(deliveryErrors)}
                <Show when={deliveryNote()}><div class="rl-note n-ok" role="status">{deliveryNote()}</div></Show>
                <Show when={delivery()?.session === props.session} fallback={<div><button type="button" class="rl-btn sm" disabled={deliveryBusy()} onClick={() => void loadDelivery()}>Load delivery settings</button></div>}>
                  <label class="rl-sw"><input type="checkbox" aria-describedby="publish-setting-note" checked={deliveryDraft().publicationEnabled} onChange={event => editDelivery('publicationEnabled', event.currentTarget.checked)} /><span>Allow publishing draft pull requests</span></label>
                  <details class="rl-mini"><summary>Read what publishing does</summary><p id="publish-setting-note" class="rl-hint strong">{publishWarning}</p></details>
                  <div class="rl-grid2">
                    <Field label="Remote name"><input class="rl-in" value={deliveryDraft().remote} onInput={event => editDelivery('remote', event.currentTarget.value)} /></Field>
                    <Field label="Base branch"><input class="rl-in" value={deliveryDraft().baseBranch} onInput={event => editDelivery('baseBranch', event.currentTarget.value)} /></Field>
                    <label class="rl-f wide">Remote URL, exactly as git shows it (no credentials)<input class="rl-in" value={deliveryDraft().remoteURL} onInput={event => editDelivery('remoteURL', event.currentTarget.value)} /></label>
                    <label class="rl-f wide">Branch prefix (ends with /)<input class="rl-in" value={deliveryDraft().branchPrefix} onInput={event => editDelivery('branchPrefix', event.currentTarget.value)} /></label>
                  </div>
                  <div><button type="button" class="rl-btn pri" disabled={deliveryBusy()} onClick={() => void submitDelivery()}>{deliveryBusy() ? 'Working…' : 'Save delivery settings'}</button></div>
                </Show>
              </Acc>

              <Acc title="Observed usage" sub="what the host recorded">
                <p class="rl-hint">Partial host estimates from this plugin’s sessions in this project. They are not provider bills.</p>
                <details class="rl-mini"><summary>What “partial” means</summary><p>Current assistant messages from this plugin’s sessions in this project. Older, auxiliary and failed requests may be missing. Dates use message creation time, not verified request start. Host estimates are not provider bills; cash and credits are unknown.</p></details>
                <div class="rl-inline"><input class="rl-in" type="month" aria-label="Month" value={month()} onInput={event => setMonth(event.currentTarget.value)} /><button type="button" class="rl-btn sm" disabled={usageLoading() || !month()} onClick={() => void loadUsage()}>{usageLoading() ? 'Loading…' : 'Show'}</button></div>
                <span class="rl-hint">Reporting timezone: {timeZone}</span>
                <Show when={usageError()}><div class="rl-note n-bad" role="alert">{usageError()}</div></Show>
                <Show when={currentUsage()}>{report => <div style={{ display: 'grid', gap: '8px' }}>
                  <span>Month: ${report().summary.total.gross.knownUsd} known; {report().summary.total.gross.unknownCount} amounts unknown.</span>
                  <Show when={month() === today().slice(0, 7)}><span>Today: ${report().summary.days.find(day => day.date === today())?.gross.knownUsd ?? '0'} known; {report().summary.days.find(day => day.date === today())?.gross.unknownCount ?? 0} unknown.</span></Show>
                  <span class="rl-hint">Messages observed: {report().summary.total.attempts}. Sessions unavailable: {report().coverage.unavailableSessions}; messages skipped: {report().coverage.skippedMessages}{report().coverage.truncated ? '; session scan truncated' : ''}.</span>
                  <table><caption>Daily observed host estimates (partial)</caption><thead><tr><th scope="col">Date</th><th scope="col">Known USD</th><th scope="col">Unknown</th></tr></thead><tbody><For each={report().summary.days}>{day => <tr><th scope="row">{day.date}</th><td>{day.gross.knownUsd}</td><td>{day.gross.unknownCount}</td></tr>}</For></tbody></table>
                  <For each={['provider', 'model', 'effort', 'role'] as const}>{group => <details class="rl-mini"><summary>By {group === 'effort' ? 'reported variant' : group}</summary><ul class="rl-plain"><For each={report().summary.breakdown[group]}>{item => <li class="rl-hint">{item.key}: ${item.gross.knownUsd} known, {item.gross.unknownCount} unknown</li>}</For></ul></details>}</For>
                </div>}</Show>
              </Acc>

              <Acc title="Route recommendations" sub="estimates, never automatic">
                <p class="rl-hint">Ranks the routes you selected by estimated cost for a workload you describe. Nothing is switched for you.</p>
                <details class="rl-mini"><summary>How this works</summary><p>{recommendationNote} Only routes you selected for the role and that have a recorded rate are ranked, by estimated cost for the workload below. Rates come from Model prices. A route is excluded, never guessed, when something it needs is missing.</p></details>
                <div class="rl-grid2">
                  <Field label="Role"><select class="rl-in" onChange={event => editRec('role', event.currentTarget.value)}><For each={recommendRoles}>{role => <option value={role} selected={rec().role === role}>{role}</option>}</For></select></Field>
                  <Field label="Minimum score"><input class="rl-in" inputmode="decimal" value={rec().minimumScore} onInput={event => editRec('minimumScore', event.currentTarget.value)} /></Field>
                  <label class="rl-f wide">Benchmark index version (your scores must state this exact version)<input class="rl-in" value={rec().indexVersion} onInput={event => editRec('indexVersion', event.currentTarget.value)} /></label>
                </div>
                <Index each={rec().scores}>{(score, index) => <fieldset>
                  <legend>Score {index + 1}</legend>
                  <For each={scoreFields}>{([key, label, mode]) => <Field label={label}><input class="rl-in" inputmode={mode} value={score()[key]} onInput={event => editScore(index, key, event.currentTarget.value)} /></Field>}</For>
                  <div><button type="button" class="rl-btn sm dng" aria-label={`Remove score ${index + 1}`} onClick={() => editRec('scores', rec().scores.filter((_, i) => i !== index))}>Remove score</button></div>
                </fieldset>}</Index>
                <div><button type="button" class="rl-btn sm" onClick={() => editRec('scores', [...rec().scores, emptyScore()])}>+ Add score</button></div>
                <div class="rl-grid2">
                  <Field label="Input tokens"><input class="rl-in" inputmode="numeric" value={rec().inputTokens} onInput={event => editRec('inputTokens', event.currentTarget.value)} /></Field>
                  <Field label="Output tokens"><input class="rl-in" inputmode="numeric" value={rec().outputTokens} onInput={event => editRec('outputTokens', event.currentTarget.value)} /></Field>
                  <label class="rl-f wide">Remaining budget (USD)<input class="rl-in" inputmode="decimal" value={rec().remainingBudget} onInput={event => editRec('remainingBudget', event.currentTarget.value)} /></label>
                </div>
                <label class="rl-sw"><input type="checkbox" checked={rec().image} onChange={event => editRec('image', event.currentTarget.checked)} /><span>Needs image input</span></label>
                <label class="rl-sw"><input type="checkbox" checked={rec().tools} onChange={event => editRec('tools', event.currentTarget.checked)} /><span>Needs tool use</span></label>
                <Show when={rec().role === 'reviewer'}><span class="rl-hint">{currentRun() ? `Vendors that already worked on the open run (${truncate(currentRun()!.requirement, 40)}) are excluded.` : 'No run is open, so no vendor is excluded. Open the run first to require an independent vendor.'}</span></Show>
                <div><button type="button" class="rl-btn pri" disabled={recBusy()} onClick={() => void submitRec()}>{recBusy() ? 'Working…' : 'Estimate route costs'}</button></div>
                {errorList(recErrors)}
                <Show when={recResult()?.session === props.session && recResult()}>{result => <div aria-live="polite" style={{ display: 'grid', gap: '8px' }}>
                  <span class="rl-hint">Based on role selection revision {result().value.selectionRevision} and rate catalog {result().value.snapshotID.slice(0, 12)}. An estimate for the workload you entered, not a bill.</span>
                  <Show when={result().value.selected} fallback={<strong>No route meets every requirement.</strong>}>{item => <div class="rl-card-row"><strong>Lowest estimated cost among routes that qualify</strong><span>{candidateLine(item())}</span></div>}</Show>
                  <Show when={otherRoutes(result().value).length}><div><strong>Other qualifying routes</strong><ul class="rl-plain"><For each={otherRoutes(result().value)}>{item => <li class="rl-card-row">{candidateLine(item)}</li>}</For></ul></div></Show>
                  <Show when={result().value.excluded.length}><div><strong>Excluded routes</strong><ul class="rl-plain"><For each={result().value.excluded}>{item => <li class="rl-card-row">{item.providerID} / {item.id} / {item.variant ?? 'default effort'}<ul class="rl-plain"><For each={item.reasons}>{reason => <li class="rl-hint">{exclusionExplanation(reason)} ({reason})</li>}</For></ul></li>}</For></ul></div></Show>
                </div>}</Show>
              </Acc>

              <Acc title="Monthly cost scenarios" sub="your own estimates">
                <p class="rl-hint">Compare an API workflow with a subscription, using your own numbers for the same amount of work.</p>
                <details class="rl-mini"><summary>What this does and does not include</summary><p>Include all planner, coder, reviewer and retry API charges. Enter subscription overage and independent review separately. These are scenarios, not bills or proof of equivalent quality; credits, allowances, taxes and other benefits are not included. Partial observed estimates cannot establish your total bill; use 0 only when appropriate.</p></details>
                <div class="rl-grid2">
                  <Field label="API workflow (USD)"><input class="rl-in" inputmode="decimal" value={apiEstimate()} onInput={event => setApiEstimate(event.currentTarget.value)} /></Field>
                  <Field label="Subscription fee (USD)"><input class="rl-in" inputmode="decimal" value={fee()} onInput={event => setFee(event.currentTarget.value)} /></Field>
                  <Field label="Subscription overage (USD)"><input class="rl-in" inputmode="decimal" value={overage()} onInput={event => setOverage(event.currentTarget.value)} /></Field>
                  <Field label="Independent review (USD)"><input class="rl-in" inputmode="decimal" value={externalReview()} onInput={event => setExternalReview(event.currentTarget.value)} /></Field>
                </div>
                <Show when={currentUsage()}><div><button type="button" class="rl-btn sm" onClick={() => setApiEstimate(currentUsage()!.summary.total.gross.knownUsd)}>Use the partial observed estimate</button></div></Show>
                <Show when={currentUsage()}><span class="rl-hint">The observed estimate may omit requests and unknown amounts; it cannot establish your total API bill.</span></Show>
                <Show when={scenario()} fallback={<span class="rl-hint">Enter nonnegative USD amounts in every field to compare.</span>}>{value => <div aria-live="polite" class="rl-card-row">
                  <span>Replace subscription with API workflow: ${value().apiOnlyUsd}</span>
                  <span>Keep subscription and use API workflow: ${value().keepSubscriptionTotalUsd} total; ${value().keepSubscriptionIncrementalUsd} incremental</span>
                  <span>Subscription workflow plus overage and independent review: ${value().nativeSubscriptionUsd}</span>
                </div>}</Show>
              </Acc>

              <Acc title="Model catalog" sub="prices and capabilities">
                <div class="rl-row"><button type="button" class="rl-btn sm" disabled={priceLoading()} onClick={() => void loadPrices()}>{priceLoading() ? 'Loading prices…' : 'Load OpenRouter prices'}</button>
                  <select class="rl-in" style={{ width: 'auto' }} aria-label="Sort models" value={modelSort()} onChange={event => setModelSort(event.currentTarget.value as 'provider' | 'input' | 'output')}><option value="provider">By provider</option><option value="input">By input price</option><option value="output">By output price</option></select></div>
                <span class="rl-hint">Requests the public OpenRouter catalog. Rates are estimates, not budget limits; unknown prices sort last and sorting never selects a model.</span>
                <Show when={prices()?.session === props.session}><span class="rl-hint">OpenRouter catalog: {prices()?.status}, checked {prices()?.checkedAt}. <a href="https://openrouter.ai/docs/api/api-reference/models/get-models" target="_blank" rel="noreferrer">Source</a></span></Show>
                <Show when={priceError()}><div class="rl-note n-bad" role="alert">{priceError()}</div></Show>
                <ul class="rl-plain"><For each={sortedModels()}>{model => <li class="rl-card-row">
                  <strong>{model.name}</strong>
                  <span class="rl-hint">{model.providerID} / {model.id}</span>
                  <Show when={priceFor(model)} fallback={<span class="rl-hint">Price unavailable</span>}>{price => <span class="rl-hint">OpenRouter base rate: {price().inputPerMillionUsd === null ? 'unknown' : `$${price().inputPerMillionUsd}`} in / {price().outputPerMillionUsd === null ? 'unknown' : `$${price().outputPerMillionUsd}`} out per 1M{price().conditional ? ' · conditional rates apply' : ''}{price().extraPriceFields.length ? ' · other price fields apply' : ''}</span>}</Show>
                  <span class="rl-hint">{model.enabled ? model.status : 'Disabled'} · {model.capabilities.input.includes('image') ? 'Image input' : 'Text input'} · {model.capabilities.tools ? 'Tools' : 'No tools'}{model.variants.length ? ` · ${model.variants.join(', ')}` : ''}</span>
                </li>}</For></ul>
              </Acc>

              <Acc title="Intelligence index" sub="optional benchmark data">
                <p class="rl-hint">Optional: set ARTIFICIAL_ANALYSIS_API_KEY in the OpenCode server environment and load your own data. Scores are a separate catalog: model and effort matches are not verified and are never used for routing.</p>
                <details class="rl-mini"><summary>Terms</summary><p>The free API is for internal use; check your access terms before sharing. Data: <a href="https://artificialanalysis.ai/" target="_blank" rel="noreferrer">Artificial Analysis</a>.</p></details>
                <div><button type="button" class="rl-btn sm" disabled={intelligenceLoading()} onClick={() => void loadIntelligence()}>{intelligenceLoading() ? 'Loading index…' : 'Load intelligence index'}</button></div>
                <Show when={intelligenceError()}><div class="rl-note n-bad" role="alert">{intelligenceError()}</div></Show>
                <Show when={intelligence()?.session === props.session}><div style={{ display: 'grid', gap: '8px' }}>
                  <span class="rl-hint">Index v{intelligence()?.indexVersion} (major/minor; patch unspecified). Tested effort is not verified.</span>
                  <Field label="Search index"><input class="rl-in" value={intelligenceSearch()} onInput={event => setIntelligenceSearch(event.currentTarget.value)} /></Field>
                  <details class="rl-mini"><summary>{visibleIntelligence().length} index entries, highest first</summary><ul class="rl-plain"><For each={visibleIntelligence()}>{item => <li class="rl-hint">{item.name} · {item.creator} · {item.score === null ? 'score unknown' : item.score} ({item.slug})</li>}</For></ul></details>
                  <Show when={result()?.length}>
                    <fieldset>
                      <legend>Compare a model and an index entry</legend>
                      <span class="rl-hint">You choose both. This is an unverified pairing: the source’s tested model version and effort may differ. It is not a recommendation or a saved selection.</span>
                      <Field label="OpenCode model and effort"><select class="rl-in" value={comparisonModel()?.session === props.session ? comparisonModel()?.value : ''} onChange={event => setComparisonModel({ session: props.session, value: event.currentTarget.value })}><option value="">Choose a model</option><For each={result()}>{model => <For each={[null, ...model.variants] as (string | null)[]}>{variant => <option value={JSON.stringify([model.providerID, model.id, variant])}>{model.providerID} / {model.name} / {variant ?? 'default'}{!model.enabled || model.status === 'deprecated' ? ' (unavailable)' : ''}</option>}</For>}</For></select></Field>
                      <Field label="Artificial Analysis entry"><select class="rl-in" value={comparisonIndex()?.session === props.session ? comparisonIndex()?.value : ''} onChange={event => setComparisonIndex({ session: props.session, value: event.currentTarget.value })}><option value="">Choose an index entry</option><For each={visibleIntelligence()}>{item => <option value={item.id}>{item.creator} / {item.name}</option>}</For></select></Field>
                      <Show when={comparedChoice() && comparedEntry()}><div class="rl-card-row"><span>Selected index: {comparedEntry()?.score ?? 'unknown'} (v{intelligence()?.indexVersion}; effort unverified).</span><span>OpenRouter input / output base price per 1M: {priceFor(comparedChoice()!.model)?.inputPerMillionUsd ?? 'unknown'} / {priceFor(comparedChoice()!.model)?.outputPerMillionUsd ?? 'unknown'} USD. Other charges and conditions may apply.</span></div></Show>
                    </fieldset>
                  </Show>
                </div></Show>
              </Acc>
            </Show>

          </div>
        </section>;
      },
    });

    // The pill above each chat box: whether every message in that chat goes through Relay, the row that turns it, and the chat's last choice.
    // shortcut: it asks the server again every 5 seconds for the chats shown in the last 15; a server event would do better if OpenCode gives plugins one.
    const [chats, setChats] = createSignal<Record<string, { on: boolean; last: Decision | null }>>({});
    const seen = new Map<string, { session: MountedSession; at: number }>();
    const relayOf = (session: MountedSession) => ({ rpc: session.server.client.rpc(FeaturePilot), options: { location: { directory: session.directory } } });
    const refresh = async (session: MountedSession) => {
      try {
        const { rpc, options } = relayOf(session);
        const value = await rpc.getRelayChat({ sessionID: session.id }, options) as { on: boolean; last: Decision | null };
        setChats(previous => ({ ...previous, [session.key]: value }));
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
          return {
            label: view.label, tone: view.tone, title: 'Relay',
            rows: view.rows.map(row => ({ id: row.id, label: row.label, tone: row.tone, run: row.id === 'toggle' ? () => void turn(session, !state.on) : undefined })),
          };
        },
      });
    } catch { /* a host without the pill registry loses only the pill */ }
    return () => clearInterval(timer);
  },
});
