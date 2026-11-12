import { For, Show, createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import { Command, Panel, Plugin, type PanelTab } from '@opencode/plugin/gui';
import { FeaturePilot } from './contract.js';
import type { ModelChoice, Roles } from './settings.js';
import { compareMonthlyScenario } from './comparison.js';
import { sortModelInventory } from './model-sort.js';

type Price = { id: string; inputPerMillionUsd: string | null; outputPerMillionUsd: string | null; conditional: boolean; dynamicRouter: boolean; extraPriceFields: string[] };
type UsageBucket = { attempts: number; gross: { knownUsd: string; unknownCount: number }; cash: { knownUsd: string; unknownCount: number }; credit: { knownUsd: string; unknownCount: number } };
type UsageView = { summary: { calendarMonth: string; timeZone: string; total: UsageBucket; days: (UsageBucket & { date: string })[]; breakdown: { provider: (UsageBucket & { key: string })[]; model: (UsageBucket & { key: string })[]; effort: (UsageBucket & { key: string })[]; role: (UsageBucket & { key: string })[] } }; coverage: { complete: boolean; projectSessions: number; unavailableSessions: number; skippedMessages: number; truncated: boolean } };
type IntelligenceEntry = { id: string; slug: string; name: string; creator: string; score: number | null };
type Draft = { id: string; requirement: string; baseCommit: string; revision: number; state: string; planHash: string | null };
type DraftDetail = Draft & { clarification: { id: string; question: string; answer: string | null }[]; planJson: string | null };
type BudgetUsage = { committedUsd: string; pendingUsd: string; pendingCount: number; remainingUsd: string | null; overLimitUsd: string | null };
type BudgetView = { directory: string; available: boolean; period: string | null; monthly: { amount: string; revision: number } | null; feature: { amount: string; revision: number } | null; monthlyUsage: BudgetUsage | null; featureUsage: BudgetUsage | null };
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
        const [requirement, setRequirement] = createSignal('');
        const [drafts, setDrafts] = createSignal<{ session: typeof props.session; runs: Draft[] }>();
        const [detail, setDetail] = createSignal<{ session: typeof props.session; run: DraftDetail }>();
        const [answerText, setAnswerText] = createSignal<Record<string, string>>({});
        const [exportPreview, setExportPreview] = createSignal<{ session: typeof props.session; id: string; revision: number; text: string }>();
        const loadExport = async () => {
          const current = detail(); if (!current || current.session !== props.session) return;
          try {
            const value = await current.session.server.client.rpc(FeaturePilot).exportDraft({ id: current.run.id, revision: current.run.revision }, { location: { directory: current.session.directory } }) as { directory: string; preview: string };
            if (value.directory !== current.session.directory) throw new Error('Wrong project');
            if (props.session === current.session && detail()?.run.id === current.run.id) setExportPreview({ session: current.session, id: current.run.id, revision: current.run.revision, text: value.preview });
          } catch { if (props.session === current.session) setDraftError('Could not prepare the export preview.'); }
        };

        const openDraft = async (id: string) => {
          const session = props.session; setDraftError('');
          try {
            const value = await session.server.client.rpc(FeaturePilot).getDraft({ id }, { location: { directory: session.directory } }) as { directory: string; run: DraftDetail };
            if (value.directory !== session.directory) throw new Error('Wrong project');
            if (props.session === session) { setDetail({ session, run: value.run }); setAnswerText({}); }
          } catch { if (props.session === session) setDraftError('Could not open the draft.'); }
        };
        const updateDraft = async (kind: 'answer' | 'approve', questionID?: string) => {
          const current = detail(); if (!current || current.session !== props.session || draftBusy()) return;
          setDraftBusy(true); setDraftError('');
          try {
            const rpc = current.session.server.client.rpc(FeaturePilot), options = { location: { directory: current.session.directory } };
            const result = kind === 'answer' && questionID ? await rpc.answerDraft({ id: current.run.id, revision: current.run.revision, answers: [{ id: questionID, answer: answerText()[questionID] ?? '' }] }, options) : await rpc.approveDraft({ id: current.run.id, revision: current.run.revision, planHash: current.run.planHash ?? '' }, options);
            const value = result as { directory: string; run: DraftDetail };
            if (value.directory !== current.session.directory) throw new Error('Wrong project');
            if (props.session === current.session) { setDetail({ session: current.session, run: value.run }); setAnswerText({}); await loadDrafts(); }
          } catch { if (props.session === current.session) setDraftError('Could not update the draft. Refresh it and try again.'); }
          finally { setDraftBusy(false); }
        };
        const [draftBusy, setDraftBusy] = createSignal(false);
        const [draftError, setDraftError] = createSignal('');
        const loadDrafts = async () => {
          const session = props.session; setDraftError('');
          try {
            const value = await session.server.client.rpc(FeaturePilot).listDrafts({}, { location: { directory: session.directory } }) as { directory: string; runs: Draft[] };
            if (value.directory !== session.directory) throw new Error('Wrong project');
            if (props.session === session) setDrafts({ session, runs: value.runs });
          } catch { if (props.session === session) setDraftError('Could not load feature drafts.'); }
        };
        const saveDraft = async () => {
          const session = props.session, text = requirement(); if (draftBusy() || !text.trim()) return;
          setDraftBusy(true); setDraftError('');
          try {
            const value = await session.server.client.rpc(FeaturePilot).createDraft({ requirement: text }, { location: { directory: session.directory } }) as { directory: string };
            if (value.directory !== session.directory) throw new Error('Wrong project');
            if (props.session === session) { setRequirement(''); await loadDrafts(); }
          } catch { if (props.session === session) setDraftError('Could not save the draft. Check that this project has a Git commit.'); }
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

        return <section style={{ padding: '20px', display: 'grid', gap: '16px', 'align-content': 'start', height: '100%', overflow: 'auto' }}>
          <header style={{ display: 'grid', gap: '6px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <span style={{ 'font-size': '11px', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', opacity: 0.7 }}>Model inventory</span>
            <h2 style={{ margin: '0', 'font-size': '20px', 'font-weight': '600' }}>Feature Pilot</h2>
            <p style={{ margin: '0', 'font-size': '12px', opacity: 0.75 }}>Choose models for each role in this project. Execution and cost recommendations are not available yet.</p>
          </header>
          <section aria-labelledby="drafts-heading" style={{ display: 'grid', gap: '8px', 'border-bottom': '1px solid var(--border-weak-base)', 'padding-bottom': '14px' }}>
            <h3 id="drafts-heading" style={{ margin: '0' }}>Feature drafts</h3>
            <p style={{ margin: '0', 'font-size': '11px' }}>Save a requirement and the current Git commit for this project. Planning and implementation are not available yet; uncommitted changes are not included in the baseline.</p>
            <label>Feature requirement <textarea value={requirement()} maxlength={10000} onInput={event => setRequirement(event.currentTarget.value)} /></label>
            <button type="button" disabled={draftBusy() || !requirement().trim()} onClick={() => void saveDraft()}>{draftBusy() ? 'Saving…' : 'Save feature draft'}</button>
            <button type="button" disabled={draftBusy()} onClick={() => void loadDrafts()}>Show saved drafts</button>
            <Show when={draftError()}><p role="alert">{draftError()}</p></Show>
            <Show when={drafts()?.session === props.session}><ul><For each={drafts()?.runs}>{run => <li><span style={{ 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' }}>{run.requirement}</span><br /><small>{run.state} · baseline {run.baseCommit.slice(0, 12)} · revision {run.revision}</small> <button type="button" disabled={draftBusy()} onClick={() => void openDraft(run.id)}>Open draft</button></li>}</For></ul></Show>
            <Show when={detail()?.session === props.session && detail()?.run}>{run => <div style={{ display: 'grid', gap: '8px', 'font-size': '12px' }}>
              <strong>Draft details · {run().state}</strong>
              <p style={{ 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' }}>{run().requirement}</p>
              <For each={run().clarification}>{question => <div><p>{question.question}</p><Show when={question.answer !== null} fallback={<><label>Answer <textarea value={answerText()[question.id] ?? ''} onInput={event => setAnswerText({ ...answerText(), [question.id]: event.currentTarget.value })} /></label><button type="button" disabled={draftBusy() || !(answerText()[question.id] ?? '').trim()} onClick={() => void updateDraft('answer', question.id)}>Save answer</button></>}><p>Answer: {question.answer}</p></Show></div>}</For>
              <Show when={run().planJson}><div><strong>Proposed plan</strong><pre style={{ 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' }}>{run().planJson}</pre></div></Show>
              <button type="button" onClick={() => void loadExport()}>Preview local export</button>
              <Show when={exportPreview()?.session === props.session && exportPreview()?.id === run().id && exportPreview()?.revision === run().revision}><label>Export preview (review for sensitive information before sharing)<textarea readOnly rows={12} value={exportPreview()?.text} /></label></Show>
              <Show when={run().state === 'awaiting_approval' && run().planHash}><button type="button" disabled={draftBusy()} onClick={() => void updateDraft('approve')}>Approve this plan</button><span>Approval is saved for this exact plan; implementation is not started.</span></Show>
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
            <p style={{ margin: '0', 'font-size': '11px' }}>Experimental settings: model execution remains disabled. The monthly limit is shared by Feature Pilot on this host; the feature limit applies to the open draft.</p>
            <button type="button" disabled={budgetBusy()} onClick={() => void loadBudget()}>Load limits</button>
            <Show when={budgetError()}><p role="alert">{budgetError()}</p></Show>
            <Show when={currentBudget()}>{value => <Show when={value().available} fallback={<p>Atomic budget storage requires the local OpenCode fork.</p>}>
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
