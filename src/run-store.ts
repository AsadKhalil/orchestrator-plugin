import { applyPlannerOutput, applyReviewerOutput } from './prompts.js';
import { newRun, setPlan, approvePlan, beginImplementation, updateRequirement, validateRun, startReview, recordReview, acceptRun, askQuestions, answerQuestions, recordJobIntent, recordJobHandle, recordJobExit, recordJobReady, recordJobDeadline, recordStepOutcome, requestStop } from './run.js';

type Run = ReturnType<typeof newRun>;
type Plan = Parameters<typeof setPlan>[2];
type Store = { get(key: string): Promise<unknown>; set(key: string, value: Run): Promise<void>; mutate?(key: string, change: (value: unknown) => Run): Promise<Run>; compareAndSet?(key: string, expected: unknown, value: Run): Promise<boolean> };
// shortcut: this serializes only this loaded module; add host-wide transactions before execution.
let queue: Promise<void> = Promise.resolve();
const keyFor = (id: string) => `runs/${encodeURIComponent(id)}`;

/** Serializes transitions in this loaded module. */
export class RunRepository {
  constructor(private readonly store: Store) {}
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private async read(id: string): Promise<Run> {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Run ID is required');
    return this.check(id, await this.store.get(keyFor(id)));
  }
  private check(id: string, value: unknown): Run {
    if (value === undefined) throw new Error('Run not found');
    const run = validateRun(value);
    if (run.id !== id) throw new Error('Run identity mismatch');
    return run;
  }
  private async compareAndSet(key: string, change: (value: unknown) => Run): Promise<Run> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = await this.store.get(key), next = change(previous);
      const updated = await this.store.compareAndSet!(key, previous, next);
      if (updated === true) return structuredClone(next);
      if (updated !== false) throw new Error('Invalid compare-and-set response');
    }
    throw new Error('Run update contention; retry');
  }
  private update(id: string, transition: (run: Run) => Run): Promise<Run> {
    if (typeof id !== 'string' || !id.trim()) return Promise.reject(new Error('Run ID is required'));
    return this.serial(async () => {
      if (this.store.mutate) return structuredClone(await this.store.mutate(keyFor(id), value => transition(this.check(id, value))));
      if (this.store.compareAndSet) return this.compareAndSet(keyFor(id), value => transition(this.check(id, value)));
      const run = transition(await this.read(id));
      await this.store.set(keyFor(id), run);
      return structuredClone(run);
    });
  }
  get(id: string): Promise<Run> { return this.serial(() => this.read(id)); }
  create(id: string, requirement: string, baseCommit: string): Promise<Run> {
    return this.serial(async () => {
      const run = newRun(id, requirement, baseCommit);
      if (this.store.mutate) return structuredClone(await this.store.mutate(keyFor(id), value => { if (value !== undefined) throw new Error('Run already exists'); return run; }));
      if (this.store.compareAndSet) return this.compareAndSet(keyFor(id), value => { if (value !== undefined) throw new Error('Run already exists'); return run; });
      if (await this.store.get(keyFor(id)) !== undefined) throw new Error('Run already exists');
      await this.store.set(keyFor(id), run);
      return structuredClone(run);
    });
  }
  applyPlannerOutput(id: string, revision: number, output: string): Promise<Run> { return this.update(id, run => applyPlannerOutput(run, revision, output)); }
  applyReviewerOutput(id: string, revision: number, output: string): Promise<Run> { return this.update(id, run => applyReviewerOutput(run, revision, output)); }
  askQuestions(id: string, revision: number, questions: Parameters<typeof askQuestions>[2]): Promise<Run> { return this.update(id, run => askQuestions(run, revision, questions)); }
  answerQuestions(id: string, revision: number, answers: Parameters<typeof answerQuestions>[2]): Promise<Run> { return this.update(id, run => answerQuestions(run, revision, answers)); }
  setPlan(id: string, revision: number, plan: Plan): Promise<Run> { return this.update(id, run => setPlan(run, revision, plan)); }
  approve(id: string, revision: number, hash: string): Promise<Run> { return this.update(id, run => approvePlan(run, revision, hash)); }
  changeRequirement(id: string, revision: number, requirement: string): Promise<Run> { return this.update(id, run => updateRequirement(run, revision, requirement)); }
  requestStop(id: string, revision: number): Promise<Run> { return this.update(id, run => requestStop(run, revision)); }
  begin(id: string, revision: number): Promise<Run> { return this.update(id, run => beginImplementation(run, revision)); }
  recordStepOutcome(id: string, revision: number, outcome: Parameters<typeof recordStepOutcome>[2]): Promise<Run> { return this.update(id, run => recordStepOutcome(run, revision, outcome)); }
  recordJobIntent(id: string, revision: number, stepID: string, input: Parameters<typeof recordJobIntent>[3]): Promise<Run> { return this.update(id, run => recordJobIntent(run, revision, stepID, input)); }
  recordJobHandle(id: string, revision: number, jobID: string, result: unknown): Promise<Run> { return this.update(id, run => recordJobHandle(run, revision, jobID, result)); }
  recordJobExit(id: string, revision: number, jobID: string, event: Parameters<typeof recordJobExit>[3]): Promise<Run> { return this.update(id, run => recordJobExit(run, revision, jobID, event)); }
  recordJobReady(id: string, revision: number, jobID: string, probe: Parameters<typeof recordJobReady>[3]): Promise<Run> { return this.update(id, run => recordJobReady(run, revision, jobID, probe)); }
  recordJobDeadline(id: string, revision: number, jobID: string, now: number): Promise<Run> { return this.update(id, run => recordJobDeadline(run, revision, jobID, now)); }
  startReview(id: string, revision: number, input: Parameters<typeof startReview>[2]): Promise<Run> { return this.update(id, run => startReview(run, revision, input)); }
  recordReview(id: string, revision: number, result: Parameters<typeof recordReview>[2]): Promise<Run> { return this.update(id, run => recordReview(run, revision, result)); }
  accept(id: string, revision: number): Promise<Run> { return this.update(id, run => acceptRun(run, revision)); }
}

/** Create a repository using the plugin's durable JSON storage. */
export function createRunRepository(context: Pick<import('@opencode/plugin').Plugin.Context, 'storage'>, prefix = ''): RunRepository {
  const storage = context.storage as typeof context.storage & { compareAndSet?: (key: string, expected: unknown, value: unknown) => Promise<boolean> };
  return new RunRepository({
    get: key => storage.get(prefix + key), set: (key, value) => storage.set(prefix + key, value as never),
    ...(typeof storage.compareAndSet === 'function' ? { compareAndSet: (key: string, expected: unknown, value: Run) => storage.compareAndSet!(prefix + key, expected, value) } : {}),
  });
}
