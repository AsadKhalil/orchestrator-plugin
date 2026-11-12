import type { PlanStep } from './plan.js';

export type ShellJob = { id: string; stepID: string; sessionID: string; contentVersion: string; kind: 'command' | 'service'; resources: PlanStep['resources']; startedAt: number; deadline: number; probeDeadline: number | null; shellID: string | null; status: 'pending' | 'running' | 'ready' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'unknown'; reason: string | null; exitCode: number | null; exitEvent: { id: string; fingerprint: string } | null };
export type StepOutcome = { stepID: string; inputContentVersion: string; contentVersion: string; evidence: string };
type ExitEvent = { eventID: string; shellID: string; status: 'exited' | 'timeout' | 'killed'; exit?: number; completedAt: number; currentContentVersion: string };
const active = (job: ShellJob) => ['pending', 'running', 'ready', 'unknown'].includes(job.status);
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

/** A pending job is a write-ahead intent; it is not proof that a process started. */
export function createShellJob(step: PlanStep, input: { id: string; sessionID: string; contentVersion: string; now: number }): ShellJob {
  if (!step.execution || !nonempty(input.id) || !nonempty(input.sessionID) || !nonempty(input.contentVersion) || !Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(step.execution.deadlineMs) || step.execution.deadlineMs < 1 || !Number.isSafeInteger(input.now + step.execution.deadlineMs)) throw new Error('Invalid shell job');
  return { id: input.id, stepID: step.id, sessionID: input.sessionID, contentVersion: input.contentVersion, kind: step.execution.kind, resources: structuredClone(step.resources), startedAt: input.now, deadline: input.now + step.execution.deadlineMs, probeDeadline: step.execution.kind === 'service' && step.execution.readyProbe ? Math.min(input.now + step.execution.readyProbe.deadlineMs, input.now + step.execution.deadlineMs) : null, shellID: null, status: 'pending', reason: null, exitCode: null, exitEvent: null };
}
/** A background tool result identifies a process but does not establish completion. */
export function attachShell(job: ShellJob, value: unknown): ShellJob {
  if (job.status !== 'pending' || !value || typeof value !== 'object') throw new Error('Invalid shell handle');
  const result = value as { output?: { status?: unknown; shellID?: unknown }; metadata?: { status?: unknown; shellID?: unknown } };
  const id = result.output?.shellID;
  if (result.output?.status !== 'running' || result.metadata?.status !== 'running' || typeof id !== 'string' || !id.startsWith('sh_') || id.length <= 3 || result.metadata?.shellID !== id) throw new Error('Invalid shell handle');
  return { ...job, shellID: id, status: 'running' };
}
export function applyShellExit(job: ShellJob, event: ExitEvent): ShellJob {
  if (!nonempty(event.eventID) || !nonempty(event.currentContentVersion) || !job.shellID || event.shellID !== job.shellID || !['exited', 'timeout', 'killed'].includes(event.status)) throw new Error('Invalid shell event');
  if (!Number.isSafeInteger(event.completedAt) || event.completedAt < job.startedAt) throw new Error('Invalid completion time');
  if (event.status === 'exited' && (!Number.isSafeInteger(event.exit) || (event.exit as number) < 0 || (event.exit as number) > 255)) throw new Error('Invalid exit code');
  const fingerprint = JSON.stringify([event.shellID, event.status, event.exit ?? null, event.completedAt]);
  if (job.exitEvent?.id === event.eventID) { if (job.exitEvent.fingerprint !== fingerprint) throw new Error('Shell event conflict'); return job; }
  if (job.exitEvent || !['running', 'ready', 'unknown'].includes(job.status)) throw new Error('Shell job already completed');
  const stale = event.currentContentVersion !== job.contentVersion;
  const status = stale ? 'unknown' : event.status === 'timeout' ? 'timed_out' : event.status === 'killed' ? 'cancelled' : event.completedAt > job.deadline ? 'timed_out' : job.kind === 'service' || event.exit !== 0 ? 'failed' : 'succeeded';
  return { ...job, status, reason: stale ? 'content_changed' : event.status === 'exited' && event.completedAt > job.deadline ? 'deadline_exceeded' : job.kind === 'service' && event.status === 'exited' ? 'service_exited' : null, exitCode: event.exit ?? null, exitEvent: { id: event.eventID, fingerprint } };
}
/** The caller must verify that the owned service is still running and execute the approved probe. */
export function markServiceReady(job: ShellJob, probe: { running: boolean; exitCode: number; checkedAt: number; contentVersion: string }): ShellJob {
  if (job.kind !== 'service' || job.status !== 'running' || probe.running !== true || probe.exitCode !== 0 || !Number.isSafeInteger(probe.checkedAt) || job.probeDeadline === null || probe.checkedAt < job.startedAt || probe.checkedAt > job.probeDeadline || probe.contentVersion !== job.contentVersion) throw new Error('Service readiness probe failed');
  return { ...job, status: 'ready' };
}
export function expireJob(job: ShellJob, now: number): ShellJob {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid time');
  if (!active(job) || now < job.deadline) return job;
  return { ...job, status: 'unknown', reason: 'deadline_unconfirmed' };
}
/** Unknown resources serialize; no additional shell or writer overlaps an active job. */
export function canStartStep(step: PlanStep, jobs: readonly ShellJob[], currentContentVersion: string, outcomes: readonly StepOutcome[] = []): boolean {
  if (!nonempty(currentContentVersion)) return false;
  for (const dep of step.dependsOn) {
    const job = [...jobs].reverse().find(item => item.stepID === dep);
    const outcome = [...outcomes].reverse().find(item => item.stepID === dep);
    if (job ? job.contentVersion !== currentContentVersion || !(job.status === 'succeeded' || (job.kind === 'service' && job.status === 'ready')) : !outcome || outcome.contentVersion !== currentContentVersion) return false;
  }
  const running = jobs.filter(active);
  if (!running.length) return true;
  if (step.execution || !step.resources || step.resources.write.length) return false;
  return running.every(job => job.resources !== null && job.resources.write.length === 0);
}

/** Validate durable records against the approved step that created them. */
export function validateShellJobs(jobs: readonly ShellJob[], steps: readonly PlanStep[]): void {
  if (!Array.isArray(jobs) || jobs.length > 1000) throw new Error('Invalid jobs');
  const ids = new Set<string>(), shellIDs = new Set<string>(), events = new Set<string>(); let activeCount = 0;
  for (const job of jobs) {
    if (!job || !nonempty(job.id) || ids.has(job.id) || !nonempty(job.stepID) || !nonempty(job.sessionID) || !nonempty(job.contentVersion) || !Number.isSafeInteger(job.startedAt) || job.startedAt < 0 || !Number.isSafeInteger(job.deadline) || job.deadline < 1 || !['pending','running','ready','succeeded','failed','cancelled','timed_out','unknown'].includes(job.status)) throw new Error('Invalid job record');
    ids.add(job.id);
    const step = steps.find(item => item.id === job.stepID);
    if (!step?.execution || step.execution.kind !== job.kind || JSON.stringify(step.resources && [step.resources.read, step.resources.write]) !== JSON.stringify(job.resources && [job.resources.read, job.resources.write]) || job.deadline !== job.startedAt + step.execution.deadlineMs || job.probeDeadline !== (step.execution.kind === 'service' && step.execution.readyProbe ? Math.min(job.startedAt + step.execution.readyProbe.deadlineMs, job.deadline) : null)) throw new Error('Job does not match approved step');
    if (job.reason !== null && !nonempty(job.reason)) throw new Error('Invalid job reason');
    if (job.shellID !== null) { if (!nonempty(job.shellID) || !job.shellID.startsWith('sh_') || shellIDs.has(job.shellID)) throw new Error('Invalid job shell'); shellIDs.add(job.shellID); }
    if ((job.status === 'pending' && job.shellID !== null) || (['running','ready','succeeded','failed','cancelled','timed_out'].includes(job.status) && !job.shellID) || (job.status === 'ready' && job.kind !== 'service')) throw new Error('Invalid job state');
    if (job.exitCode !== null && (!Number.isSafeInteger(job.exitCode) || job.exitCode < 0 || job.exitCode > 255)) throw new Error('Invalid job exit code');
    if (job.exitEvent !== null) {
      if (!job.exitEvent || !nonempty(job.exitEvent.id) || !nonempty(job.exitEvent.fingerprint) || events.has(job.exitEvent.id)) throw new Error('Invalid job event');
      events.add(job.exitEvent.id);
      let evidence: unknown; try { evidence = JSON.parse(job.exitEvent.fingerprint); } catch { throw new Error('Invalid job event'); }
      if (!Array.isArray(evidence) || evidence.length !== 4 || evidence[0] !== job.shellID || !['exited', 'timeout', 'killed'].includes(evidence[1]) || evidence[2] !== job.exitCode || !Number.isSafeInteger(evidence[3]) || evidence[3] < job.startedAt || (evidence[1] === 'exited' && (!Number.isSafeInteger(evidence[2]) || evidence[2] < 0 || evidence[2] > 255))) throw new Error('Invalid job event evidence');
      const expected = job.reason === 'content_changed' ? 'unknown' : evidence[1] === 'timeout' ? 'timed_out' : evidence[1] === 'killed' ? 'cancelled' : evidence[3] > job.deadline ? 'timed_out' : job.kind === 'service' || evidence[2] !== 0 ? 'failed' : 'succeeded';
      if (job.status !== expected) throw new Error('Job outcome conflicts with event');
    }
    if (['succeeded','failed','cancelled','timed_out'].includes(job.status) && !job.exitEvent) throw new Error('Missing job exit event');
    if (['pending','running','ready'].includes(job.status) && (job.exitEvent !== null || job.exitCode !== null || job.reason !== null)) throw new Error('Invalid active job');
    if (job.status === 'succeeded' && (job.kind !== 'command' || job.exitCode !== 0)) throw new Error('Invalid successful job');
    if (active(job)) activeCount++;
  }
  if (activeCount > 1) throw new Error('Multiple active shell jobs');
}
