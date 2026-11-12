export type PlanStep = {
  id: string; description: string; role: 'planner' | 'coder' | 'reviewer';
  taskKind: 'clarify' | 'research' | 'design' | 'implement' | 'debug' | 'validate' | 'visual_inspect' | 'browser_check' | 'review' | 'summarize' | 'process_status';
  dependsOn: string[]; resources: { read: string[]; write: string[] } | null; inference: boolean; completion: string;
  execution: { kind: 'command' | 'service'; command: string; deadlineMs: number; readyProbe: { command: string; deadlineMs: number } | null } | null;
};
export type Plan = { steps: PlanStep[]; acceptance: { id: string; description: string }[]; questions: { question: string; answer: string }[]; validationCommands: string[]; areas: string[]; rollback: string };
const kinds = ['clarify', 'research', 'design', 'implement', 'debug', 'validate', 'visual_inspect', 'browser_check', 'review', 'summarize', 'process_status'];
function keys(value: unknown, names: string[]): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...names].sort()); }
function text(value: unknown, name: string): asserts value is string { if (typeof value !== 'string' || !value.trim() || value.length > 10_000) throw new Error(`Invalid ${name}`); }
function texts(value: unknown, name: string, nonempty = false): asserts value is string[] {
  if (!Array.isArray(value) || (nonempty && !value.length) || value.length > 100) throw new Error(`Invalid ${name}`);
  if (new Set(value).size !== value.length) throw new Error(`Duplicate ${name}`);
  for (const item of value) text(item, name);
}
function deadline(value: unknown) { if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 3_600_000) throw new Error('Invalid deadline'); }
export function validatePlan(value: unknown): asserts value is Plan {
  if (!keys(value, ['steps', 'acceptance', 'questions', 'validationCommands', 'areas', 'rollback'])) throw new Error('Invalid plan');
  if (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > 100 || !Array.isArray(value.acceptance) || !value.acceptance.length || value.acceptance.length > 100 || !Array.isArray(value.questions) || value.questions.length > 100) throw new Error('Invalid plan');
  texts(value.validationCommands, 'validation commands', true); texts(value.areas, 'affected areas', true); text(value.rollback, 'rollback');
  const ids = new Set<string>();
  for (const item of value.steps) {
    if (!keys(item, ['id', 'description', 'role', 'taskKind', 'dependsOn', 'resources', 'inference', 'completion', 'execution'])) throw new Error('Invalid plan step');
    text(item.id, 'step ID'); text(item.description, 'step description'); text(item.completion, 'completion condition');
    if (ids.has(item.id)) throw new Error('Duplicate step ID'); ids.add(item.id);
    if (!['planner', 'coder', 'reviewer'].includes(item.role as string) || !kinds.includes(item.taskKind as string) || typeof item.inference !== 'boolean') throw new Error('Invalid step role or task');
    if (['validate', 'process_status'].includes(item.taskKind as string) && item.inference) throw new Error('Tool/status step cannot require model inference');
    texts(item.dependsOn, 'dependencies');
    if (item.resources !== null) { if (!keys(item.resources, ['read', 'write'])) throw new Error('Invalid resources'); texts(item.resources.read, 'read resources'); texts(item.resources.write, 'write resources'); if ((item.role === 'planner' || item.role === 'reviewer') && item.resources.write.length) throw new Error('Read-only role cannot declare writes'); }
    if (item.execution !== null) {
      if (!keys(item.execution, ['kind', 'command', 'deadlineMs', 'readyProbe']) || !['command', 'service'].includes(item.execution.kind as string)) throw new Error('Invalid execution');
      text(item.execution.command, 'command'); deadline(item.execution.deadlineMs);
      const probe = item.execution.readyProbe;
      if (item.execution.kind === 'service') { if (!keys(probe, ['command', 'deadlineMs'])) throw new Error('Service readiness probe required'); text(probe.command, 'probe command'); deadline(probe.deadlineMs); }
      else if (probe !== null) throw new Error('Unexpected service probe');
    }
  }
  for (const item of value.steps as PlanStep[]) for (const dep of item.dependsOn) if (!ids.has(dep)) throw new Error('Unknown dependency');
  const steps = new Map((value.steps as PlanStep[]).map(item => [item.id, item])); const active = new Set<string>(), done = new Set<string>();
  function visit(id: string) { if (active.has(id)) throw new Error('Dependency cycle'); if (done.has(id)) return; active.add(id); for (const dep of steps.get(id)!.dependsOn) visit(dep); active.delete(id); done.add(id); }
  for (const id of ids) visit(id);
  const criteria = new Set<string>();
  for (const item of value.acceptance) { if (!keys(item, ['id', 'description'])) throw new Error('Invalid acceptance criterion'); text(item.id, 'criterion ID'); text(item.description, 'criterion description'); if (criteria.has(item.id)) throw new Error('Duplicate criterion ID'); criteria.add(item.id); }
  for (const item of value.questions) { if (!keys(item, ['question', 'answer'])) throw new Error('Invalid question'); text(item.question, 'question'); text(item.answer, 'question answer'); }
}
/** Arrays provide a stable field order independent of object key insertion order. */
export function canonicalPlan(plan: Plan): unknown {
  validatePlan(plan);
  return [plan.steps.map(s => [s.id, s.description, s.role, s.taskKind, s.dependsOn, s.resources && [s.resources.read, s.resources.write], s.inference, s.completion, s.execution && [s.execution.kind, s.execution.command, s.execution.deadlineMs, s.execution.readyProbe && [s.execution.readyProbe.command, s.execution.readyProbe.deadlineMs]]]), plan.acceptance.map(c => [c.id, c.description]), plan.questions.map(q => [q.question, q.answer]), plan.validationCommands, plan.areas, plan.rollback];
}
