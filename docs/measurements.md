# Measuring workflow cost

## Status: no measured savings exist yet

No paid, matched comparison has been run. `npm run measure -- --fixtures` prints invented numbers that exercise the report format; they are not results and must not be quoted. Until the evidence below exists, no document, UI text or export may claim that dynamic routing saves money, time or effort.

A claim needs all of the following:

1. Matched runs for both arms (below) completed with recorded acceptance, not only the runs that went well.
2. More than two examples. Two tasks, one screenshot/UI task and one backend task, are the minimum shape of the method; two examples never establish a universal saving. Repeat each task enough times to show spread, and report that spread.
3. Every billed attempt included: failures, retries, repair rounds, review and auxiliary calls. Unknown charges keep the result marked partial.
4. The exact model IDs and reasoning efforts, rates with source and check date, the plugin commit, host version, platform and dates.
5. An explanation of any run that was excluded and why.

Results are reported as observations ("on these N runs"), never as a percentage that is assumed to generalise.

## Method

1. **Snapshot.** Create one clean repository snapshot (a fixed commit) per task. Every run of either arm starts from an identical copy; no run sees another run's changes or cache.
2. **Tasks and acceptance.** Fix the task text and its observable acceptance criteria before running anything, and do not change them between arms. Use at least one screenshot-dependent UI task and one backend task. The same person, applying the same criteria, accepts or rejects each result.
3. **Arms.**
   - *Dynamic routing*: the plugin's recommended planner, coder and reviewer for the task, under the configured quality floors and budgets.
   - *Baseline*: one qualifying frontier model for every stage, chosen and recorded before the runs. State why it qualifies (the quality floor used); the floor is the user's choice, not an objective definition of frontier.
4. **Run.** Approve each plan once per arm, then let the workflow run to `ready_for_acceptance`, `needs_attention` or `cancelled`. Do not hand-edit code during a run. Set the same budgets and repair limit for both arms.
5. **Record, per run:** state, accepted yes/no with reason, every attempt (provider, model, effort, role, billed cost or unknown), retries and provider failures, repair rounds, and wall-clock latency from creation to end. Keep failed and abandoned runs.
6. **Summarise** with the same code the product uses: `summarizeRuns(runs, usage, period)` for counts, repair rounds, elapsed time, gross spend and cost per accepted feature. Choose a period that starts before the first run and ends after the last attempt settles; an attempt that starts after the period end is not counted.
7. **Subscription comparison** (optional, separate from the arm comparison): feed `meteredUsageForComparison(usage)` to `compareCosts`. Subscription and local attempts are reported as counts with unknown allowance use, never as dollars.

## How the numbers are defined

- Cost per accepted feature is the total known gross spend of **all** runs in the period (failed ones included) divided by the number of accepted runs, rounded up at 12 decimal places. With zero accepted runs it is undefined and is shown as no value, never zero.
- Unknown charges are counted and never treated as zero; the total is then a lower bound and marked partial.
- Usage records are deduplicated by attempt, keeping the highest revision; a replay that disagrees is rejected.
- Money is exact decimal arithmetic, not floating point. Reservations are not spending. Calendar-month reports, billing cycles, subscription fees and operating costs stay separate.

## Fixture mode and paid mode

`npm run measure -- --fixtures` runs deterministic synthetic runs through `summarizeRuns`, prints a table and JSON, and states that the data is synthetic. Any other invocation exits non-zero. Paid mode needs `--authorize-paid`, `--budget-usd <amount>` and `FEATURE_PILOT_PAID_MEASUREMENT=1`; even then the script has no host integration, says so and exits non-zero without starting a run. Paid measurements are currently done by hand with the method above, and their observed numbers recorded here, with dates, once they exist.

## Observed results

None yet.
