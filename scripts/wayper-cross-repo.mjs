import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertGoalExecution, assertIdentity, stable } from './wayper-context-identity.mjs';
import { safeEvidencePath, RECEIPT_ID } from './wayper-evidence-receipts.mjs';
import { contextStoreFile, writeContextArtifact } from './wayper-completion-store.mjs';
import { digest, exact, bounded, sorted } from './wayper-validation-policy.mjs';

export const CROSS_REPO_SCHEMA_VERSION = 1;
export const DEPENDENCY_TYPES = Object.freeze(['REQUIRES', 'BLOCKS', 'PRODUCES_FOR', 'VALIDATES_WITH']);
export const CROSS_REPO_DECISIONS = Object.freeze(['COMPLETE', 'INCOMPLETE', 'BLOCKED', 'REPLAN_REQUIRED', 'INVALID_STATE']);
const TASK_STATUSES = ['PENDING', 'COMPLETE', 'FAILED', 'BLOCKED', 'UNAVAILABLE'];
const COMPLETION_DECISIONS = ['ADMISSIBLE', 'NOT_ADMISSIBLE', 'REPLAN_REQUIRED', 'REVALIDATION_REQUIRED', 'BLOCKED_EXTERNAL', 'INVALID_STATE'];
const VALIDATION_STATUSES = ['COMPLETE', 'INCOMPLETE', 'BLOCKED', 'REPLAN_REQUIRED', 'STALE'];
const PLAN_KEYS = 'schemaVersion planId goalReference baselineReference repositories tasks dependencyEdges completionPolicy fingerprint';
const ASSESSMENT_KEYS = 'schemaVersion assessmentId goalReference planId baselineReference repositoryStates taskStates dependencyStates blockers warnings decision metrics fingerprint';

const seal = (value, idKey, prefix) => {
  const { fingerprint: _fingerprint, [idKey]: _id, ...body } = value;
  const fingerprint = digest(body);
  return { ...body, [idKey]: `${prefix}-${fingerprint.slice(7)}`, fingerprint };
};
const repo = (repositories, id) => repositories.find((item) => item.id === id);
const scopeContains = (scope, file) => scope.kind === 'REPOSITORY' || scope.path === file ||
  scope.kind === 'PATH_PREFIX' && file.startsWith(`${scope.path}/`);

function validScope(scope) {
  return exact(scope, 'kind path') && ['REPOSITORY', 'PATH_PREFIX', 'FILE'].includes(scope.kind) &&
    (scope.kind === 'REPOSITORY' ? scope.path === '.' : safeEvidencePath(scope.path));
}

function repositoryFiles(repository) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repository.root, encoding: 'utf8', maxBuffer: 16_777_216,
  }).split('\0').filter((file) => file && !file.startsWith('.wayper-context/')).sort();
}

function dirtyPaths(repository) {
  return execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repository.root, encoding: 'utf8', maxBuffer: 16_777_216,
  }).split('\0').filter(Boolean).map((entry) => entry.length > 3 && entry[2] === ' ' ? entry.slice(3) : entry)
    .filter(safeEvidencePath).sort();
}

function fileHash(repository, file) {
  const target = path.join(repository.root, file);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isSymbolicLink()) return digest(['SYMLINK', fs.readlinkSync(target)]);
  return stat.isFile() ? digest([stat.mode, fs.readFileSync(target)]) : 'NON_FILE';
}

export function taskScopeFingerprint(repository, scopes) {
  const files = repositoryFiles(repository).filter((file) => scopes.some((scope) => scopeContains(scope, file)));
  for (const scope of scopes.filter((item) => item.kind !== 'REPOSITORY')) if (!files.includes(scope.path)) files.push(scope.path);
  return digest(files.sort().map((file) => [file, fileHash(repository, file)]));
}

function baselineReference(execution, repositoryIds, repositories) {
  return { fingerprint: execution.baseline.fingerprint, repositories: execution.baseline.repositories.filter((item) => repositoryIds.includes(item.repositoryId)).map((item) => ({
    repository: item.repositoryId, checkoutFingerprint: item.checkoutFingerprint, branch: item.branch,
    head: item.head, dirty: item.dirty, dirtyPaths: dirtyPaths(repo(repositories, item.repositoryId)), contentFingerprint: item.contentFingerprint,
  })).sort((a, b) => a.repository.localeCompare(b.repository)) };
}

function normalizeTask(task, execution, repositories) {
  if (!exact(task, 'taskId repository operation scopes capabilities risks dependencies blocking') ||
    !/^[\w.-]{1,120}$/.test(task.taskId) || !repo(repositories, task.repository) ||
    !['READ', 'MUTATE'].includes(task.operation) || !Array.isArray(task.scopes) || !task.scopes.length ||
    task.scopes.length > 32 || !task.scopes.every(validScope) ||
    ![task.capabilities, task.risks, task.dependencies].every((items) => Array.isArray(items) && items.length <= 64 &&
      new Set(items).size === items.length && items.every((item) => bounded(item, 120))) || typeof task.blocking !== 'boolean') {
    throw new Error('INVALID_CROSS_REPO_TASK');
  }
  const normalized = { taskId: task.taskId, goalRunId: execution.identity.goalRunId, revision: execution.identity.revision,
    repository: task.repository, operation: task.operation, scopes: [...task.scopes].sort((a, b) => stable(a).localeCompare(stable(b))),
    capabilities: sorted(task.capabilities), risks: sorted(task.risks), dependencies: sorted(task.dependencies),
    blocking: task.blocking, scopeFingerprint: taskScopeFingerprint(repo(repositories, task.repository), task.scopes) };
  return { ...normalized, fingerprint: digest(normalized) };
}

function normalizeEdge(edge, tasks, repositories) {
  if (!exact(edge, 'type fromTaskId toTaskId sourcePaths') || !DEPENDENCY_TYPES.includes(edge.type) ||
    edge.fromTaskId === edge.toTaskId || !Array.isArray(edge.sourcePaths) || !edge.sourcePaths.length ||
    edge.sourcePaths.length > 32 || !edge.sourcePaths.every(safeEvidencePath)) throw new Error('INVALID_DEPENDENCY_EDGE');
  const from = tasks.find((task) => task.taskId === edge.fromTaskId);
  const to = tasks.find((task) => task.taskId === edge.toTaskId);
  if (!from || !to) throw new Error('UNKNOWN_DEPENDENCY_TASK');
  const sourcePaths = sorted(edge.sourcePaths);
  const sourceFingerprint = digest(sourcePaths.map((file) => [file, fileHash(repo(repositories, from.repository), file)]));
  const body = { type: edge.type, fromTaskId: from.taskId, toTaskId: to.taskId, sourceRepository: from.repository,
    targetRepository: to.repository, sourcePaths, sourceFingerprint };
  return { edgeId: `XD-${digest(body).slice(7)}`, ...body };
}

export function buildCrossRepoPlan({ execution, repositories, tasks, dependencyEdges = [] }) {
  assertGoalExecution(execution);
  if (!Array.isArray(repositories) || !repositories.length || repositories.length > 8 ||
    new Set(repositories.map((item) => item.id)).size !== repositories.length) throw new Error('INVALID_REPOSITORIES');
  const normalizedTasks = tasks.map((task) => normalizeTask(task, execution, repositories))
    .sort((a, b) => a.taskId.localeCompare(b.taskId));
  if (!normalizedTasks.length || normalizedTasks.length > 64 || new Set(normalizedTasks.map((task) => task.taskId)).size !== normalizedTasks.length) {
    throw new Error('INVALID_CROSS_REPO_TASKS');
  }
  const edges = dependencyEdges.map((edge) => normalizeEdge(edge, normalizedTasks, repositories))
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  if (new Set(edges.map((edge) => edge.edgeId)).size !== edges.length) throw new Error('DUPLICATE_DEPENDENCY_EDGE');
  for (const task of normalizedTasks) {
    const declared = sorted(edges.filter((edge) => edge.toTaskId === task.taskId).map((edge) => edge.fromTaskId));
    if (stable(declared) !== stable(task.dependencies)) throw new Error('DEPENDENCY_DECLARATION_MISMATCH');
  }
  const repositoriesUsed = sorted(normalizedTasks.map((task) => task.repository));
  const value = { schemaVersion: CROSS_REPO_SCHEMA_VERSION, goalReference: execution.identity,
    baselineReference: baselineReference(execution, repositoriesUsed, repositories), repositories: repositoriesUsed, tasks: normalizedTasks,
    dependencyEdges: edges, completionPolicy: { mode: 'ALL_BLOCKING_TASKS_COMPLETE', noAutomaticRollback: true } };
  return seal(value, 'planId', 'XP');
}

export function validateCrossRepoPlan(plan) {
  try {
    if (!exact(plan, PLAN_KEYS) || plan.schemaVersion !== CROSS_REPO_SCHEMA_VERSION || stable(seal(plan, 'planId', 'XP')) !== stable(plan) ||
      !Array.isArray(plan.repositories) || !Array.isArray(plan.tasks) || !Array.isArray(plan.dependencyEdges) ||
      !exact(plan.completionPolicy, 'mode noAutomaticRollback') || plan.completionPolicy.mode !== 'ALL_BLOCKING_TASKS_COMPLETE' ||
      plan.completionPolicy.noAutomaticRollback !== true) throw new Error('INVALID_CROSS_REPO_PLAN');
    assertIdentity(plan.goalReference);
    if (!exact(plan.baselineReference, 'fingerprint repositories') || !/^sha256:[a-f0-9]{64}$/.test(plan.baselineReference.fingerprint) ||
      !Array.isArray(plan.baselineReference.repositories) || plan.baselineReference.repositories.some((item) =>
        !exact(item, 'repository checkoutFingerprint branch head dirty dirtyPaths contentFingerprint') || !plan.repositories.includes(item.repository) ||
        ![item.checkoutFingerprint, item.contentFingerprint].every((value) => /^sha256:[a-f0-9]{64}$/.test(value)) ||
        !/^[a-f0-9]{40,64}$/.test(item.head) || typeof item.dirty !== 'boolean' || !stringArray(item.dirtyPaths) ||
        item.dirtyPaths.some((file) => !safeEvidencePath(file))) ||
      stable(sorted(plan.baselineReference.repositories.map((item) => item.repository))) !== stable(plan.repositories)) {
      throw new Error('INVALID_BASELINE_REFERENCE');
    }
    if (stable(plan.repositories) !== stable(sorted(plan.repositories)) || new Set(plan.repositories).size !== plan.repositories.length ||
      stable(plan.repositories) !== stable(sorted(plan.tasks.map((task) => task.repository)))) throw new Error('INVALID_REPOSITORY_SET');
    if (plan.tasks.some((task) => !exact(task, 'taskId goalRunId revision repository operation scopes capabilities risks dependencies blocking scopeFingerprint fingerprint') ||
      !/^[\w.-]{1,120}$/.test(task.taskId) || task.goalRunId !== plan.goalReference.goalRunId || task.revision !== plan.goalReference.revision ||
      !plan.repositories.includes(task.repository) || !['READ', 'MUTATE'].includes(task.operation) || !task.scopes.length || !task.scopes.every(validScope) ||
      ![task.capabilities, task.risks, task.dependencies].every((items) => stringArray(items)) || typeof task.blocking !== 'boolean' ||
      !/^sha256:[a-f0-9]{64}$/.test(task.scopeFingerprint) || task.fingerprint !== digest(Object.fromEntries(Object.entries(task).filter(([key]) => key !== 'fingerprint'))))) {
      throw new Error('INVALID_TASK_BINDING');
    }
    if (new Set(plan.tasks.map((task) => task.taskId)).size !== plan.tasks.length || plan.dependencyEdges.some((edge) =>
      !exact(edge, 'edgeId type fromTaskId toTaskId sourceRepository targetRepository sourcePaths sourceFingerprint') ||
      !DEPENDENCY_TYPES.includes(edge.type) || !/^XD-[a-f0-9]{64}$/.test(edge.edgeId) || !/^sha256:[a-f0-9]{64}$/.test(edge.sourceFingerprint) ||
      !stringArray(edge.sourcePaths, 32) || !edge.sourcePaths.every(safeEvidencePath) || edge.edgeId !== `XD-${digest(Object.fromEntries(Object.entries(edge).filter(([key]) => key !== 'edgeId'))).slice(7)}` ||
      plan.tasks.find((task) => task.taskId === edge.fromTaskId)?.repository !== edge.sourceRepository ||
      plan.tasks.find((task) => task.taskId === edge.toTaskId)?.repository !== edge.targetRepository)) throw new Error('INVALID_DEPENDENCY_EDGE');
    for (const task of plan.tasks) if (stable(task.dependencies) !== stable(sorted(plan.dependencyEdges.filter((edge) => edge.toTaskId === task.taskId).map((edge) => edge.fromTaskId)))) {
      throw new Error('DEPENDENCY_DECLARATION_MISMATCH');
    }
    return { status: 'VALID', reasons: [] };
  } catch (error) { return { status: 'INVALID', reasons: [error.message] }; }
}

const stringArray = (value, max = 64) => Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every((item) => bounded(item, 160));

const resultKeys = 'taskId repository status completionDecision validationStatus evidenceReceipts dependencyFingerprints';
function normalizeResult(value, task) {
  if (!exact(value, resultKeys) || value.taskId !== task.taskId || value.repository !== task.repository ||
    !TASK_STATUSES.includes(value.status) || !(value.completionDecision === null || COMPLETION_DECISIONS.includes(value.completionDecision)) ||
    !VALIDATION_STATUSES.includes(value.validationStatus) || !Array.isArray(value.evidenceReceipts) || value.evidenceReceipts.length > 64 ||
    !value.evidenceReceipts.every((receipt) => exact(receipt, 'receiptId repository') && RECEIPT_ID.test(receipt.receiptId) &&
      ['wayper', 'wayper-site'].includes(receipt.repository)) || !Array.isArray(value.dependencyFingerprints) ||
    !value.dependencyFingerprints.every((item) => exact(item, 'edgeId fingerprint') && /^XD-[a-f0-9]{64}$/.test(item.edgeId) && /^sha256:[a-f0-9]{64}$/.test(item.fingerprint))) {
    throw new Error('WRONG_REPOSITORY_TASK');
  }
  return structuredClone(value);
}

export function assessCrossRepoPlan(plan, taskResults, { repositories } = {}) {
  if (validateCrossRepoPlan(plan).status !== 'VALID') throw new Error('INVALID_CROSS_REPO_PLAN');
  if (!Array.isArray(taskResults) || taskResults.length !== plan.tasks.length ||
    new Set(taskResults.map((item) => item.taskId)).size !== taskResults.length) throw new Error('TASK_RESULTS_INCOMPLETE');
  const definitions = repositories ?? [];
  const taskStates = []; const dependencyStates = []; const blockers = []; const warnings = [];
  let replan = false; let external = false; let invalid = false;
  for (const task of plan.tasks) {
    const result = normalizeResult(taskResults.find((item) => item.taskId === task.taskId), task);
    let currentScope = task.scopeFingerprint; let repositoryUnavailable = false;
    try { if (repo(definitions, task.repository)) currentScope = taskScopeFingerprint(repo(definitions, task.repository), task.scopes); }
    catch { repositoryUnavailable = true; }
    let status = result.status; const reasons = [];
    if (currentScope !== task.scopeFingerprint) { status = 'REVALIDATION_REQUIRED'; reasons.push('TASK_SOURCE_CHANGED'); replan = true; }
    if (result.evidenceReceipts.some((receipt) => receipt.repository !== task.repository)) { status = 'INVALID'; reasons.push('CROSS_REPOSITORY_EVIDENCE'); invalid = true; }
    const baseline = plan.baselineReference.repositories.find((item) => item.repository === task.repository);
    if (task.operation === 'MUTATE' && baseline?.dirty && baseline.dirtyPaths.some((file) => task.scopes.some((scope) => scopeContains(scope, file)))) {
      status = 'BLOCKED'; reasons.push('EXTERNAL_CHANGE_PRESENT'); external = true;
    }
    if (result.status === 'UNAVAILABLE') { status = 'BLOCKED'; reasons.push('REPOSITORY_UNAVAILABLE'); external = true; }
    if (repositoryUnavailable) { status = 'BLOCKED'; reasons.push('REPOSITORY_UNAVAILABLE'); external = true; }
    if (status === 'COMPLETE' && (result.completionDecision !== 'ADMISSIBLE' || result.validationStatus !== 'COMPLETE' || !result.evidenceReceipts.length)) {
      status = 'FAILED'; reasons.push('TASK_PROOF_INCOMPLETE');
    }
    taskStates.push({ taskId: task.taskId, repository: task.repository, blocking: task.blocking, status,
      completionDecision: result.completionDecision, validationStatus: result.validationStatus,
      evidenceReceiptIds: sorted(result.evidenceReceipts.map((receipt) => receipt.receiptId)), reasons: sorted(reasons),
      retainedOnPeerFailure: status === 'COMPLETE' });
  }
  for (const edge of plan.dependencyEdges) {
    const source = taskStates.find((task) => task.taskId === edge.fromTaskId);
    const target = taskStates.find((task) => task.taskId === edge.toTaskId);
    const result = taskResults.find((task) => task.taskId === edge.toTaskId);
    const observed = result.dependencyFingerprints.find((item) => item.edgeId === edge.edgeId)?.fingerprint;
    const sourceDefinition = repo(definitions, edge.sourceRepository);
    const currentSource = sourceDefinition ? digest(edge.sourcePaths.map((file) => [file, fileHash(sourceDefinition, file)])) : edge.sourceFingerprint;
    let status = source.status === 'COMPLETE' ? 'SATISFIED' : 'BLOCKING';
    if (currentSource !== edge.sourceFingerprint || status === 'SATISFIED' && observed !== currentSource) status = 'REVALIDATION_REQUIRED';
    if (status !== 'SATISFIED' && target.status === 'COMPLETE') target.status = status === 'BLOCKING' ? 'BLOCKED' : 'REVALIDATION_REQUIRED';
    if (status === 'REVALIDATION_REQUIRED') replan = true;
    dependencyStates.push({ edgeId: edge.edgeId, fromTaskId: edge.fromTaskId, toTaskId: edge.toTaskId, status });
  }
  for (const task of taskStates) if (task.blocking && task.status !== 'COMPLETE') blockers.push({
    blockerId: `XB-${digest([task.taskId, task.status, task.reasons]).slice(7)}`, taskId: task.taskId,
    repository: task.repository, reasonCode: task.reasons[0] ?? task.status,
  });
  const repositoryStates = plan.repositories.map((repository) => {
    const states = taskStates.filter((task) => task.repository === repository);
    return { repository, status: states.every((task) => task.status === 'COMPLETE') ? 'COMPLETE' :
      states.some((task) => task.status === 'BLOCKED') ? 'BLOCKED' : 'INCOMPLETE' };
  });
  const decision = invalid ? 'INVALID_STATE' : replan ? 'REPLAN_REQUIRED' : external ? 'BLOCKED' : blockers.length ? 'INCOMPLETE' : 'COMPLETE';
  const value = { schemaVersion: CROSS_REPO_SCHEMA_VERSION, goalReference: plan.goalReference, planId: plan.planId,
    baselineReference: plan.baselineReference, repositoryStates, taskStates, dependencyStates, blockers, warnings, decision,
    metrics: { crossRepoGoals: plan.repositories.length > 1 ? 1 : 0, repoTasks: plan.tasks.length,
      dependencyEdges: plan.dependencyEdges.length, repoTasksCompleted: taskStates.filter((task) => task.status === 'COMPLETE').length,
      repoTasksBlocked: taskStates.filter((task) => ['BLOCKED', 'FAILED', 'REVALIDATION_REQUIRED', 'INVALID'].includes(task.status)).length,
      crossRepoRevalidations: dependencyStates.filter((edge) => edge.status === 'REVALIDATION_REQUIRED').length,
      crossRepoFeedbackCycles: 0, externalRepoBlocks: blockers.filter((item) => ['EXTERNAL_CHANGE_PRESENT', 'REPOSITORY_UNAVAILABLE'].includes(item.reasonCode)).length } };
  return seal(value, 'assessmentId', 'XA');
}

export function validateCrossRepoAssessment(assessment, plan) {
  try {
    if (!exact(assessment, ASSESSMENT_KEYS) || assessment.schemaVersion !== 1 ||
      stable(seal(assessment, 'assessmentId', 'XA')) !== stable(assessment) || assessment.planId !== plan.planId ||
      stable(assessment.goalReference) !== stable(plan.goalReference) || stable(assessment.baselineReference) !== stable(plan.baselineReference) ||
      !CROSS_REPO_DECISIONS.includes(assessment.decision) || !Array.isArray(assessment.repositoryStates) ||
      !Array.isArray(assessment.taskStates) || !Array.isArray(assessment.dependencyStates) || !Array.isArray(assessment.blockers) ||
      !Array.isArray(assessment.warnings) || stable(assessment.repositoryStates.map((item) => item.repository).sort()) !== stable(plan.repositories) ||
      assessment.taskStates.some((item) => !exact(item, 'taskId repository blocking status completionDecision validationStatus evidenceReceiptIds reasons retainedOnPeerFailure') ||
        !plan.tasks.some((task) => task.taskId === item.taskId && task.repository === item.repository) || typeof item.blocking !== 'boolean' ||
        !['PENDING', 'COMPLETE', 'FAILED', 'BLOCKED', 'REVALIDATION_REQUIRED', 'INVALID'].includes(item.status) ||
        !stringArray(item.evidenceReceiptIds) || !item.evidenceReceiptIds.every((id) => RECEIPT_ID.test(id)) || !stringArray(item.reasons) ||
        typeof item.retainedOnPeerFailure !== 'boolean') || assessment.dependencyStates.length !== plan.dependencyEdges.length ||
      !assessment.metrics || Object.values(assessment.metrics).some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new Error('INVALID_CROSS_REPO_ASSESSMENT');
    }
    return { status: 'CURRENT', reasons: [] };
  } catch (error) { return { status: 'INVALID', reasons: [error.message] }; }
}

export function validateCurrentCrossRepoState({ plan, assessment }, repositories) {
  if (validateCrossRepoAssessment(assessment, plan).status !== 'CURRENT') return { status: 'INVALID_STATE', affectedTaskIds: [] };
  const changed = [];
  for (const task of plan.tasks) {
    const definition = repo(repositories, task.repository);
    if (!definition) return { status: 'BLOCKED', affectedTaskIds: [task.taskId] };
    try { if (taskScopeFingerprint(definition, task.scopes) !== task.scopeFingerprint) changed.push(task.taskId); }
    catch { return { status: 'BLOCKED', affectedTaskIds: [task.taskId] }; }
  }
  for (const edge of plan.dependencyEdges) {
    const definition = repo(repositories, edge.sourceRepository);
    try {
      const current = definition && digest(edge.sourcePaths.map((file) => [file, fileHash(definition, file)]));
      if (current !== edge.sourceFingerprint) changed.push(edge.fromTaskId);
    } catch { return { status: 'BLOCKED', affectedTaskIds: [edge.fromTaskId] }; }
  }
  const affectedTaskIds = affectedTasksForAmendment(plan, sorted(changed));
  return { status: affectedTaskIds.length ? 'REPLAN_REQUIRED' : 'CURRENT', affectedTaskIds };
}

export function affectedTasksForAmendment(plan, changedTaskIds) {
  const affected = new Set(changedTaskIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of plan.dependencyEdges) if (affected.has(edge.fromTaskId) && !affected.has(edge.toTaskId)) {
      affected.add(edge.toTaskId); grew = true;
    }
  }
  return [...affected].sort();
}

export function crossRepoFeedbackTargets(assessment) {
  return assessment.taskStates.filter((task) => task.blocking && task.status !== 'COMPLETE')
    .map((task) => ({ taskId: task.taskId, repository: task.repository, action: task.status === 'REVALIDATION_REQUIRED' ? 'REVALIDATE' : 'FEEDBACK' }));
}

export function composeCrossRepoContext(plan, artifactRefs) {
  if (!Array.isArray(artifactRefs) || artifactRefs.length > 64 || artifactRefs.some((ref) =>
    !exact(ref, 'artifactId repository') || !plan.repositories.includes(ref.repository) || !bounded(ref.artifactId, 160))) {
    throw new Error('CROSS_REPO_CONTEXT_ISOLATION');
  }
  return { schemaVersion: 1, goalReference: plan.goalReference, planId: plan.planId, kind: 'COMPOSED_CONTEXT_REFS',
    authority: 'CONTEXT_ONLY', repositories: plan.repositories.map((repository) => ({ repository,
      artifactRefs: sorted(artifactRefs.filter((ref) => ref.repository === repository).map((ref) => ref.artifactId)) })) };
}

export function validateCrossRepoHandoff(plan, handoff) {
  const task = plan.tasks.find((item) => item.taskId === handoff?.taskId);
  return Boolean(task && exact(handoff, 'goalReference taskId repository dispatchPlanId') &&
    stable(handoff.goalReference) === stable(plan.goalReference) && handoff.repository === task.repository &&
    /^DP-[a-f0-9]{64}$/.test(handoff.dispatchPlanId));
}

function crossRepoFile(root, identity, ...parts) {
  return contextStoreFile(root, 'cross-repo', [identity.goalRunId, `r${identity.revision}`, ...parts]);
}
export function persistCrossRepoPlan(plan, { root }) {
  if (validateCrossRepoPlan(plan).status !== 'VALID') throw new Error('INVALID_CROSS_REPO_PLAN');
  writeContextArtifact(crossRepoFile(root, plan.goalReference, 'plans', `${plan.planId}.json`), plan);
  return plan;
}
export function persistCrossRepoAssessment(assessment, plan, { root }) {
  if (validateCrossRepoAssessment(assessment, plan).status !== 'CURRENT') throw new Error('INVALID_CROSS_REPO_ASSESSMENT');
  writeContextArtifact(crossRepoFile(root, assessment.goalReference, 'assessments', `${assessment.assessmentId}.json`), assessment);
  writeContextArtifact(crossRepoFile(root, assessment.goalReference, 'current.json'), { planId: plan.planId, assessmentId: assessment.assessmentId }, false);
  return assessment;
}
export function readCurrentCrossRepoAssessment({ root, identity }) {
  assertIdentity(identity);
  const pointer = crossRepoFile(root, identity, 'current.json');
  if (!fs.existsSync(pointer)) return null;
  const { planId, assessmentId } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
  const plan = JSON.parse(fs.readFileSync(crossRepoFile(root, identity, 'plans', `${planId}.json`), 'utf8'));
  const assessment = JSON.parse(fs.readFileSync(crossRepoFile(root, identity, 'assessments', `${assessmentId}.json`), 'utf8'));
  if (validateCrossRepoAssessment(assessment, plan).status !== 'CURRENT') throw new Error('INVALID_CROSS_REPO_ASSESSMENT');
  return { plan, assessment };
}

export const crossRepoTelemetry = (assessment) => ({ ...assessment.metrics });
