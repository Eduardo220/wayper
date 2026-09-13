import fs from 'node:fs';
import path from 'node:path';
import { readWorkingContext, writeWorkingContext, proveWorkingContext, workingValidationStatus, refreshWorkingContext } from './wayper-context.mjs';
import { captureRepositories } from './wayper-context-identity.mjs';
import { assessGoalCompletion } from './wayper-completion-boundary.mjs';
import { completionMapFingerprint } from './wayper-completion-policy.mjs';
import { persistCompletionAssessment } from './wayper-completion-store.mjs';
import { readValidationPlan } from './wayper-validation-store.mjs';
import { listReceipts } from './wayper-evidence-store.mjs';
import { runObservedCommand, runObservedTest, runObservedQualityGate, observeFile } from './wayper-evidence-observer.mjs';
import { recordContextEntry, finalizeContextMap } from './wayper-context-map.mjs';
import { loadCapabilityFiles } from './quality/check-capability-routing.mjs';
import { digest, sorted } from './wayper-validation-policy.mjs';
import { classifyFeedbackFailures, feedbackIndex } from './wayper-feedback-policy.mjs';
import { readFeedbackSession } from './wayper-feedback-store.mjs';
import { refreshContextArtifacts, validateArtifactRefs } from './wayper-context-artifacts.mjs';

export function feedbackState({ root, identity }) {
  const state = readWorkingContext(root, { 'thread-id': identity.threadId, 'goal-run-id': identity.goalRunId, revision: identity.revision });
  const repositories = Object.values(state.contextMap.repositoryState).map((r) => ({ id: r.repository,
    logicalRoot: r.logicalRoot, root: path.resolve(root, r.logicalRoot) }));
  const options = { root, identity, execution: state.execution, repositories };
  let plan = null;
  try { if (state.contextMap.validationPlan) plan = readValidationPlan(state.contextMap.validationPlan.planId, options); } catch { /* Replan is explicit. */ }
  const receipts = listReceipts(options);
  const snapshots = captureRepositories(repositories);
  const ownerFingerprint = digest({ execution: state.execution, requirements: state.requirements, artifacts: state.artifacts,
    definition: state.definitionFingerprint ?? null, context: completionMapFingerprint(state.contextMap) });
  const fingerprint = digest({ repositories: snapshots, receipts, ownerFingerprint });
  return { ...options, state, plan, receipts, snapshots, ownerFingerprint, fingerprint };
}
export function feedbackFacts(options) {
  const current = feedbackState(options);
  const assessment = assessGoalCompletion(options);
  const validation = workingValidationStatus(current.state, current);
  const failures = classifyFeedbackFailures(assessment, current);
  return { ...current, assessment, validation, failures };
}
export function feedbackActionScope(current, action) {
  const repository = current.repositories.find((r) => r.id === action.repository);
  if (action.repository === null) return { repository: null, paths: action.paths.map((file) => ({ path: file, fingerprint: null })) };
  if (!repository) throw new Error('FEEDBACK_REPOSITORY_SCOPE');
  return { repository: action.repository, paths: action.paths.map((file) => {
    const target = path.resolve(repository.root, file);
    if (!target.startsWith(`${repository.root}${path.sep}`)) throw new Error('FEEDBACK_EDIT_SCOPE');
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) return { path: file, fingerprint: null };
    return { path: file, fingerprint: digest(fs.readFileSync(target)) };
  }) };
}
export function publishFeedbackContext(session, options) {
  const { state, repositories } = feedbackState(options);
  state.contextMap = recordContextEntry(state.contextMap, 'feedback', feedbackIndex(session), repositories, { root: options.root });
  writeWorkingContext(state, options);
}
export function storeFeedbackAssessment(facts) { persistCompletionAssessment(facts.assessment, facts); }
export const validationSummary = (facts) => ({ planId: facts.validation.planId ?? null, status: facts.validation.status,
  fingerprint: digest(facts.validation) });

export function feedbackDiagnosisContext(session, facts, failure) {
  const failedHypotheses = session.attempts.filter((a) => a.failureId === failure.failureId && !a.progress.materialProgress).slice(-2)
    .map(({ hypothesis, actionFingerprint, outcome }) => ({ hypothesis, actionFingerprint, outcome }));
  const evidenceRefs = sorted([...failure.relatedReceiptIds, ...facts.state.contextMap.evidence.filter((e) =>
    e.repository === failure.repository).map((e) => e.id)]).slice(0, 16);
  return { feedbackId: session.feedbackId, goalReference: session.goalReference, failure,
    selectionReason: failure.dependencyIds.length ? 'DEPENDENCIES_FIRST' : `PRIORITY_${failure.priority}_DEPENDENCIES_SATISFIED`,
    failedHypotheses, evidenceRefs, ...feedbackDiscoveryContext(session, facts, failure), validation: validationSummary(facts), completion: {
      assessmentId: facts.assessment.assessmentId, decision: facts.assessment.decision },
    scope: facts.plan?.inputs.repositories.filter((r) => r.repository === failure.repository).map((r) => ({ repository: r.repository,
      changedPaths: r.changedPaths.slice(0, 24) })) ?? [] };
}

export function feedbackDiscoveryContext(session, facts, failure) {
  const index = facts.state.contextMap.context;
  if (!index) return {};
  refreshContextArtifacts(index, facts);
  const lineage = session.attempts.flatMap((a) => a.lineage ?? []).filter((l) => l.failureId === failure.failureId);
  const sameRoot = new Set([failure.failureId, ...lineage.filter((l) => l.relation === 'SAME_ROOT').map((l) => l.relatedFailureId)]);
  const paths = new Set(facts.state.contextMap.findings?.filter((f) => failure.relatedFindingIds.includes(f.id)).flatMap((f) => f.paths) ?? []);
  // Only demonstrated SAME_ROOT inherits previous scope. INDEPENDENT/UNKNOWN need their own scope.
  for (const a of session.attempts.filter((a) => sameRoot.has(a.failureId))) for (const p of a.action?.paths ?? a.scopeBefore?.paths?.map((p) => p.path) ?? []) paths.add(p);
  const candidates = index.artifacts.filter((r) => r.repository === failure.repository && r.paths.some((p) => paths.has(p))).slice(0, 16);
  const current = candidates.filter((r) => r.status === 'CURRENT' && validateArtifactRefs(facts.state.contextMap, [r.artifactId], facts));
  const stale = candidates.filter((r) => r.status === 'STALE');
  return { contextArtifactRefs: current.map((r) => r.artifactId), staleContextArtifactRefs: stale.map((r) => r.artifactId),
    contextSelection: lineage.some((l) => l.relation === 'INDEPENDENT') ? 'INDEPENDENT_SCOPE' : sameRoot.size > 1 ? 'SAME_ROOT_REVALIDATED' : 'CURRENT_FAILURE_SCOPE' };
}

export function recordFeedbackContextReuse(facts, count) {
  if (!facts.state.contextMap.context) return;
  facts.state.contextMap.context.metrics.feedbackContextReuses += count;
  facts.state.contextMap = finalizeContextMap(facts.state.contextMap);
  writeWorkingContext(facts.state, facts);
}

export function feedbackExecutor(session, initial, attempt, options) {
  let expected = initial.fingerprint;
  let checkpoint = session.fingerprint;
  let phase = session.state;
  const receiptIds = [...attempt.receiptIds]; const executionRefs = [...attempt.executionRefs]; const changedFiles = new Set(attempt.changedFiles);
  const registry = loadCapabilityFiles().registry;
  const facts = () => feedbackState(options);
  const guard = () => {
    if (options.signal?.aborted) throw new Error('CANCELLED');
    if (readFeedbackSession(session.feedbackId, options).fingerprint !== checkpoint) throw new Error('FEEDBACK_BUSY');
    const current = facts();
    if (current.fingerprint !== expected) throw new Error('CONCURRENT_CHANGE');
    return current;
  };
  const update = () => { const current = facts(); expected = current.fingerprint; return current; };
  const inScope = (repository) => initial.repositories.some((r) => r.id === repository) &&
    (attempt.repository === null || attempt.repository === repository);
  const observed = async (producer, input) => {
    const before = guard();
    if (!inScope(input.repository)) throw new Error('FEEDBACK_REPOSITORY_SCOPE');
    const result = await producer({ ...input, ...before, repository: input.repository,
      metadata: { taskId: session.feedbackId, attemptId: attempt.attemptId, failureId: attempt.failureId } });
    const values = result.receipt ? [result.commandReceipt, result.receipt] : [result];
    for (const receipt of values) {
      receiptIds.push(receipt.receiptId);
      if (receipt.kind === 'COMMAND') executionRefs.push(receipt.receiptId);
    }
    const after = facts();
    if (digest(before.snapshots) !== digest(after.snapshots) || before.ownerFingerprint !== after.ownerFingerprint ||
      after.receipts.some((r) => !before.receipts.some((b) => b.receiptId === r.receiptId) && !values.some((v) => v.receiptId === r.receiptId))) {
      throw new Error('CONCURRENT_CHANGE');
    }
    expected = after.fingerprint;
    if (readFeedbackSession(session.feedbackId, options).fingerprint !== checkpoint) throw new Error('FEEDBACK_BUSY');
    return result.receipt ?? result;
  };
  const mutate = (fn) => {
    const current = guard(); const next = fn(current);
    writeWorkingContext(next, options); return update();
  };
  const context = {
    identity: structuredClone(initial.identity), execution: structuredClone(initial.execution),
    failure: structuredClone(initial.failures.find((f) => f.failureId === attempt.failureId)),
    guard, observeCommand: (input) => observed(runObservedCommand, input), observeTest: (input) => observed(runObservedTest, input),
    observeQualityGate: (input) => observed(runObservedQualityGate, input), observeSource: (input) => observed(observeFile, input),
    async resolveContext(request) {
      guard();
      if (!inScope(request.repository)) throw new Error('FEEDBACK_REPOSITORY_SCOPE');
      const { resolveContext } = await import('./wayper-context-economy.mjs');
      const result = await resolveContext({ root: options.root, identity: initial.identity, request,
        graphOptions: options.graphOptions });
      if (result.disposition === 'ACQUIRED') mutate((current) => {
        current.state.contextMap.context.metrics.feedbackContextReacquisitions++;
        current.state.contextMap = finalizeContextMap(current.state.contextMap); return current.state;
      });
      update(); return result;
    },
    edit({ repository, file, content }) {
      guard();
      if (phase !== 'ACTING' || attempt.action.kind !== 'EDIT' || !inScope(repository) || !attempt.action.paths.includes(file) ||
        ['.git', '.wayper-context'].includes(file.split('/')[0]) || typeof content !== 'string') throw new Error('FEEDBACK_EDIT_SCOPE');
      if (!initial.plan?.inputs.repositories.some((r) => r.repository === repository && r.changedPaths.includes(file))) throw new Error('PLAN_INPUT_REVIEW_REQUIRED');
      const repositoryRoot = initial.repositories.find((r) => r.id === repository).root;
      let target = repositoryRoot;
      for (const part of file.split('/')) {
        target = path.join(target, part);
        if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('FEEDBACK_EDIT_SYMLINK');
      }
      const temporary = `${target}.${attempt.attemptId}.tmp`;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { fs.writeFileSync(temporary, content, { flag: 'wx', mode: fs.statSync(target, { throwIfNoEntry: false })?.mode ?? 0o644 }); fs.renameSync(temporary, target); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      changedFiles.add(`${repository}:${file}`); update();
    },
    record(kind, data) {
      if (!['finding', 'proof-gap', 'validation', 'receipt'].includes(kind) || data.repository && !inScope(data.repository)) throw new Error('FEEDBACK_RECORD_SCOPE');
      mutate((current) => ({ ...current.state, contextMap: recordContextEntry(current.state.contextMap, kind, data,
        current.repositories, { ...current, registry }) }));
    },
    prove(requirement, receiptId) {
      const receipt = facts().receipts.find((r) => r.receiptId === receiptId);
      if (!receipt || !inScope(receipt.repositoryReference.repositoryId)) throw new Error('FEEDBACK_PROOF_SCOPE');
      mutate((current) => proveWorkingContext(current.state, { requirement, evidence: receiptId }, current));
    },
    replan(inputs = options.planInputs) {
      mutate((current) => {
        const planInputs = inputs ?? current.plan?.inputs;
        if (!planInputs) throw new Error('PLAN_INPUT_REVIEW_REQUIRED');
        return { ...current.state, contextMap: recordContextEntry(current.state.contextMap, 'validation-plan',
          { inputs: planInputs, availability: current.state.contextMap.validationPlan?.availability ?? [] }, current.repositories, { ...current, registry }) };
      });
    },
    async validate() {
      guard(); let current = feedbackFacts(options);
      if (current.validation.status === 'REPLAN_REQUIRED') { context.replan(); guard(); current = feedbackFacts(options); }
      if (!current.plan) throw new Error('PLAN_INPUT_REVIEW_REQUIRED');
      const needed = current.validation.requirements.filter((r) => r.required && r.blocking && !['SATISFIED', 'NOT_APPLICABLE'].includes(r.status));
      const ordered = current.plan.requirements.filter((r) => needed.some((n) => n.validationRequirementId === r.validationRequirementId) && inScope(r.repository))
        .sort((a, b) => a.level.localeCompare(b.level) || a.validationRequirementId.localeCompare(b.validationRequirementId));
      for (const r of ordered) {
        const check = r.candidateChecks.find((c) => c.available && c.command);
        if (!check) continue; // Completion preserves unavailable as blocking; do not invent runtime proof.
        await context.observeQualityGate({ repository: r.repository, target: r.evidencePolicy.receiptRequirement.target,
          command: check.command, args: check.args, cwd: r.evidencePolicy.cwd });
      }
      mutate((c) => {
        let refreshed = refreshWorkingContext({ ...c, existing: c.state, taskClass: c.state.taskClass, registry });
        // Refresh invalidates owner assertions on a changed snapshot. Reuse only proofs
        // accepted again by the existing receipt validator against the new state.
        for (const requirement of c.state.requirements) for (const evidence of requirement.evidence ?? []) {
          try { refreshed = proveWorkingContext(refreshed, { requirement: `${requirement.kind}:${requirement.id}`, evidence }, c); }
          catch { /* Stale/unverified proof remains incomplete. */ }
        }
        return refreshed;
      });
    },
  };
  return { context, guard, facts, setCheckpoint(s) { checkpoint = s.fingerprint; phase = s.state; },
    result: () => ({ receiptIds: sorted(receiptIds), executionRefs: sorted(executionRefs), changedFiles: sorted([...changedFiles]),
      scopeAfter: feedbackActionScope(facts(), attempt.action) }) };
}
