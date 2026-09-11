import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertGoalExecution, stable } from './wayper-context-identity.mjs';
import { PLAN_ID, digest } from './wayper-validation-policy.mjs';
import { buildValidationPlan, validateValidationPlan, evaluateValidationPlan } from './wayper-validation-planner.mjs';

export function validationPlanPath(id, options) {
  assertGoalExecution(options.execution);
  if (!PLAN_ID.test(id) || !path.isAbsolute(options.root ?? '')) throw new Error('Invalid plan store reference');
  let directory = fs.realpathSync(options.root);
  for (const part of ['.wayper-context', 'validation', options.execution.identity.goalRunId, `r${options.execution.identity.revision}`]) {
    directory = path.join(directory, part);
    const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Unsafe plan directory');
  }
  const file = path.join(directory, `${id}.json`); const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262_144)) throw new Error('Unsafe plan file');
  return file;
}

export function readValidationPlan(id, options) {
  const file = validationPlanPath(id, options);
  if (!fs.existsSync(file)) return null;
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (plan.planId !== id) throw new Error('Plan filename mismatch');
  return plan;
}

export function persistValidationPlan(plan, options) {
  if (validateValidationPlan(plan, options).status !== 'VALID') throw new Error('Invalid or stale plan cannot be issued');
  const file = validationPlanPath(plan.planId, options); const content = JSON.stringify(plan);
  if (Buffer.byteLength(content) > 262_144) throw new Error('Plan exceeds byte budget');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, file); } catch (error) {
      if (error.code !== 'EEXIST' || stable(readValidationPlan(plan.planId, options)) !== stable(plan)) throw error;
    }
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  return plan;
}

export function listValidationPlans(options) {
  const dir = path.dirname(validationPlanPath(`VP-${'0'.repeat(64)}`, options));
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /^VP-[a-f0-9]{64}\.json$/.test(name)).sort()
    .map((name) => readValidationPlan(name.slice(0, -5), options)) : [];
}

export const validationOwnerFingerprint = (map) => digest({ taskClass: map.taskClass, repositories: map.repositories,
  capabilities: { required: map.capabilities.required, optional: map.capabilities.optional }, risks: map.risks, invariants: map.invariants });

export function validationPlanIndex(plan, assessment, ownerContextFingerprint, availability = []) {
  return { planId: plan.planId, fingerprint: plan.fingerprint, ownerContextFingerprint, availability,
    status: assessment.status, reasons: assessment.reasons, metrics: assessment.metrics,
    requirements: assessment.requirements.map((r) => ({ ...r,
      scope: plan.requirements.find((p) => p.validationRequirementId === r.validationRequirementId).scope })) };
}

export function createContextValidationPlan(map, input, options) {
  if (!input || Object.keys(input).some((key) => !['inputs', 'availability'].includes(key))) throw new Error('Invalid plan request');
  const plan = buildValidationPlan({ ...options, inputs: input.inputs });
  if (plan.taskClass !== map.taskClass || input.inputs.repositories.some((r) => !map.repositories.includes(r.repository))) {
    throw new Error('Plan outside Working Context');
  }
  const capabilities = new Set(plan.inputs.repositories.flatMap((r) => r.capabilities));
  const risks = new Set(plan.inputs.repositories.flatMap((r) => r.risks));
  if (map.capabilities.required.some((id) => !capabilities.has(id)) || map.risks.some((id) => !risks.has(id))) {
    throw new Error('PLAN_INPUT_INCOMPLETE: Context Map capabilities or risks omitted');
  }
  const assessment = evaluateValidationPlan(plan, { ...options, inputs: input.inputs, availability: input.availability });
  if (assessment.status === 'REPLAN_REQUIRED') throw new Error(assessment.reasons.join(','));
  persistValidationPlan(plan, { ...options, inputs: input.inputs });
  return validationPlanIndex(plan, assessment, validationOwnerFingerprint(map), input.availability);
}

export function refreshContextValidationPlan(map, options) {
  const ref = map.validationPlan;
  if (!ref) return null;
  try {
    const plan = readValidationPlan(ref.planId, options);
    if (!plan || ref.ownerContextFingerprint !== validationOwnerFingerprint(map)) throw new Error('PLAN_OWNER_OR_REVISION_CHANGED');
    const assessment = evaluateValidationPlan(plan, { ...options, inputs: options.inputs ?? plan.inputs, availability: ref.availability });
    return validationPlanIndex(plan, assessment, ref.ownerContextFingerprint, ref.availability);
  } catch {
    return { ...ref, status: 'REPLAN_REQUIRED', reasons: ['PLAN_UNAVAILABLE_OR_OWNER_CHANGED'], requirements: [], metrics: null };
  }
}

export function packetValidationRequirements(map, repositories, paths) {
  if (!map.validationPlan) return [];
  return map.validationPlan.requirements.filter((r) => repositories.includes(r.repository) &&
    (!paths.length || r.scope.some((p) => paths.includes(`${r.repository}:${p}`))))
    .map(({ validationRequirementId, repository, platform, level, required, blocking, status, acceptedReceiptIds }) =>
      ({ validationRequirementId, repository, platform, level, required, blocking, status, acceptedReceiptIds }));
}
