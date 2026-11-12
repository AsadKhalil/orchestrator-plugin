import { For, Index, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup } from 'solid-js';
import { Command, Panel, Plugin, type PanelTab } from '@opencode/plugin/gui';
import { FeaturePilot } from './contract.js';
import type { ModelChoice, Policy, Roles } from './settings.js';
import { canPublish, deliveryFromSettings, deliveryOutcome, deliveryProblems, deliveryRequest, emptyDelivery, publishWarning, type DeliveryDraft } from './gui-model.js';
import { attentionExplanation, attentionTitle, autonomousNote, availableActions, billingModes, budgetBackendNote, coderWarning, describeError, emptyRoute, evidenceKinds, parseTokenLimit, policyProblems, routeFromPolicy, routeToPolicy, runActionError, shouldPoll, stateLabel, truncate, verdictLabel, buildRecommendRequest, emptyRecommendDraft, emptyScore, emptySettle, evidenceLabel, exclusionExplanation, recommendError, recommendProblems, recommendRoles, recommendationNote, reservationWarning, settleProblems, settleRequest, type RecommendDraft, type ScoreDraft, type SettleDraft, type RouteDraft } from './gui-model.js';
import { compareMonthlyScenario } from './comparison.js';
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
const routeFields: [keyof RouteDraft, string, ('decimal' | 'numeric')?][] = [['providerID', 'Provider ID'], ['id', 'Model ID'], ['variant', 'Variant (optional)'], ['vendor', 'Vendor'], ['canonicalID', 'Canonical model ID'], ['modelVersion', 'Model version'], ['input', 'Input USD per million tokens', 'decimal'], ['output', 'Output USD per million tokens', 'decimal'], ['cacheRead', 'Cache read USD per million tokens (optional)', 'decimal'], ['cacheWrite', 'Cache write USD per million tokens (optional)', 'decimal'], ['serviceTier', 'Service tier'], ['sourceURL', 'Rate source URL (https only)'], ['checkedAt', 'Rates checked on (YYYY-MM-DD or ISO date-time)']];
type BudgetUsage = { committedUsd: string; pendingUsd: string; pendingCount: number; remainingUsd: string | null; overLimitUsd: string | null };
type BudgetView = { directory: string; available: boolean; backend: 'host' | 'local_file' | null; period: string | null; monthly: { amount: string; revision: number } | null; feature: { amount: string; revision: number } | null; monthlyUsage: BudgetUsage | null; featureUsage: BudgetUsage | null };
type Model = { providerID: string; id: string; name: string; enabled: boolean; status: string; variants: string[]; capabilities: { input: string[]; tools: boolean } };

export default Plugin.define({
  setup(ctx) {
    const tab: PanelTab = { id: 'models', title: 'Feature Pilot', closable: 'compact', fallback: true };
    ctx.add(Command, () => ({
      id: 'open', title: 'Open Feature Pilot', keywords: 'models planner coder reviewer',
      enabled: !!ctx.sessions.current(),
      run: () => { const session = ctx.sessions.current(); if (session) ctx.layout.toggle(`${ctx.id}:models`, session); },
    }));
    ctx.add(Panel, {
      id: 'models', region: 'side', width: 420,
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
          const [value, selections] = await Promise.all([rpc.listModels({}, options), rpc.getSelections({}, options)]) as [{ directory: string; models: Model[] }, { directory: string; settings: { revision: number; roles: Roles } }];
          if (value.directory !== session.directory || selections.directory !== session.directory) throw new Error('Data came from a different project');
          return { session, models: value.models, settings: selections.settings };
        });
        const data = createMemo(() => response()?.session === props.session ? response() : undefined);
        const result = createMemo(() => data()?.models);
        const same = (a: ModelChoice, b: ModelChoice) => a.providerID === b.providerID && a.id === b.id && a.variant === b.variant;
        const selected = (role: keyof Roles, choice: ModelChoice) => data()?.settings.roles[role].some(item => same(item, choice)) ?? false;
        const update = async (role: keyof Roles, choice: ModelChoice, checked: boolean) => {
          const current = data(); if (!current || saving()) return;
          const choices = current.settings.roles[role].filter(item => !same(item, choice));
          if (checked) choices.push(choice);
          setSaving(true); setSaveError('');
          try {
            const value = await current.session.server.client.rpc(FeaturePilot).saveSelections({ revision: current.settings.revision, roles: { ...current.settings.roles, [role]: choices } }, { location: { directory: current.session.directory } }) as { directory: string };
            if (value.directory !== current.session.directory) throw new Error('Wrong project');
          } catch { setSaveError('Could not save selection. The project may have changed; refresh and try again.'); }
          finally {
            try { if (props.session === current.session) await refetch(); }
            catch { setSaveError('Could not refresh selections. Try Refresh.'); }
            finally { setSaving(false); }
          }
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

        const missing = (role: keyof Roles) => (data()?.settings.roles[role] ?? []).filter(choice => !result()?.some(m => m.providerID === choice.providerID && m.id === choice.id && (choice.variant === null || m.variants.includes(choice.variant))));

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

        return <section style={{ padding: '20px', display: 'grid', gap: '16px', 'align-content': 'start', height: '100%', overflow: 'auto' }}>
          <header style={{ display: 'grid', gap: '6px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <span style={{ 'font-size': '11px', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', opacity: 0.7 }}>Model inventory</span>
            <h2 style={{ margin: '0', 'font-size': '20px', 'font-weight': '600' }}>Feature Pilot</h2>
            <p style={{ margin: '0', 'font-size': '12px', opacity: 0.75 }}>Choose models for each role in this project, then start and follow feature runs. Prices and scores are shown for comparison only; nothing here recommends a model.</p>
          </header>
          <section aria-labelledby="drafts-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="drafts-heading" style={{ margin: '0' }}>Feature runs</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>Describe a feature to record it with this project's current Git commit as the baseline; uncommitted changes are not included. Start only saves the run. Open it and choose Run to begin planning.</p>
            <label>Feature requirement <textarea value={requirement()} maxlength={10000} onInput={event => setRequirement(event.currentTarget.value)} /></label>
            <button type="button" disabled={draftBusy() || !requirement().trim()} onClick={() => void saveDraft()}>{draftBusy() ? 'Working…' : 'Start'}</button>
            <button type="button" onClick={() => { setDraftError(''); void loadDrafts(); }}>Refresh run list</button>
            <Show when={draftError()}><p role="alert">{draftError()}</p></Show>
            <Show when={draftNote()}><p role="status">{draftNote()}</p></Show>
            <Show when={drafts()?.session === props.session}><Show when={drafts()?.runs.length} fallback={<p style={{ margin: '0', 'font-size': '12px' }}>No runs yet.</p>}><ul style={{ 'list-style': 'none', margin: '0', padding: '0', display: 'grid', gap: '8px' }}><Index each={drafts()?.runs}>{run => <li style={{ border: '1px solid var(--border-weak-base)', padding: '8px', display: 'grid', gap: '4px', 'font-size': '12px' }}>
              <span style={{ 'overflow-wrap': 'anywhere' }}>{truncate(run().requirement, 80)}</span>
              <small>{stateLabel(run().state)}{run().stopRequested ? ' · stop requested' : ''} · baseline {run().baseCommit.slice(0, 12)} · revision {run().revision}{selectedRunID() === run().id ? ' · shown below' : ''}</small>
              <Show when={run().attention}>{reason => <small>Attention: {attentionTitle(reason())}</small>}</Show>
              <button type="button" aria-label={`Open run: ${truncate(run().requirement, 60)}`} aria-current={selectedRunID() === run().id ? 'true' : undefined} disabled={draftBusy()} onClick={() => void openDraft(run().id)}>Open</button>
            </li>}</Index></ul></Show></Show>
            <Show when={currentRun()}>{run => <div style={{ display: 'grid', gap: '8px', 'font-size': '12px' }}>
              <h4 style={{ margin: '0' }}>Run details</h4>
              <span role="status">State: <strong>{stateLabel(run().state)}</strong>{run().stopRequested ? ' (stop requested)' : ''} · revision {run().revision}</span>
              <p style={{ margin: '0', 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' }}>{run().requirement}</p>
              <Show when={run().attention}>{reason => <p style={{ margin: '0' }}><strong>Needs attention: {attentionTitle(reason())}.</strong> {attentionExplanation(reason())}</p>}</Show>
              <Show when={run().approval}><span>Plan approved ({run().approval}).</span></Show>
              <Show when={run().clarification.length}><div style={{ display: 'grid', gap: '6px' }}>
                <strong>Questions</strong>
                <Index each={run().clarification}>{question => <Show when={question().answer === null && !run().stopRequested} fallback={<p style={{ margin: '0', 'overflow-wrap': 'anywhere' }}>{question().question}<br />Answer: {question().answer ?? 'not answered'}</p>}>
                  <label style={{ display: 'grid', gap: '4px' }}>{question().question}<textarea value={answerText()[question().id] ?? ''} onInput={event => setAnswerText({ ...answerText(), [question().id]: event.currentTarget.value })} /></label>
                </Show>}</Index>
                <Show when={!run().stopRequested && run().clarification.some(question => question.answer === null)}><button type="button" disabled={draftBusy() || !run().clarification.some(question => question.answer === null && (answerText()[question.id] ?? '').trim())} onClick={() => void act('answer')}>Save answers</button></Show>
              </div></Show>
              <Show when={run().planJson}>{plan => <div><strong id="plan-heading">Proposed plan (JSON, read only)</strong><pre tabindex="0" aria-labelledby="plan-heading" style={{ margin: '4px 0', 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere', 'max-height': '260px', overflow: 'auto' }}>{plan()}</pre></div>}</Show>
              <Show when={run().reviews.length}><div><strong>Reviews</strong><ul style={{ margin: '4px 0', 'padding-left': '18px' }}><Index each={run().reviews}>{(review, index) => <li>Review {index + 1}: {verdictLabel(review().verdict)} · {review().blocking} blocking · {review().advisory} advisory</li>}</Index></ul></div></Show>
              <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '8px' }}>
                <Show when={can()?.run}><button type="button" disabled={draftBusy()} onClick={() => void act('run')}>Run</button></Show>
                <Show when={can()?.runAutonomously}><button type="button" aria-describedby="autonomous-note" disabled={draftBusy()} onClick={() => void act('auto')}>Run autonomously</button></Show>
                <Show when={can()?.approve}><button type="button" aria-describedby="approve-note" disabled={draftBusy()} onClick={() => void act('approve')}>Approve this plan</button></Show>
                <Show when={can()?.accept}><button type="button" disabled={draftBusy()} onClick={() => void act('accept')}>Accept</button></Show>
                <Show when={can()?.resume}><button type="button" disabled={draftBusy()} onClick={() => void act('resume')}>Resume</button></Show>
                <Show when={can()?.stop}><button type="button" disabled={draftBusy()} onClick={() => void act('stop')}>Stop</button></Show>
                <button type="button" onClick={() => { setDraftError(''); void refresh(run().id); }}>Refresh run</button>
                <button type="button" onClick={() => void loadExport()}>Export preview</button>
                <button type="button" disabled={draftBusy()} onClick={() => void deliver('local')}>Export summary to disk</button>
                <Show when={canPublish(run().state)}><button type="button" aria-describedby="publish-note" disabled={draftBusy()} onClick={() => setConfirmPublish(run().id)}>Publish draft pull request…</button></Show>
              </div>
              <Show when={canPublish(run().state) && confirmPublish() === run().id}><div role="group" aria-label="Confirm publishing" style={{ display: 'grid', gap: '6px', border: '1px solid var(--border-weak-base)', padding: '8px' }}>
                <span id="publish-note">{publishWarning}</span>
                <div style={{ display: 'flex', gap: '8px' }}><button type="button" disabled={draftBusy()} onClick={() => void deliver('github')}>Yes, push the branch and open a draft pull request</button><button type="button" onClick={() => setConfirmPublish(undefined)}>Cancel</button></div>
              </div></Show>
              <Show when={deliveryResult()?.session === props.session && deliveryResult()?.id === run().id}><p role="status" style={{ margin: '0', 'overflow-wrap': 'anywhere' }}>{deliveryResult()!.text}</p></Show>
              <Show when={can()?.runAutonomously}><span id="autonomous-note">{autonomousNote}</span></Show>
              <Show when={can()?.approve}><span id="approve-note">Approves exactly this plan{run().planHash ? ` (hash ${run().planHash!.slice(0, 12)})` : ''} and moves the run to implementation. Then choose Run.</span></Show>
              <Show when={exportPreview()?.session === props.session && exportPreview()?.id === run().id && exportPreview()?.revision === run().revision}><div><strong id="export-heading">Export preview (read only; review for sensitive information before sharing)</strong><pre tabindex="0" aria-labelledby="export-heading" style={{ margin: '4px 0', 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere', 'max-height': '260px', overflow: 'auto' }}>{exportPreview()?.text}</pre></div></Show>
              <div style={{ display: 'grid', gap: '6px' }}>
                <strong>Reservations</strong>
                <p style={{ margin: '0' }}>{reservationWarning}</p>
                <button type="button" disabled={reservationBusy()} onClick={() => void loadReservations()}>Load reservations</button>
                <Show when={reservationErrors().length}><div role="alert"><ul style={{ margin: '0', 'padding-left': '18px' }}><For each={reservationErrors()}>{problem => <li style={{ 'overflow-wrap': 'anywhere' }}>{problem}</li>}</For></ul></div></Show>
                <Show when={reservationNote()}><p role="status" style={{ margin: '0' }}>{reservationNote()}</p></Show>
                <Show when={reservations()?.session === props.session && reservations()?.runID === run().id}>
                  <Show when={reservations()?.items.length} fallback={<span>This run has no reservations.</span>}><ul style={{ 'list-style': 'none', margin: '0', padding: '0', display: 'grid', gap: '8px' }}><Index each={reservations()?.items}>{item => <li style={{ border: '1px solid var(--border-weak-base)', padding: '8px', display: 'grid', gap: '4px' }}>
                    <span style={{ 'overflow-wrap': 'anywhere' }}>Attempt {item().attemptID} · period {item().period}</span>
                    <span>Reserved ${item().reservedUsd} · {item().settledUsd === null ? 'pending' : `settled $${item().settledUsd}`}</span>
                    <Show when={item().settledUsd !== null}><span style={{ 'overflow-wrap': 'anywhere' }}>Evidence: {evidenceLabel(item().evidenceKind)}{item().evidenceReference ? ` · ${item().evidenceReference}` : ''}</span></Show>
                    <Show when={item().settledUsd === null}><fieldset style={{ display: 'grid', gap: '6px', border: '1px solid var(--border-weak-base)', padding: '8px', margin: '0' }}>
                      <legend>Settle this reservation</legend>
                      <label style={{ display: 'grid', gap: '2px' }}>Settle with<select onChange={event => editSettle(item().attemptID, 'kind', event.currentTarget.value)}><option value="" selected={settleDraft(item().attemptID).kind === ''}>Choose evidence</option><option value="provider_gross_charge" selected={settleDraft(item().attemptID).kind === 'provider_gross_charge'}>Provider’s own charge</option><option value="confirmed_not_dispatched" selected={settleDraft(item().attemptID).kind === 'confirmed_not_dispatched'}>Confirmed never sent</option></select></label>
                      <label style={{ display: 'grid', gap: '2px' }}>Actual USD charged by the provider<input inputmode="decimal" disabled={settleDraft(item().attemptID).kind === 'confirmed_not_dispatched'} value={settleDraft(item().attemptID).kind === 'confirmed_not_dispatched' ? '0' : settleDraft(item().attemptID).actualUsd} onInput={event => editSettle(item().attemptID, 'actualUsd', event.currentTarget.value)} /></label>
                      <label style={{ display: 'grid', gap: '2px' }}>Reference (required): the provider’s charge or record id, or what shows nothing was sent<input maxlength={512} aria-required="true" value={settleDraft(item().attemptID).reference} onInput={event => editSettle(item().attemptID, 'reference', event.currentTarget.value)} /></label>
                      <button type="button" disabled={reservationBusy()} onClick={() => void settleReservation(item().attemptID)}>Settle</button>
                    </fieldset></Show>
                  </li>}</Index></ul></Show>
                </Show>
              </div>
            </div>}</Show>
          </section>
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
            <span aria-live="polite" style={{ 'font-size': '12px' }}>{response.loading ? 'Loading models…' : `${result()?.length ?? 0} models`}</span>
            <button type="button" disabled={response.loading} onClick={() => void refetch()}>Refresh</button>
          </div>
          <section aria-labelledby="usage-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="usage-heading" style={{ margin: '0' }}>Observed usage</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>Partial: current assistant messages from this plugin’s sessions in this project. Older, auxiliary and failed requests may be missing. Dates use message creation time, not verified request start. Host estimates are not provider bills; cash and credits are unknown.</p>
            <label>Month <input type="month" value={month()} onInput={event => setMonth(event.currentTarget.value)} /></label>
            <span style={{ 'font-size': '11px' }}>Reporting timezone: {timeZone}</span>
            <button type="button" disabled={usageLoading() || !month()} onClick={() => void loadUsage()}>{usageLoading() ? 'Loading usage…' : 'Show observed usage'}</button>
            <Show when={usageError()}><p role="alert">{usageError()}</p></Show>
            <Show when={currentUsage()}>{report => <div style={{ display: 'grid', gap: '8px', 'font-size': '12px' }}>
              <span>Month known host estimates: ${report().summary.total.gross.knownUsd}; {report().summary.total.gross.unknownCount} observed amounts unknown.</span>
              <Show when={month() === today().slice(0, 7)}><span>Today: ${report().summary.days.find(day => day.date === today())?.gross.knownUsd ?? '0'} known estimate; {report().summary.days.find(day => day.date === today())?.gross.unknownCount ?? 0} observed amounts unknown.</span></Show>
              <span>Observed messages: {report().summary.total.attempts}. Sessions unavailable: {report().coverage.unavailableSessions}; messages skipped: {report().coverage.skippedMessages}{report().coverage.truncated ? '; session scan truncated' : ''}.</span>
              <table><caption>Daily observed host estimates (partial)</caption><thead><tr><th scope="col">Date</th><th scope="col">Known USD</th><th scope="col">Unknown</th></tr></thead><tbody><For each={report().summary.days}>{day => <tr><th scope="row">{day.date}</th><td>{day.gross.knownUsd}</td><td>{day.gross.unknownCount}</td></tr>}</For></tbody></table>
              <For each={['provider', 'model', 'effort', 'role'] as const}>{group => <details><summary>By {group === 'effort' ? 'reported variant' : group}</summary><ul><For each={report().summary.breakdown[group]}>{item => <li style={{ 'overflow-wrap': 'anywhere' }}>{item.key}: ${item.gross.knownUsd} known, {item.gross.unknownCount} unknown</li>}</For></ul></details>}</For>
            </div>}</Show>
          </section>
          <section aria-labelledby="budget-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="budget-heading" style={{ margin: '0' }}>Budget limits</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>The monthly limit is shared by Feature Pilot on this host; the feature limit applies to the open run.</p>
            <button type="button" disabled={budgetBusy()} onClick={() => void loadBudget()}>Load limits</button>
            <Show when={budgetError()}><p role="alert">{budgetError()}</p></Show>
            <Show when={currentBudget()}>{value => <Show when={value().available} fallback={<p>{budgetBackendNote(null)}</p>}>
              <p>{budgetBackendNote(value().backend)}</p>
              <label>Monthly limit (USD) <input inputmode="decimal" value={monthlyLimit()} onInput={event => setMonthlyLimit(event.currentTarget.value)} /></label>
              <button type="button" disabled={budgetBusy()} onClick={() => void loadBudget('monthly')}>Save monthly limit</button>
              <Show when={value().monthlyUsage}>{usage => <span>UTC {value().period}: ${usage().committedUsd} committed, including ${usage().pendingUsd} pending across {usage().pendingCount} requests. Remaining: {usage().remainingUsd === null ? 'limit not set' : `$${usage().remainingUsd}`}; over limit: {usage().overLimitUsd === null ? 'unknown' : `$${usage().overLimitUsd}`}.</span>}</Show>
              <Show when={selectedRunID()} fallback={<span>Open a draft to set its feature limit.</span>}>
                <label>Open draft limit (USD) <input inputmode="decimal" value={featureLimit()} onInput={event => setFeatureLimit(event.currentTarget.value)} /></label>
                <button type="button" disabled={budgetBusy()} onClick={() => void loadBudget('feature')}>Save feature limit</button>
                <Show when={value().featureUsage}>{usage => <span>Feature: ${usage().committedUsd} committed, including ${usage().pendingUsd} pending across {usage().pendingCount} requests. Remaining: {usage().remainingUsd === null ? 'limit not set' : `$${usage().remainingUsd}`}; over limit: {usage().overLimitUsd === null ? 'unknown' : `$${usage().overLimitUsd}`}.</span>}</Show>
              </Show>
            </Show>}</Show>
          </section>
          <section aria-labelledby="policy-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="policy-heading" style={{ margin: '0' }}>Spending & permissions</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>Routes tell Feature Pilot what a model costs. Nothing is fetched or filled in for you: enter each rate from the provider's own pricing page and record where you read it. Only metered API routes without conditions can be bounded by a dollar budget. Saving replaces this project's whole policy.</p>
            <button type="button" disabled={policyBusy()} onClick={() => void loadPolicy()}>Reload settings</button>
            <Show when={policyErrors().length}><div role="alert"><ul style={{ margin: '0', 'padding-left': '18px' }}><For each={policyErrors()}>{problem => <li style={{ 'overflow-wrap': 'anywhere' }}>{problem}</li>}</For></ul></div></Show>
            <Show when={policyNote()}><p role="status" style={{ margin: '0' }}>{policyNote()}</p></Show>
            <Show when={policy()?.session === props.session}>
              <label>Planned output tokens per request <input inputmode="numeric" value={maxTokens()} onInput={event => setMaxTokens(event.currentTarget.value)} /></label>
              <p style={{ margin: '0', 'font-size': '11px' }}>Used for cost estimates only. It is not sent to the provider as a limit, so budgets reserve each request at the model’s full output limit.</p>
              <span style={{ 'font-size': '11px' }}>Whole number from 1 to 10,000,000.</span>
              <label style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}><input type="checkbox" aria-describedby="coder-warning" checked={coderEnabled()} onChange={event => setCoderEnabled(event.currentTarget.checked)} />Allow the coder to edit files and run shell commands</label>
              <p id="coder-warning" style={{ margin: '0', 'font-size': '12px', 'font-weight': '600' }}>{coderWarning}</p>
              <Index each={routes()}>{(route, index) => <fieldset style={{ display: 'grid', gap: '6px', border: '1px solid var(--border-weak-base)', padding: '8px', margin: '0' }}>
                <legend>Route {index + 1}{route().providerID || route().id ? `: ${route().providerID} / ${route().id}` : ''}</legend>
                <For each={routeFields}>{([key, label, mode]) => <label style={{ display: 'grid', gap: '2px', 'font-size': '12px' }}>{label}<input inputmode={mode} value={route()[key] as string} onInput={event => editRoute(index, key, event.currentTarget.value)} /></label>}</For>
                <label style={{ display: 'grid', gap: '2px', 'font-size': '12px' }}>Billing<select onChange={event => editRoute(index, 'billing', event.currentTarget.value)}><option value="" selected={route().billing === ''}>Choose billing</option><For each={billingModes}>{mode => <option value={mode} selected={route().billing === mode}>{billingLabels[mode]}</option>}</For></select></label>
                <label style={{ display: 'grid', gap: '2px', 'font-size': '12px' }}>Evidence kind<select onChange={event => editRoute(index, 'kind', event.currentTarget.value)}><option value="" selected={route().kind === ''}>Choose evidence kind</option><For each={evidenceKinds}>{kind => <option value={kind} selected={route().kind === kind}>{kindLabels[kind]}</option>}</For></select></label>
                <Show when={route().conditions.length}><span style={{ 'font-size': '11px', 'overflow-wrap': 'anywhere' }}>Conditions saved with this route: {route().conditions.join('; ')}. A dollar budget cannot bound a rate with conditions.</span></Show>
                <button type="button" aria-label={`Remove route ${index + 1}`} onClick={() => setRoutes(list => list.filter((_, i) => i !== index))}>Remove route</button>
              </fieldset>}</Index>
              <button type="button" onClick={() => setRoutes(list => [...list, emptyRoute()])}>Add route</button>
              <button type="button" disabled={policyBusy()} onClick={() => void submitPolicy()}>{policyBusy() ? 'Working…' : 'Save spending & permissions'}</button>
            </Show>
          </section>
          <section aria-labelledby="delivery-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="delivery-heading" style={{ margin: '0' }}>Delivery</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>Exporting a run summary to disk needs no setup. Publishing a draft pull request is off until you authorize one remote for this project here.</p>
            <button type="button" disabled={deliveryBusy()} onClick={() => void loadDelivery()}>Reload delivery settings</button>
            <Show when={deliveryErrors().length}><div role="alert"><ul style={{ margin: '0', 'padding-left': '18px' }}><For each={deliveryErrors()}>{problem => <li style={{ 'overflow-wrap': 'anywhere' }}>{problem}</li>}</For></ul></div></Show>
            <Show when={deliveryNote()}><p role="status" style={{ margin: '0' }}>{deliveryNote()}</p></Show>
            <Show when={delivery()?.session === props.session}>
              <label style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}><input type="checkbox" aria-describedby="publish-setting-note" checked={deliveryDraft().publicationEnabled} onChange={event => editDelivery('publicationEnabled', event.currentTarget.checked)} />Allow publishing draft pull requests from this project</label>
              <p id="publish-setting-note" style={{ margin: '0', 'font-size': '12px', 'font-weight': '600' }}>{publishWarning}</p>
              <label style={{ display: 'grid', gap: '2px', 'font-size': '12px' }}>Remote name<input value={deliveryDraft().remote} onInput={event => editDelivery('remote', event.currentTarget.value)} /></label>
              <label style={{ display: 'grid', gap: '2px', 'font-size': '12px' }}>Remote URL (exactly as git shows it; no credentials)<input value={deliveryDraft().remoteURL} onInput={event => editDelivery('remoteURL', event.currentTarget.value)} /></label>
              <label style={{ display: 'grid', gap: '2px', 'font-size': '12px' }}>Base branch for the pull request<input value={deliveryDraft().baseBranch} onInput={event => editDelivery('baseBranch', event.currentTarget.value)} /></label>
              <label style={{ display: 'grid', gap: '2px', 'font-size': '12px' }}>Branch prefix (ends with /)<input value={deliveryDraft().branchPrefix} onInput={event => editDelivery('branchPrefix', event.currentTarget.value)} /></label>
              <button type="button" disabled={deliveryBusy()} onClick={() => void submitDelivery()}>{deliveryBusy() ? 'Working…' : 'Save delivery settings'}</button>
            </Show>
          </section>
          <section aria-labelledby="rec-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="rec-heading" style={{ margin: '0' }}>Route recommendations (estimates)</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>{recommendationNote}</p>
            <p style={{ margin: '0', 'font-size': '11px' }}>Only routes you selected for the role and that have a recorded rate are ranked, by estimated cost for the workload below. Rates come from Spending & permissions. A route is excluded, never guessed, when something it needs is missing.</p>
            <label style={{ display: 'grid', gap: '2px' }}>Role<select onChange={event => editRec('role', event.currentTarget.value)}><For each={recommendRoles}>{role => <option value={role} selected={rec().role === role}>{role}</option>}</For></select></label>
            <label style={{ display: 'grid', gap: '2px' }}>Minimum score<input inputmode="decimal" value={rec().minimumScore} onInput={event => editRec('minimumScore', event.currentTarget.value)} /></label>
            <label style={{ display: 'grid', gap: '2px' }}>Benchmark index version (your scores must state this exact version)<input value={rec().indexVersion} onInput={event => editRec('indexVersion', event.currentTarget.value)} /></label>
            <Index each={rec().scores}>{(score, index) => <fieldset style={{ display: 'grid', gap: '6px', border: '1px solid var(--border-weak-base)', padding: '8px', margin: '0' }}>
              <legend>Score {index + 1}</legend>
              <For each={scoreFields}>{([key, label, mode]) => <label style={{ display: 'grid', gap: '2px', 'font-size': '12px' }}>{label}<input inputmode={mode} value={score()[key]} onInput={event => editScore(index, key, event.currentTarget.value)} /></label>}</For>
              <button type="button" aria-label={`Remove score ${index + 1}`} onClick={() => editRec('scores', rec().scores.filter((_, i) => i !== index))}>Remove score</button>
            </fieldset>}</Index>
            <button type="button" onClick={() => editRec('scores', [...rec().scores, emptyScore()])}>Add score</button>
            <label style={{ display: 'grid', gap: '2px' }}>Input tokens for the workload<input inputmode="numeric" value={rec().inputTokens} onInput={event => editRec('inputTokens', event.currentTarget.value)} /></label>
            <label style={{ display: 'grid', gap: '2px' }}>Output tokens for the workload<input inputmode="numeric" value={rec().outputTokens} onInput={event => editRec('outputTokens', event.currentTarget.value)} /></label>
            <label style={{ display: 'grid', gap: '2px' }}>Remaining budget (USD)<input inputmode="decimal" value={rec().remainingBudget} onInput={event => editRec('remainingBudget', event.currentTarget.value)} /></label>
            <label style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}><input type="checkbox" checked={rec().image} onChange={event => editRec('image', event.currentTarget.checked)} />Needs image input</label>
            <label style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}><input type="checkbox" checked={rec().tools} onChange={event => editRec('tools', event.currentTarget.checked)} />Needs tool use</label>
            <Show when={rec().role === 'reviewer'}><span style={{ 'font-size': '11px', 'overflow-wrap': 'anywhere' }}>{currentRun() ? `Vendors that already worked on the open run (${truncate(currentRun()!.requirement, 40)}) are excluded.` : 'No run is open, so no vendor is excluded. Open the run first to require an independent vendor.'}</span></Show>
            <button type="button" disabled={recBusy()} onClick={() => void submitRec()}>{recBusy() ? 'Working…' : 'Estimate route costs'}</button>
            <Show when={recErrors().length}><div role="alert"><ul style={{ margin: '0', 'padding-left': '18px' }}><For each={recErrors()}>{problem => <li style={{ 'overflow-wrap': 'anywhere' }}>{problem}</li>}</For></ul></div></Show>
            <Show when={recResult()?.session === props.session && recResult()}>{result => <div aria-live="polite" style={{ display: 'grid', gap: '6px', 'font-size': '12px' }}>
              <span>Based on role selection revision {result().value.selectionRevision} and rate catalog {result().value.snapshotID.slice(0, 12)}. An estimate for the workload you entered, not a bill.</span>
              <Show when={result().value.selected} fallback={<strong>No route meets every requirement.</strong>}>{item => <div><strong>Lowest estimated cost among routes that qualify</strong><p style={{ margin: '2px 0', 'overflow-wrap': 'anywhere' }}>{candidateLine(item())}</p></div>}</Show>
              <Show when={otherRoutes(result().value).length}><div><strong>Other qualifying routes, by estimated cost</strong><ul style={{ margin: '2px 0', 'padding-left': '18px' }}><For each={otherRoutes(result().value)}>{item => <li style={{ 'overflow-wrap': 'anywhere' }}>{candidateLine(item)}</li>}</For></ul></div></Show>
              <Show when={result().value.excluded.length}><div><strong>Excluded routes</strong><ul style={{ margin: '2px 0', 'padding-left': '18px' }}><For each={result().value.excluded}>{item => <li style={{ 'overflow-wrap': 'anywhere' }}>{item.providerID} / {item.id} / {item.variant ?? 'default effort'}<ul style={{ margin: '0', 'padding-left': '18px' }}><For each={item.reasons}>{reason => <li>{exclusionExplanation(reason)} <small>({reason})</small></li>}</For></ul></li>}</For></ul></div></Show>
            </div>}</Show>
          </section>
          <section aria-labelledby="comparison-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="comparison-heading" style={{ margin: '0' }}>Monthly cost scenarios</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>Enter your estimates for the same amount of work. Include all planner, coder, reviewer and retry API charges. Enter subscription overage and independent review separately. These are scenarios, not bills or proof of equivalent quality; credits, allowances, taxes and other benefits are not included. Partial observed estimates cannot establish your total bill; use 0 only when appropriate.</p>
            <label>API workflow estimate (USD) <input inputmode="decimal" value={apiEstimate()} onInput={event => setApiEstimate(event.currentTarget.value)} /></label>
            <Show when={currentUsage()}><button type="button" onClick={() => setApiEstimate(currentUsage()!.summary.total.gross.knownUsd)}>Use partial observed estimate</button></Show>
            <Show when={currentUsage()}><span style={{ 'font-size': '11px' }}>The observed estimate may omit requests and unknown amounts; it cannot establish your total API bill.</span></Show>
            <label>Subscription fee (USD) <input inputmode="decimal" value={fee()} onInput={event => setFee(event.currentTarget.value)} /></label>
            <label>Subscription overage estimate (USD) <input inputmode="decimal" value={overage()} onInput={event => setOverage(event.currentTarget.value)} /></label>
            <label>Independent review outside subscription (USD) <input inputmode="decimal" value={externalReview()} onInput={event => setExternalReview(event.currentTarget.value)} /></label>
            <Show when={scenario()} fallback={<span style={{ 'font-size': '11px' }}>Enter nonnegative USD amounts in every field to compare.</span>}>{value => <div aria-live="polite" style={{ display: 'grid', gap: '4px', 'font-size': '12px' }}>
              <span>Replace subscription with API workflow: ${value().apiOnlyUsd}</span>
              <span>Keep subscription and use API workflow: ${value().keepSubscriptionTotalUsd} total; ${value().keepSubscriptionIncrementalUsd} incremental</span>
              <span>Subscription workflow plus overage and independent review: ${value().nativeSubscriptionUsd}</span>
            </div>}</Show>
          </section>
          <div style={{ display: 'grid', gap: '6px' }}>
            <button type="button" disabled={priceLoading()} onClick={() => void loadPrices()}>{priceLoading() ? 'Loading prices…' : 'Load OpenRouter prices'}</button>
            <span style={{ 'font-size': '11px', opacity: 0.75 }}>Requests the public OpenRouter catalog. Rates are estimates, not budget limits.</span>
            <Show when={prices()?.session === props.session}><span style={{ 'font-size': '11px' }}>OpenRouter catalog: {prices()?.status}, checked {prices()?.checkedAt}. <a href="https://openrouter.ai/docs/api/api-reference/models/get-models" target="_blank" rel="noreferrer">Source</a></span></Show>
            <Show when={priceError()}><span role="alert">{priceError()}</span></Show>
          </div>
          <section aria-labelledby="intelligence-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="intelligence-heading" style={{ margin: '0' }}>Intelligence index</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>Optional: set ARTIFICIAL_ANALYSIS_API_KEY in the OpenCode server environment and load your own data. The free API is for internal use; check your access terms before sharing. Data: <a href="https://artificialanalysis.ai/" target="_blank" rel="noreferrer">Artificial Analysis</a>. Scores below are a separate catalog: model and effort matches are not verified and are not used for routing.</p>
            <button type="button" disabled={intelligenceLoading()} onClick={() => void loadIntelligence()}>{intelligenceLoading() ? 'Loading index…' : 'Load intelligence index'}</button>
            <Show when={intelligenceError()}><p role="alert">{intelligenceError()}</p></Show>
            <Show when={intelligence()?.session === props.session}><div><span>Index v{intelligence()?.indexVersion} (major/minor; patch unspecified). Tested effort is not verified.</span><label>Search index <input value={intelligenceSearch()} onInput={event => setIntelligenceSearch(event.currentTarget.value)} /></label><details><summary>{visibleIntelligence().length} index entries, highest first</summary><ul><For each={visibleIntelligence()}>{item => <li style={{ 'overflow-wrap': 'anywhere' }}>{item.name} · {item.creator} · {item.score === null ? 'score unknown' : item.score} <small>({item.slug})</small></li>}</For></ul></details></div></Show>
          </section>
          <Show when={intelligence()?.session === props.session && result()?.length}><section aria-labelledby="pair-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="pair-heading" style={{ margin: '0' }}>Compare a model and index entry</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>Choose both entries yourself. This is an unverified pairing: the source's tested model version and effort may differ. It is not a recommendation or a saved model selection.</p>
            <label>OpenCode model and effort <select value={comparisonModel()?.session === props.session ? comparisonModel()?.value : ''} onChange={event => setComparisonModel({session:props.session,value:event.currentTarget.value})}><option value="">Choose a model</option><For each={result()}>{model => <For each={[null,...model.variants] as (string | null)[]}>{variant => <option value={JSON.stringify([model.providerID,model.id,variant])}>{model.providerID} / {model.name} / {variant ?? 'default'}{!model.enabled || model.status === 'deprecated' ? ' (unavailable)' : ''}</option>}</For>}</For></select></label>
            <label>Artificial Analysis entry <select value={comparisonIndex()?.session === props.session ? comparisonIndex()?.value : ''} onChange={event => setComparisonIndex({session:props.session,value:event.currentTarget.value})}><option value="">Choose an index entry</option><For each={visibleIntelligence()}>{item => <option value={item.id}>{item.creator} / {item.name}</option>}</For></select></label>
            <Show when={comparedChoice() && comparedEntry()}><div style={{ 'font-size': '12px', 'overflow-wrap': 'anywhere' }}><span>Selected index: {comparedEntry()?.score ?? 'unknown'} (v{intelligence()?.indexVersion}; effort unverified).</span><br /><span>OpenRouter input / output base price per 1M: {priceFor(comparedChoice()!.model)?.inputPerMillionUsd ?? 'unknown'} / {priceFor(comparedChoice()!.model)?.outputPerMillionUsd ?? 'unknown'} USD. Other charges and conditions may apply.</span></div></Show>
          </section></Show>
          <label>Sort models <select value={modelSort()} onChange={event => setModelSort(event.currentTarget.value as 'provider' | 'input' | 'output')}><option value="provider">Provider and name</option><option value="input">OpenRouter input base price</option><option value="output">OpenRouter output base price</option></select></label>
          <p style={{ margin: '0', 'font-size': '11px' }}>Price sorting uses the loaded OpenRouter base rates; unknown prices appear last. Conditional rates and additional charges may change the order. Intelligence scores are not matched to this list. Sorting does not select a model.</p>
          <Show when={saveError()}><p role="alert">{saveError()}</p></Show>
          <Show when={saving()}><p aria-live="polite">Saving selection…</p></Show>
          <For each={['planner', 'coder', 'reviewer'] as const}>{role => <Show when={missing(role).length}><div><strong>Unavailable {role} selections</strong><ul><For each={missing(role)}>{choice => <li><span>{choice.providerID} / {choice.id} · {choice.variant ?? 'default'}</span> <button type="button" aria-label={`Remove ${role} selection ${choice.providerID} / ${choice.id} / ${choice.variant ?? 'default'}`} disabled={saving()} onClick={() => void update(role, choice, false)}>Remove</button></li>}</For></ul></div></Show>}</For>
          <Show when={!response.error} fallback={<p role="alert">Could not load models. Check the server connection and try again.</p>}>
            <Show when={result()?.length} fallback={<Show when={!response.loading}><p>No models are currently available at this location.</p></Show>}>
              <ul style={{ 'list-style': 'none', margin: '0', padding: '0', display: 'grid', gap: '8px' }}>
                <For each={sortedModels()}>{model => <li style={{ border: '1px solid var(--border-weak-base)', padding: '12px', display: 'grid', gap: '5px' }}>
                  <strong style={{ 'font-size': '13px', 'overflow-wrap': 'anywhere' }}>{model.name}</strong>
                  <span style={{ 'font-size': '11px', opacity: 0.75, 'overflow-wrap': 'anywhere' }}>{model.providerID} / {model.id}</span>
                  <Show when={priceFor(model)}>{price => <span style={{ 'font-size': '11px' }}>OpenRouter base rate: {price().inputPerMillionUsd === null ? 'unknown' : `$${price().inputPerMillionUsd}`} input / {price().outputPerMillionUsd === null ? 'unknown' : `$${price().outputPerMillionUsd}`} output per 1M tokens{price().conditional ? ' · conditional rates apply' : ''}{price().extraPriceFields.length ? ' · other price fields apply' : ''}</span>}</Show>
                  <Show when={!priceFor(model)}><span style={{ 'font-size': '11px' }}>Price unavailable</span></Show>
                  <span style={{ 'font-size': '11px', opacity: 0.8 }}>{model.enabled ? model.status : 'Disabled'} · {model.capabilities.input.includes('image') ? 'Image input' : 'Text input'} · {model.capabilities.tools ? 'Tools' : 'No tools'}</span>
                  <For each={[null, ...model.variants] as (string | null)[]}>{variant => <fieldset disabled={saving()} style={{ border: '0', margin: '4px 0 0', padding: '0' }}>
                    <legend style={{ 'font-size': '11px' }}>{variant ?? 'Default effort'}</legend>
                    <For each={['planner', 'coder', 'reviewer'] as const}>{role => {
                      const choice = { providerID: model.providerID, id: model.id, variant };
                      return <label style={{ display: 'inline-flex', gap: '4px', 'margin-right': '10px', 'font-size': '12px' }}><input type="checkbox" aria-label={`${role}: ${model.providerID} / ${model.id} / ${variant ?? 'default effort'}`} checked={selected(role, choice)} disabled={(!model.enabled || model.status === 'deprecated') && !selected(role, choice)} onChange={event => { const checked = event.currentTarget.checked; event.currentTarget.checked = selected(role, choice); void update(role, choice, checked); }} />{role}</label>;
                    }}</For>
                  </fieldset>}</For>
                </li>}</For>
              </ul>
            </Show>
          </Show>
        </section>;
      },
    });
  },
});
