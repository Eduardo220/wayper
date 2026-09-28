import { assertGoalExecution, repositorySnapshot, stable } from './wayper-context-identity.mjs';
import { evaluateEvidenceRequirement, listReceipts, readReceipt } from './wayper-evidence-store.mjs';
import { loadValidationRegistry, validateValidationRegistry, normalizeValidationInputs, matchValidationRule,
  candidateCheck, digest, sorted, canonical, exact, REQUIREMENT_ID } from './wayper-validation-policy.mjs';

const seal = (content) => { const fingerprint = digest(content); return { ...content, fingerprint, planId: `VP-${fingerprint.slice(7)}` }; };
const optionsRegistry = (options) => options.registry ?? loadValidationRegistry();

export function buildValidationPlan(options) {
  assertGoalExecution(options.execution);
  const registry = optionsRegistry(options);
  const checked = validateValidationRegistry(registry, { checkFiles: false });
  if (checked.status !== 'VALID') throw new Error(`INVALID_VALIDATION_REGISTRY: ${checked.errors.join(',')}`);
  const inputs = normalizeValidationInputs(options.inputs, registry);
  const requirements = new Map();
  const repositories = inputs.repositories.map((facts) => {
    const definition = options.repositories?.find((r) => r.id === facts.repository);
    const baseline = options.execution.baseline.repositories.find((r) => r.repositoryId === facts.repository);
    if (!definition || !baseline) throw new Error('PLAN_INPUT_INCOMPLETE: repository outside Goal baseline');
    const snapshot = repositorySnapshot(definition);
    if (snapshot.checkoutFingerprint !== baseline.checkoutFingerprint) throw new Error('WRONG_REPOSITORY');
    return snapshot;
  });
  for (const repo of inputs.repositories) for (const rule of registry.rules) {
    if (!rule.repositories.includes(repo.repository)) continue;
    const criteria = rule.when.claims ? inputs.criteria.filter((c) => c.repository === repo.repository) : [null];
    for (const criterion of criteria) {
      const reason = matchValidationRule(rule, inputs, repo, criterion);
      if (!reason) continue;
      for (const id of rule.checks) {
        const check = registry.checks.find((c) => c.id === id);
        if (check.repository !== repo.repository) continue;
        const platforms = criterion ? [criterion.platform] : check.platform !== 'shared' ? [check.platform] :
          ['L0', 'L1', 'L2'].includes(check.level) ? ['shared'] : repo.platforms;
        for (const platform of platforms) {
          const candidate = candidateCheck(check, repo, options.repositories);
          const key = { repository: repo.repository, platform, level: check.level, checkId: id,
            criterionId: criterion?.id ?? null, scope: repo.changedPaths };
          const validationRequirementId = `VR-${digest(key).slice(7, 31)}`;
          const prior = requirements.get(validationRequirementId);
          if (prior) { prior.reason.push(reason); continue; }
          const applicable = platform === 'shared' || repo.platforms.includes(platform);
          const command = candidate.type === 'COMMAND';
          const target = `validation:${repo.repository}:${platform}:${id}:${digest({ repo, criterion }).slice(7, 23)}`;
          requirements.set(validationRequirementId, { validationRequirementId, level: check.level,
            kind: command || candidate.type === 'OWNER_TESTS' ? 'CHECK' : 'OBSERVED_SCENARIO',
            scope: repo.changedPaths, repository: repo.repository, platform, criterionId: criterion?.id ?? null,
            reason: [reason], required: criterion?.required ?? true, blocking: criterion?.blocking ?? true,
            applicability: { status: applicable ? 'APPLICABLE' : 'NOT_APPLICABLE',
              reason: applicable ? 'RULE_MATCHED' : 'PLATFORM_OUT_OF_SCOPE', platformsInScope: repo.platforms },
            evidencePolicy: { receiptRequirement: { kinds: command || candidate.type === 'OWNER_TESTS' ?
              check.level === 'L0' || check.level === 'L4' ? ['COMMAND', 'QUALITY_GATE'] : ['TEST', 'QUALITY_GATE'] : ['RUNTIME'],
            repository: repo.repository, target, result: 'PASS' },
            commandFingerprints: command ? [digest({ command: candidate.command, args: candidate.args })] : [],
            cwd: '.', environment: check.level === 'L5' ? 'PHYSICAL_DEVICE' : check.level === 'L6' ? 'REAL_SCENARIO' :
              criterion?.claim === 'REMOTE_SERVICE' ? 'REMOTE_SERVICE' : platform },
            candidateChecks: [candidate], dependencies: [] });
        }
      }
    }
  }
  const values = [...requirements.values()].sort((a, b) => a.validationRequirementId.localeCompare(b.validationRequirementId));
  if (!values.length || values.length > 128) throw new Error('PLAN_INPUT_INCOMPLETE: requirement budget');
  for (const requirement of values) {
    requirement.reason.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    requirement.dependencies = values.filter((r) => r.repository === requirement.repository && r.level === 'L0' &&
      requirement.level !== 'L0' && r.applicability.status === 'APPLICABLE').map((r) => r.validationRequirementId);
  }
  return canonical(seal({ schemaVersion: 1, goalReference: options.execution.identity,
    baselineReference: { fingerprint: options.execution.baseline.fingerprint }, repositories,
    operation: inputs.operation, taskClass: inputs.taskClass, inputs, registryFingerprint: digest(registry),
    requirements: values, status: 'PLANNED' }));
}

export function validateValidationPlan(plan, options) {
  const reasons = [];
  try {
    if (!exact(plan, 'schemaVersion goalReference baselineReference repositories operation taskClass inputs registryFingerprint requirements status fingerprint planId')) {
      throw new Error('INVALID_PLAN_SCHEMA');
    }
    const { planId, fingerprint, ...content } = plan;
    if (seal(content).planId !== planId || seal(content).fingerprint !== fingerprint) throw new Error('INVALID_PLAN_FINGERPRINT');
    if (stable(plan.goalReference) !== stable(options.execution?.identity)) reasons.push('WRONG_GOAL_OR_REVISION');
    if (plan.baselineReference.fingerprint !== options.execution?.baseline.fingerprint) reasons.push('WRONG_BASELINE');
    // Rebuild from current owner inputs: rehashing a downgraded requirement never grants authority.
    if (stable(buildValidationPlan(options)) !== stable(plan)) reasons.push('PLAN_INPUT_REGISTRY_OR_STATE_CHANGED');
  } catch (error) { reasons.push(error.message); }
  return { status: reasons.length ? 'REPLAN_REQUIRED' : 'VALID', reasons: sorted(reasons) };
}

function executionReceipt(receipt, options) {
  return receipt.kind === 'COMMAND' ? receipt : readReceipt(receipt.observation.commandReceiptId, options);
}

function approvedCommand(receipt, policy, options) {
  try {
    const execution = executionReceipt(receipt, options);
    return policy.commandFingerprints.includes(execution?.observation.commandFingerprint) && execution.observation.cwd === policy.cwd;
  } catch { return false; }
}

function assessRequirement(requirement, ids, options, availability) {
  const base = { validationRequirementId: requirement.validationRequirementId, repository: requirement.repository,
    platform: requirement.platform, level: requirement.level, required: requirement.required, blocking: requirement.blocking,
    acceptedReceiptIds: [], rejectedReceiptIds: [], reasons: [] };
  if (requirement.applicability.status === 'NOT_APPLICABLE') return { ...base, status: 'NOT_APPLICABLE', reasons: ['PLATFORM_OUT_OF_SCOPE'] };
  const policy = requirement.evidencePolicy;
  // Reuse prior owner labels only when the actual approved argv proves the same check.
  const relevant = options.receiptIds ? ids : ids.filter((id) => {
    try { const receipt = readReceipt(id, options); return receipt?.subject.target === policy.receiptRequirement.target ||
      approvedCommand(receipt, policy, options); } catch { return false; }
  });
  const groups = relevant.map((id) => {
    let receipt;
    try { receipt = readReceipt(id, options); } catch { /* Phase2 reports invalid/missing references. */ }
    const requirement = approvedCommand(receipt, policy, options) ? { ...policy.receiptRequirement, target: receipt.subject.target } : policy.receiptRequirement;
    return evaluateEvidenceRequirement(requirement, [id], options);
  });
  const rejected = []; const accepted = []; const reasons = []; let stale = false; let unverified = false; let failed = false;
  for (const checked of groups.flatMap((group) => group.receipts)) {
    let receipt;
    try { receipt = readReceipt(checked.receiptId, options); } catch { /* Missing/corrupt references stay rejected. */ }
    const compatible = groups.some((group) => group.acceptedReceiptIds.includes(checked.receiptId));
    const approved = checked.status === 'VALID' && approvedCommand(receipt, policy, options);
    if (compatible && approved) accepted.push(checked.receiptId);
    else {
      rejected.push(checked.receiptId); reasons.push(...checked.reasons);
      if (compatible) reasons.push('UNAPPROVED_CHECK_OR_ENVIRONMENT');
      stale ||= checked.status === 'STALE'; unverified ||= checked.status === 'UNVERIFIED';
      failed ||= approved && receipt?.result === 'FAIL' && policy.receiptRequirement.kinds.includes(receipt.kind);
    }
  }
  const missingObserver = requirement.kind === 'OBSERVED_SCENARIO';
  const missingCheck = !requirement.candidateChecks.some((c) => c.type === 'COMMAND' && c.available);
  const unavailable = availability?.status === 'UNAVAILABLE' || missingObserver || missingCheck;
  const status = accepted.length ? 'SATISFIED' : failed ? 'BLOCKED' : availability ? 'UNAVAILABLE' : stale ? 'STALE' : unverified ? 'UNVERIFIED' :
    unavailable ? 'UNAVAILABLE' : 'MISSING';
  if (!accepted.length) {
    if (availability) reasons.push(availability.reason);
    if (missingObserver) reasons.push('VERIFIED_OBSERVER_UNAVAILABLE');
    else if (missingCheck) reasons.push('APPROVED_CHECK_UNAVAILABLE');
    if (!relevant.length) reasons.push('MISSING_RECEIPT');
    if (failed) reasons.push('EXECUTION_FAILED');
  }
  return { ...base, status, acceptedReceiptIds: sorted(accepted), rejectedReceiptIds: sorted(rejected), reasons: sorted(reasons) };
}

export function evaluateValidationPlan(plan, options) {
  const validation = validateValidationPlan(plan, options);
  const availability = options.availability ?? [];
  if (!Array.isArray(availability) || availability.length > 128 || new Set(availability.map((a) => a.validationRequirementId)).size !== availability.length ||
    availability.some((a) => !exact(a, 'validationRequirementId status reason') || !REQUIREMENT_ID.test(a.validationRequirementId) ||
      !plan.requirements?.some((r) => r.validationRequirementId === a.validationRequirementId) || a.status !== 'UNAVAILABLE' ||
      !['NO_DEVICE', 'NO_RUNTIME', 'NO_CREDENTIALS', 'NO_TOOLCHAIN', 'CHECK_NOT_INSTALLED'].includes(a.reason))) {
    validation.status = 'REPLAN_REQUIRED'; validation.reasons.push('INVALID_AVAILABILITY');
  }
  if (validation.status !== 'VALID') return { schemaVersion: 1, planId: plan?.planId ?? null,
    status: 'REPLAN_REQUIRED', reasons: validation.reasons, requirements: [], blockers: [], metrics: null };
  let ids;
  try { ids = options.receiptIds ?? listReceipts(options).map((receipt) => receipt.receiptId); }
  catch { return { schemaVersion: 1, planId: plan.planId, status: 'BLOCKED', reasons: ['EVIDENCE_STORE_UNAVAILABLE'], requirements: [], blockers: [], metrics: null }; }
  if (!Array.isArray(ids) || ids.length > 4096) return { schemaVersion: 1, planId: plan.planId, status: 'BLOCKED',
    reasons: ['INVALID_RECEIPT_REFERENCES'], requirements: [], blockers: [], metrics: null };
  const requirements = plan.requirements.map((r) => assessRequirement(r, ids, options, availability.find((a) => a.validationRequirementId === r.validationRequirementId)));
  const outstanding = requirements.filter((r) => r.required && !['SATISFIED', 'NOT_APPLICABLE'].includes(r.status));
  const blockers = outstanding.filter((r) => r.blocking).map((r) => r.validationRequirementId);
  const blocked = outstanding.some((r) => r.blocking && ['UNAVAILABLE', 'BLOCKED'].includes(r.status));
  return { schemaVersion: 1, planId: plan.planId, status: blocked ? 'BLOCKED' : outstanding.length ? 'INCOMPLETE' : 'COMPLETE',
    reasons: sorted(outstanding.flatMap((r) => r.reasons)), requirements, blockers,
    metrics: { requirementsGenerated: requirements.length, levelsRequired: sorted(plan.requirements.filter((r) => r.required &&
      r.applicability.status === 'APPLICABLE').map((r) => r.level)), receiptsReused: sorted(requirements.flatMap((r) => r.acceptedReceiptIds)).length,
    missing: requirements.filter((r) => r.status === 'MISSING').length, stale: requirements.filter((r) => r.status === 'STALE').length,
    unavailable: requirements.filter((r) => r.status === 'UNAVAILABLE').length, notApplicable: requirements.filter((r) => r.status === 'NOT_APPLICABLE').length } };
}
