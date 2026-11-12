// Workflow measurement. FIXTURE MODE ONLY: it summarizes invented runs through `summarizeRuns` to exercise the report.
// There is no host integration here, so no paid run can be started and no real result can be produced.
import { parseUsd } from '../src/costs.js';
import { summarizeRuns } from '../src/comparison.js';
import { newRun, type Run } from '../src/run.js';
import type { UsageRecord } from '../src/types.js';

const NOTICE = 'Two examples never establish universal savings. Only matched, repeated, observed runs can support a claim; see docs/measurements.md.';
const period = { from: '2026-03-01T00:00:00.000Z', to: '2026-03-02T00:00:00.000Z' };
const start = Date.parse('2026-03-01T09:00:00.000Z');
const minute = 60_000;

type Task = 'ui-screenshot' | 'backend';
// Costs are the gross USD of each attempt in order (planner, coder, reviewer, repairs...); null is an unknown charge.
type FixtureRun = { id: string; task: Task; state: Run['state']; minutes: number; repairRounds: number; costs: (string | null)[] };
const fixtures: Record<string, FixtureRun[]> = {
  'dynamic-routing': [
    { id: 'ui-1', task: 'ui-screenshot', state: 'accepted', minutes: 14, repairRounds: 1, costs: ['0.40', '0.90', '0.30', '0.50', '0.30'] },
    { id: 'ui-2', task: 'ui-screenshot', state: 'needs_attention', minutes: 25, repairRounds: 2, costs: ['0.40', '1.10', '0.30', '0.60', '0.30', '0.60', '0.30'] },
    { id: 'be-1', task: 'backend', state: 'accepted', minutes: 9, repairRounds: 0, costs: ['0.30', '0.70', '0.25'] },
    { id: 'be-2', task: 'backend', state: 'accepted', minutes: 12, repairRounds: 1, costs: ['0.30', '0.80', null, '0.40', '0.25'] },
  ],
  'frontier-baseline': [
    { id: 'ui-1', task: 'ui-screenshot', state: 'accepted', minutes: 11, repairRounds: 0, costs: ['1.20', '3.10', '0.90'] },
    { id: 'ui-2', task: 'ui-screenshot', state: 'accepted', minutes: 15, repairRounds: 1, costs: ['1.20', '3.40', '0.90', '1.60', '0.90'] },
    { id: 'be-1', task: 'backend', state: 'accepted', minutes: 8, repairRounds: 0, costs: ['0.90', '2.20', '0.80'] },
    { id: 'be-2', task: 'backend', state: 'ready_for_acceptance', minutes: 10, repairRounds: 0, costs: ['0.90', '2.30', '0.80'] },
  ],
};

function build(arm: string, runs: FixtureRun[]) {
  const outRuns: (Run & { task: Task })[] = [], usage: UsageRecord[] = [];
  for (const f of runs) {
    const id = `${arm}:${f.id}`;
    outRuns.push({ ...newRun(id, 'synthetic fixture', 'fixture-base', start), state: f.state, endedAt: start + f.minutes * minute, review: f.repairRounds ? { repairRounds: f.repairRounds } as NonNullable<Run['review']> : null, task: f.task });
    f.costs.forEach((gross, i) => usage.push({
      attemptID: `${id}#${i}`, revision: 0, startedAt: new Date(start + i * minute).toISOString(), grossUsd: gross, creditUsd: null, cashUsd: null, provenance: 'estimated',
      providerID: 'fixture', modelID: 'fixture-model', effort: null, role: i === 0 ? 'planner' : 'coder', projectID: 'fixture', runID: id, stage: 'fixture', sessionID: 'fixture',
      messageID: null, inputTokens: null, outputTokens: null, reasoningTokens: null, billedOutputTokens: null, reasoningIncludedInOutput: null, serviceTier: null, billing: 'metered_api',
    }));
  }
  return { runs: outRuns, usage };
}

function fixtureReport() {
  const rows = Object.entries(fixtures).flatMap(([arm, list]) => {
    const { runs, usage } = build(arm, list);
    return [...(['ui-screenshot', 'backend'] as const).map(task => ({ arm, task, metrics: summarizeRuns(runs.filter(r => r.task === task), usage, period) })), { arm, task: 'all', metrics: summarizeRuns(runs, usage, period) }];
  });
  return { mode: 'fixtures', synthetic: true, notice: `SYNTHETIC FIXTURE DATA, not measurements. ${NOTICE}`, period, rows };
}

function main(argv: string[]): number {
  if (argv.includes('--fixtures')) {
    const report = fixtureReport();
    console.log('%s\n', report.notice);
    console.table(report.rows.map(({ arm, task, metrics: m }) => ({
      arm, task, runs: m.runs, accepted: m.accepted, completed: m.completed, unresolved: m.unresolved, repairRounds: m.repairRounds, elapsedMin: m.elapsedMs / minute,
      spendUsd: m.spend.knownUsd, unknown: m.spend.unknownCount, costPerAcceptedUsd: m.costPerAcceptedUsd ?? 'undefined', partial: m.partial,
    })));
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  const budget = argv.indexOf('--budget-usd');
  let budgetOk = false;
  try { budgetOk = budget >= 0 && parseUsd(argv[budget + 1] ?? '') > 0n; } catch { /* reported below */ }
  const missing = [
    argv.includes('--authorize-paid') ? '' : '--authorize-paid',
    budgetOk ? '' : '--budget-usd <positive amount>',
    process.env.FEATURE_PILOT_PAID_MEASUREMENT === '1' ? '' : 'environment FEATURE_PILOT_PAID_MEASUREMENT=1',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Refusing to run: only --fixtures mode is available without explicit paid-run authorization. Missing: ${missing.join(', ')}.\nUse: npm run measure -- --fixtures\n${NOTICE}`);
  } else {
    console.error(`Paid host runs are not implemented in this script. No run was started, no model was called and no results were produced.\nMeasure by hand with the method in docs/measurements.md and record observed numbers there.\n${NOTICE}`);
  }
  return 1;
}

process.exitCode = main(process.argv.slice(2));
