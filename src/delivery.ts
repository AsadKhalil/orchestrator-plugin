import { validateRun } from './run.js';

/** Construct a local preview from run artifacts only; no filesystem or network write occurs. */
export function exportRunPreview(value: unknown): string {
  const run = validateRun(value);
  const validation = (item: NonNullable<NonNullable<typeof run.review>['pending']>['validation']) => ({ diffHash: item.diffHash, commands: item.commands.map(command => ({ command: command.command, exitCode: command.exitCode })) });
  const report = {
    format: 'feature-pilot-run-v1',
    run: { id: run.id, revision: run.revision, state: run.state, stopRequested: run.stopRequested, baseCommit: run.baseCommit },
    requirement: run.requirement,
    clarification: run.clarification.map(item => ({ id: item.id, question: item.question, answer: item.answer })),
    plan: run.plan,
    planHash: run.planHash,
    approval: run.approval && { type: run.approval.type, planHash: run.approval.planHash },
    review: run.review === null ? null : {
      reviewer: { providerID: run.review.reviewer.providerID, id: run.review.reviewer.id, variant: run.review.reviewer.variant, vendor: run.review.reviewer.vendor, modelVersion: run.review.reviewer.modelVersion },
      contributingVendors: run.review.contributingVendors, repairRounds: run.review.repairRounds,
      pending: run.review.pending && { diffHash: run.review.pending.diffHash, validation: validation(run.review.pending.validation) },
      reviews: run.review.reviews.map(item => ({ diffHash: item.diffHash, validation: validation(item.validation), verdict: item.verdict, findings: item.findings.map(f => ({ id: f.id, severity: f.severity, description: f.description, evidence: f.evidence })) })),
    },
    limitations: { diff: 'not included; complete worktree identity is unverified', costs: 'not included; complete run accounting is unavailable', recommendation: 'not recorded' },
  };
  const text = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(text, 'utf8') > 2_000_000) throw new Error('Run export too large');
  return text;
}
