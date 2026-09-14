import fs from 'node:fs';
import path from 'node:path';
import { assertIdentity, captureRepositories, contextStatePath, stable } from './wayper-context-identity.mjs';
import { readWorkingContext, workingValidationStatus } from './wayper-context.mjs';
import { refreshContextMap, validateContextMap } from './wayper-context-map.mjs';
import { loadCapabilityFiles } from './quality/check-capability-routing.mjs';
import { RECEIPT_ID, requirementPolicy } from './wayper-evidence-receipts.mjs';
import { evaluateEvidenceRequirement } from './wayper-evidence-store.mjs';
import { digest, sorted } from './wayper-validation-policy.mjs';
import { ownershipSnapshot } from './wayper-ownership.mjs';
import { readCurrentCrossRepoAssessment, validateCurrentCrossRepoState } from './wayper-cross-repo.mjs';
import { completionDefinition, completionMapFingerprint, completionIssue, sealCompletionAssessment, completionRequirementPolicy,
  validateCompletionLedger, validateCompletionRequirements, validateCompletionAssessmentSchema } from './wayper-completion-policy.mjs';

// The selector is the only authority input. Caller state/receipts/booleans cannot replace persisted owners.
export function assessGoalCompletion(request = {}) {
  const { root, identity } = request ?? {};
  const blockers = []; const warnings = []; const acceptedUnknowns = [];
  const requirementState = []; const findingState = []; const proofGapState = [];
  const accepted = []; const rejected = [];
  let state; let snapshots = []; let inputFingerprint = digest(null);
  let crossRepoState = null;
  let validationState = { planId: null, status: 'LEGACY_UNPLANNED' };
  let decision = 'NOT_ADMISSIBLE'; let invalid = false; let replan = false; let stale = false; let external = false;
  const add = (kind, id, reason, options = {}) => {
    const issue = completionIssue(kind, id, reason, options);
    (issue.blocking ? blockers : warnings).push(issue);
    return issue;
  };
  const evidence = (policy, ids) => {
    const result = evaluateEvidenceRequirement(policy, sorted(ids ?? []), options);
    accepted.push(...result.acceptedReceiptIds);
    rejected.push(...result.receipts.filter((r) => !result.acceptedReceiptIds.includes(r.receiptId)).map((r) => r.receiptId));
    return result;
  };
  const rejectedProof = (proof, relation) => {
    for (const receipt of proof?.receipts ?? []) {
      if (!RECEIPT_ID.test(receipt.receiptId) || proof.acceptedReceiptIds.includes(receipt.receiptId)) continue;
      for (const reason of receipt.reasons) add('EVIDENCE', receipt.receiptId, reason, {
        ...relation, relatedReceiptIds: [receipt.receiptId] });
    }
  };
  let options;
  try {
    assertIdentity(identity);
    state = readWorkingContext(root, { 'thread-id': identity.threadId, 'goal-run-id': identity.goalRunId, revision: identity.revision });
    const before = fs.readFileSync(contextStatePath(root, identity.goalRunId), 'utf8');
    if (!state.contextMap) throw new Error('CONTEXT_MAP_MISSING');
    if (!validateCompletionRequirements(state.requirements)) throw new Error('INVALID_REQUIREMENTS');
    if (state.definitionFingerprint && state.definitionFingerprint !== completionDefinition(state)) throw new Error('UNAMENDED_DEFINITION_CHANGE');
    const repositories = Object.values(state.contextMap.repositoryState).map((r) => ({ id: r.repository,
      logicalRoot: r.logicalRoot, root: path.resolve(root, r.logicalRoot) }));
    snapshots = captureRepositories(repositories);
    for (const repository of snapshots) {
      const baseline = state.execution.baseline.repositories.find((r) => r.repositoryId === repository.repositoryId);
      if (!baseline || baseline.checkoutFingerprint !== repository.checkoutFingerprint) throw new Error('WRONG_REPOSITORY');
    }
    const { registry } = loadCapabilityFiles();
    options = { root, execution: state.execution, repositories };
    const ownershipState = ownershipSnapshot({ root, identity }); const ownership = ownershipState.problems;
    for (const problem of ownership) add('STATE', problem.reference, problem.reasonCode, { repository: problem.repository });
    const map = refreshContextMap(state.contextMap, { ...options, registry, goalId: state.goalId,
      taskClass: state.taskClass, tokenCeiling: state.budget.contextTokenCeiling,
      risks: state.riskFlags, invariants: state.invariants, validations: state.validations, workingArtifacts: state.artifacts });
    const structure = validateContextMap(map, { repositoryDefinitions: repositories, registry });
    if (structure.status !== 'VALID' || validateCompletionLedger(map).length) throw new Error('INVALID_CONTEXT_MAP');
    const v = workingValidationStatus({ ...state, contextMap: map }, options);
    validationState = { planId: v.planId ?? null, status: v.status };
    if (v.status === 'LEGACY_UNPLANNED') add('VALIDATION', 'plan', 'VALIDATION_PLAN_MISSING');
    if (v.status === 'REPLAN_REQUIRED') { replan = true; add('VALIDATION', v.planId, 'REPLAN_REQUIRED'); }
    const related = new Map((v.requirements ?? []).map((r) => [r.validationRequirementId, r]));
    for (const r of v.requirements ?? []) {
      accepted.push(...r.acceptedReceiptIds); rejected.push(...r.rejectedReceiptIds);
      if (['SATISFIED', 'NOT_APPLICABLE'].includes(r.status)) continue;
      const blocking = r.required && r.blocking;
      const issue = add('VALIDATION', r.validationRequirementId, r.status, { repository: r.repository, blocking,
        relatedRequirementIds: [r.validationRequirementId], relatedReceiptIds: r.rejectedReceiptIds });
      if (blocking && r.status === 'STALE') stale = true;
      if (blocking && r.status === 'UNAVAILABLE') external = true;
      if (!blocking) acceptedUnknowns.push(issue);
    }
    if (v.status === 'BLOCKED' && !(v.requirements ?? []).length) add('VALIDATION', v.planId, v.reasons[0] ?? 'VALIDATION_BLOCKED');
    if (!state.requirements.length) add('REQUIREMENT', 'criteria', 'SUCCESS_CRITERIA_MISSING');
    const requirements = state.requirements.map((r) => ({ ...r, evidence: sorted(r.evidence),
      ...(r.invalidatedEvidence ? { invalidatedEvidence: sorted(r.invalidatedEvidence) } : {}) }))
      .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
    for (const r of requirements) {
      const id = `${r.kind}:${r.id}`;
      const policy = completionRequirementPolicy(r);
      const scope = r.status === 'NOT_APPLICABLE';
      const proof = evidence(scope ? { kinds: ['HUMAN_DECISION'], repository: policy.repository, target: `${id}:scope`, result: 'PASS' } : policy, r.evidence);
      const isStale = proof.receipts.some((receipt) => receipt.status === 'STALE');
      const status = proof.status === 'SATISFIED' && ['SATISFIED', 'NOT_APPLICABLE'].includes(r.status) && (!scope || r.reason) ? r.status :
        isStale ? 'STALE' : r.status === 'BLOCKED' ? 'BLOCKED' : proof.receipts.some((receipt) => receipt.status === 'UNVERIFIED') ? 'UNVERIFIED' : 'UNSATISFIED';
      const blocking = r.blocking !== false;
      requirementState.push({ sourceId: id, repository: policy.repository, status, blocking, acceptedReceiptIds: proof.acceptedReceiptIds });
      if (['SATISFIED', 'NOT_APPLICABLE'].includes(status)) continue;
      const issue = add('REQUIREMENT', id, status, { repository: policy.repository, blocking,
        relatedRequirementIds: [id], relatedReceiptIds: proof.receipts.map((p) => p.receiptId) });
      rejectedProof(proof, { repository: policy.repository, blocking, relatedRequirementIds: [id] });
      if (blocking && isStale) stale = true;
      if (!blocking) acceptedUnknowns.push(issue);
    }
    // Explicit assurances remain obligations, but unrelated legacy checks do not become bureaucracy.
    const declared = sorted([...(state.validations ?? []), ...(state.riskFlags ?? []).map((r) => `risk:${r}`),
      ...(state.invariants ?? []).map((r) => `invariant:${r}`)]);
    for (const id of declared) {
      const check = map.validation.checks.find((r) => r.id === id);
      const proof = evidence(requirementPolicy({ kind: 'QUALITY_GATE', id }), check?.evidence ? [check.evidence] : []);
      if (check?.status !== 'PASS' || proof.status !== 'SATISFIED') {
        add('REQUIREMENT', id, 'DECLARED_ASSURANCE_UNPROVEN', { relatedRequirementIds: [id], relatedReceiptIds: check?.evidence ? [check.evidence] : [] });
        stale ||= proof.receipts.some((r) => r.status === 'STALE');
      }
    }
    for (const f of map.findings ?? []) {
      const blocking = ['CRITICAL', 'HIGH'].includes(f.severity) || f.materiality === 'BLOCKING';
      let closed = false; let reason = 'OPEN'; let receiptIds = [];
      if (f.status !== 'OPEN') {
        const resolution = f.resolution;
        const owner = resolution?.reviewer === 'OWNER' && stable(resolution.goalReference) === stable(identity) &&
          resolution.baselineFingerprint === state.execution.baseline.fingerprint;
        const human = resolution?.humanDecisionRequired || f.status === 'ACCEPTED_RISK' && f.severity === 'CRITICAL';
        const proof = evidence({ kinds: human ? ['HUMAN_DECISION'] : ['TEST', 'QUALITY_GATE'], repository: f.repository,
          target: `finding:${f.id}:${f.status}`, result: 'PASS' }, f.receiptIds);
        closed = owner && proof.status === 'SATISFIED'; receiptIds = proof.acceptedReceiptIds;
        reason = human ? 'HUMAN_DECISION_REQUIRED' : owner ? 'RESOLUTION_UNPROVEN' : 'OWNER_REVIEW_REQUIRED';
        if (blocking && !closed && proof.receipts.some((r) => r.status === 'STALE')) stale = true;
        if (!closed) rejectedProof(proof, { repository: f.repository, blocking,
          relatedRequirementIds: f.relatedRequirementIds, relatedFindingIds: [f.id] });
      }
      findingState.push({ sourceId: f.id, repository: f.repository, status: closed ? f.status : 'OPEN', blocking, acceptedReceiptIds: receiptIds });
      if (!closed) add('FINDING', f.id, reason, { blocking, repository: f.repository,
        relatedRequirementIds: f.relatedRequirementIds, relatedFindingIds: [f.id], relatedReceiptIds: f.receiptIds });
      else if (f.status === 'ACCEPTED_RISK') warnings.push(completionIssue('FINDING', f.id, 'ACCEPTED_RISK', {
        blocking: false, repository: f.repository, relatedFindingIds: [f.id], relatedReceiptIds: receiptIds }));
    }
    for (const g of map.proofGaps) {
      const linked = (g.relatedRequirementIds ?? []).map((id) => related.get(id)).filter(Boolean);
      const blocking = g.materiality === 'BLOCKING' || linked.some((r) => r.required && r.blocking && r.status !== 'NOT_APPLICABLE');
      const proof = g.receiptRequirement ? evidence(g.receiptRequirement, g.receiptIds) : null;
      const resolved = g.status === 'RESOLVED' && proof?.status === 'SATISFIED';
      proofGapState.push({ sourceId: g.id, repository: g.repository ?? null, status: resolved ? 'RESOLVED' : 'OPEN', blocking,
        acceptedReceiptIds: proof?.acceptedReceiptIds ?? [] });
      if (!resolved) add('PROOF_GAP', g.id, g.materiality ? 'OPEN' : 'LEGACY_UNCLASSIFIED_GAP', { blocking, repository: g.repository,
        relatedRequirementIds: g.relatedRequirementIds, relatedReceiptIds: g.receiptIds });
      if (!resolved) {
        rejectedProof(proof, { repository: g.repository, blocking, relatedRequirementIds: g.relatedRequirementIds });
        if (blocking && proof?.receipts.some((r) => r.status === 'STALE')) stale = true;
      }
    }
    for (const a of map.ambiguities) {
      if (!a.materiality) continue;
      const proof = evidence({ kinds: ['HUMAN_DECISION'], repository: a.repository, target: `ambiguity:${a.code}`, result: 'PASS' }, a.receiptIds);
      if (a.status === 'RESOLVED' && proof.status === 'SATISFIED') continue;
      add('AMBIGUITY', a.code, a.status === 'RESOLVED' ? 'HUMAN_DECISION_REQUIRED' : 'OPEN', {
        blocking: a.materiality === 'MATERIAL', repository: a.repository, relatedRequirementIds: a.relatedRequirementIds,
        relatedReceiptIds: a.receiptIds });
    }
    crossRepoState = readCurrentCrossRepoAssessment({ root, identity });
    const crossFreshness = crossRepoState && validateCurrentCrossRepoState(crossRepoState, repositories);
    if (crossRepoState && (crossFreshness.status !== 'CURRENT' || crossRepoState.assessment.decision !== 'COMPLETE')) {
      const cross = crossRepoState.assessment;
      const issues = crossFreshness.status !== 'CURRENT' ? crossFreshness.affectedTaskIds.map((taskId) => ({
        taskId, repository: cross.plan.tasks.find((task) => task.taskId === taskId)?.repository ?? null, reasonCode: crossFreshness.status,
      })) : cross.blockers.length ? cross.blockers : [{ taskId: cross.planId, repository: null, reasonCode: cross.decision }];
      for (const issue of issues) add('CROSS_REPO', issue.taskId, issue.reasonCode, { repository: issue.repository });
      invalid ||= cross.decision === 'INVALID_STATE' || crossFreshness.status === 'INVALID_STATE';
      replan ||= cross.decision === 'REPLAN_REQUIRED' || crossFreshness.status === 'REPLAN_REQUIRED';
      external ||= cross.decision === 'BLOCKED' || crossFreshness.status === 'BLOCKED';
    }
    inputFingerprint = digest({ execution: state.execution, definition: completionDefinition(state),
      requirements, revisionHistory: state.revisionHistory, repositories: snapshots,
      context: completionMapFingerprint(map), validation: v, ...(ownership.length ? { ownership } : {}),
      ...(crossRepoState ? { crossRepo: crossRepoState.assessment } : {}) });
    if (before !== fs.readFileSync(contextStatePath(root, identity.goalRunId), 'utf8') || stable(snapshots) !== stable(captureRepositories(repositories)) ||
      ownershipState.fingerprint !== ownershipSnapshot({ root, identity }).fingerprint) {
      throw new Error('STATE_CHANGED_DURING_ASSESSMENT');
    }
  } catch (error) {
    invalid = true;
    add('STATE', 'goal', /^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_GOAL_OR_CONTEXT');
  }
  decision = invalid ? 'INVALID_STATE' : replan ? 'REPLAN_REQUIRED' : stale ? 'REVALIDATION_REQUIRED' :
    external ? 'BLOCKED_EXTERNAL' : blockers.length ? 'NOT_ADMISSIBLE' : 'ADMISSIBLE';
  const order = (items) => [...new Map(items.map((i) => [i.blockerId, i])).values()].sort((a, b) => a.blockerId.localeCompare(b.blockerId));
  const safeIdentity = (() => { try { assertIdentity(identity); return identity; } catch { return null; } })();
  return sealCompletionAssessment({ schemaVersion: 1, goalReference: safeIdentity,
    baselineReference: state ? { fingerprint: state.execution.baseline.fingerprint } : null, inputFingerprint,
    goalState: { status: invalid ? 'INVALID' : 'CURRENT', contextStatus: state?.contextDecision ?? 'LEGACY_UNASSESSED' },
    requirementState, validationState, evidenceState: { acceptedReceiptIds: sorted(accepted), rejectedReceiptIds: sorted(rejected).filter((id) => RECEIPT_ID.test(id)) },
    findingState, proofGapState, amendmentState: { revision: safeIdentity?.revision ?? null, incorporated: !invalid && !replan },
    blockers: order(blockers), warnings: order(warnings), acceptedUnknowns: order(acceptedUnknowns), decision,
    reasons: sorted(blockers.map((b) => b.reasonCode)) });
}

export function validateCompletionAssessment(assessment, options) {
  if (!validateCompletionAssessmentSchema(assessment)) return { status: 'INVALID', reasons: ['INVALID_ASSESSMENT_SCHEMA_OR_FINGERPRINT'] };
  const current = assessGoalCompletion(options);
  if (stable(assessment.goalReference) !== stable(current.goalReference) || stable(assessment.baselineReference) !== stable(current.baselineReference)) {
    return { status: 'STALE', reasons: ['WRONG_GOAL_REVISION_OR_BASELINE'] };
  }
  return stable(assessment) === stable(current) ? { status: 'CURRENT', reasons: [] } : { status: 'STALE', reasons: ['COMPLETION_INPUT_CHANGED'] };
}

export function assertGoalCompletionAdmissible(options) {
  const assessment = assessGoalCompletion(options);
  if (assessment.decision !== 'ADMISSIBLE') {
    const error = new Error(`COMPLETION_${assessment.decision}`); error.assessment = assessment; throw error;
  }
  return assessment;
}
