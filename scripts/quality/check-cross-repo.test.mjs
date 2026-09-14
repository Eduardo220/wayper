import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { startWorkingContext } from '../wayper-context.mjs';
import {
  affectedTasksForAmendment, assessCrossRepoPlan, buildCrossRepoPlan, composeCrossRepoContext,
  crossRepoFeedbackTargets, persistCrossRepoAssessment, persistCrossRepoPlan, validateCrossRepoHandoff, validateCrossRepoPlan,
  validateCurrentCrossRepoState,
} from '../wayper-cross-repo.mjs';
import { assessGoalCompletion } from '../wayper-completion-boundary.mjs';
import { completionFixture } from './completion-fixture.mjs';
import { buildLearningCandidate, emptyMemoryIndex, promoteLearningCandidate, retrieveProjectMemory } from '../wayper-project-memory.mjs';
import { sourceFingerprint } from '../wayper-evidence-receipts.mjs';

const receipt = (repository, n = 'a') => ({ receiptId: `ER-${n.repeat(64)}`, repository });
function repository(root, id) {
  const directory = path.join(root, id); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, '.gitignore'), '.wayper-context/\n');
  fs.writeFileSync(path.join(directory, 'owner.js'), `export const owner = '${id}';\n`);
  fs.writeFileSync(path.join(directory, 'notes.md'), `# ${id}\n`);
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  return { id, root: directory, logicalRoot: id === 'wayper' ? '.' : '../wayper-site' };
}
function fixture(t, { dirtySite = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-cross-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repositories = [repository(directory, 'wayper'), repository(directory, 'wayper-site')];
  if (dirtySite) fs.writeFileSync(path.join(repositories[1].root, 'human-wip.md'), 'external\n');
  const state = startWorkingContext({ root: repositories[0].root, repositories, threadId: 'cross-fixture',
    objective: 'Coordinate project repositories', taskClass: 'ARCHITECTURAL', requirements: ['SUCCESS:cross'] });
  return { directory, repositories, execution: state.execution };
}
const task = (taskId, repository, extra = {}) => ({ taskId, repository, operation: 'READ',
  scopes: [{ kind: 'FILE', path: 'owner.js' }], capabilities: [], risks: [], dependencies: [], blocking: true, ...extra });
function multi(f, extra = {}) {
  const edges = extra.edges ?? [];
  const tasks = extra.tasks ?? [task('mobile', 'wayper'), task('site', 'wayper-site')];
  return buildCrossRepoPlan({ execution: f.execution, repositories: f.repositories, tasks, dependencyEdges: edges });
}
function results(plan, overrides = {}) {
  return plan.tasks.map((item) => ({ taskId: item.taskId, repository: item.repository, status: 'COMPLETE',
    completionDecision: 'ADMISSIBLE', validationStatus: 'COMPLETE', evidenceReceipts: [receipt(item.repository, item.repository === 'wayper' ? 'a' : 'b')],
    dependencyFingerprints: plan.dependencyEdges.filter((edge) => edge.toTaskId === item.taskId)
      .map((edge) => ({ edgeId: edge.edgeId, fingerprint: edge.sourceFingerprint })), ...overrides[item.taskId] }));
}

test('CR1 single-repo Goal does not create site work', (t) => {
  const f = fixture(t); const plan = multi(f, { tasks: [task('mobile', 'wayper')] });
  assert.deepEqual(plan.repositories, ['wayper']); assert.equal(plan.tasks.length, 1);
});

test('CR2 multi-repo Goal creates distinct repo-scoped tasks', (t) => {
  const plan = multi(fixture(t));
  assert.deepEqual(plan.tasks.map((item) => item.repository), ['wayper', 'wayper-site']);
  assert.ok(plan.tasks.every((item) => item.taskId !== plan.planId && item.goalRunId === plan.goalReference.goalRunId));
});

test('CR3 mobile PASS and site PASS make cross-repo COMPLETE', (t) => {
  const f = fixture(t); const plan = multi(f);
  assert.equal(assessCrossRepoPlan(plan, results(plan), f).decision, 'COMPLETE');
});

test('CR4 mobile PASS and site FAIL keep the Project Goal incomplete', (t) => {
  const f = fixture(t); const plan = multi(f); const assessment = assessCrossRepoPlan(plan, results(plan, {
    site: { status: 'FAILED', completionDecision: 'NOT_ADMISSIBLE', validationStatus: 'INCOMPLETE' },
  }), f);
  assert.equal(assessment.decision, 'INCOMPLETE'); assert.equal(assessment.taskStates.find((item) => item.taskId === 'mobile').status, 'COMPLETE');
});

test('CR5 site PASS cannot satisfy a mobile task', (t) => {
  const f = fixture(t); const plan = multi(f); const input = results(plan);
  input.find((item) => item.taskId === 'mobile').repository = 'wayper-site';
  assert.throws(() => assessCrossRepoPlan(plan, input, f), /WRONG_REPOSITORY_TASK/);
});

test('CR6 mobile receipt cannot satisfy site proof', (t) => {
  const f = fixture(t); const plan = multi(f); const input = results(plan);
  input.find((item) => item.taskId === 'site').evidenceReceipts = [receipt('wayper')];
  const assessment = assessCrossRepoPlan(plan, input, f);
  assert.equal(assessment.decision, 'INVALID_STATE'); assert.match(assessment.taskStates[1].reasons.join(), /CROSS_REPOSITORY_EVIDENCE/);
});

test('CR7 prerequisite blocks its dependent task', (t) => {
  const f = fixture(t); const edge = { type: 'PRODUCES_FOR', fromTaskId: 'mobile', toTaskId: 'site', sourcePaths: ['owner.js'] };
  const plan = multi(f, { tasks: [task('mobile', 'wayper'), task('site', 'wayper-site', { dependencies: ['mobile'] })], edges: [edge] });
  const assessment = assessCrossRepoPlan(plan, results(plan, { mobile: { status: 'FAILED', completionDecision: 'NOT_ADMISSIBLE', validationStatus: 'INCOMPLETE' } }), f);
  assert.equal(assessment.dependencyStates[0].status, 'BLOCKING'); assert.equal(assessment.taskStates[1].status, 'BLOCKED');
});

test('CR8 independent tasks retain separate progress', (t) => {
  const f = fixture(t); const plan = multi(f); const assessment = assessCrossRepoPlan(plan, results(plan, {
    site: { status: 'PENDING', completionDecision: null, validationStatus: 'INCOMPLETE', evidenceReceipts: [] },
  }), f);
  assert.equal(assessment.taskStates[0].status, 'COMPLETE'); assert.equal(assessment.taskStates[1].status, 'PENDING');
});

test('CR9 amendment impact is limited to changed tasks and dependents', (t) => {
  const f = fixture(t); const plan = multi(f);
  assert.deepEqual(affectedTasksForAmendment(plan, ['mobile']), ['mobile']);
  assert.deepEqual(affectedTasksForAmendment(plan, ['site']), ['site']);
});

test('CR10 wrong-repository task result is rejected', (t) => {
  const f = fixture(t); const plan = multi(f); const input = results(plan); input[0].repository = 'wayper-site';
  assert.throws(() => assessCrossRepoPlan(plan, input, f), /WRONG_REPOSITORY_TASK/);
});

test('CR11 dirty site plus overlapping writer is blocked', (t) => {
  const f = fixture(t, { dirtySite: true }); const plan = multi(f, { tasks: [task('site', 'wayper-site', {
    operation: 'MUTATE', scopes: [{ kind: 'REPOSITORY', path: '.' }],
  })] });
  const assessment = assessCrossRepoPlan(plan, results(plan), f);
  assert.equal(assessment.decision, 'BLOCKED'); assert.equal(assessment.blockers[0].reasonCode, 'EXTERNAL_CHANGE_PRESENT');
});

test('CR12 dirty site safe read-only scope is permitted', (t) => {
  const f = fixture(t, { dirtySite: true }); const plan = multi(f, { tasks: [task('site', 'wayper-site')] });
  assert.equal(assessCrossRepoPlan(plan, results(plan), f).decision, 'COMPLETE');
});

test('dirty site permits a proven disjoint writer scope', (t) => {
  const f = fixture(t, { dirtySite: true }); const plan = multi(f, { tasks: [task('site', 'wayper-site', { operation: 'MUTATE' })] });
  assert.equal(assessCrossRepoPlan(plan, results(plan), f).decision, 'COMPLETE');
});

test('CR13 site failure never rolls back completed mobile', (t) => {
  const f = fixture(t); const plan = multi(f); const assessment = assessCrossRepoPlan(plan, results(plan, {
    site: { status: 'FAILED', completionDecision: 'NOT_ADMISSIBLE', validationStatus: 'INCOMPLETE' },
  }), f);
  assert.equal(assessment.taskStates[0].retainedOnPeerFailure, true); assert.equal(plan.completionPolicy.noAutomaticRollback, true);
});

test('CR14 feedback targets only the failing independent repository', (t) => {
  const f = fixture(t); const plan = multi(f); const assessment = assessCrossRepoPlan(plan, results(plan, {
    site: { status: 'FAILED', completionDecision: 'NOT_ADMISSIBLE', validationStatus: 'INCOMPLETE' },
  }), f);
  assert.deepEqual(crossRepoFeedbackTargets(assessment), [{ taskId: 'site', repository: 'wayper-site', action: 'FEEDBACK' }]);
});

test('CR15 changed dependency source makes other-repo validation stale', (t) => {
  const f = fixture(t); const edge = { type: 'VALIDATES_WITH', fromTaskId: 'mobile', toTaskId: 'site', sourcePaths: ['owner.js'] };
  const plan = multi(f, { tasks: [task('mobile', 'wayper'), task('site', 'wayper-site', { dependencies: ['mobile'] })], edges: [edge] });
  fs.appendFileSync(path.join(f.repositories[0].root, 'owner.js'), '// changed\n');
  const assessment = assessCrossRepoPlan(plan, results(plan), f);
  assert.equal(assessment.dependencyStates[0].status, 'REVALIDATION_REQUIRED');
  assert.equal(assessment.taskStates.find((item) => item.taskId === 'site').status, 'REVALIDATION_REQUIRED');
});

test('CR16 unrelated source change leaves independent repo task valid', (t) => {
  const f = fixture(t); const plan = multi(f); fs.appendFileSync(path.join(f.repositories[0].root, 'notes.md'), 'unrelated\n');
  const assessment = assessCrossRepoPlan(plan, results(plan), f);
  assert.equal(assessment.taskStates.find((item) => item.taskId === 'site').status, 'COMPLETE');
});

test('CR17 composed Context preserves repository isolation and no authority', (t) => {
  const plan = multi(fixture(t)); const context = composeCrossRepoContext(plan, [
    { artifactId: 'mobile-source', repository: 'wayper' }, { artifactId: 'site-source', repository: 'wayper-site' },
  ]);
  assert.equal(context.authority, 'CONTEXT_ONLY'); assert.deepEqual(context.repositories[0].artifactRefs, ['mobile-source']);
});

test('CR18 completion cannot ignore a blocking repository task', (t) => {
  const f = fixture(t); const plan = multi(f); const assessment = assessCrossRepoPlan(plan, results(plan, {
    site: { status: 'BLOCKED', completionDecision: 'BLOCKED_EXTERNAL', validationStatus: 'BLOCKED', evidenceReceipts: [] },
  }), f);
  assert.notEqual(assessment.decision, 'COMPLETE'); assert.ok(assessment.blockers.some((item) => item.repository === 'wayper-site'));
});

test('CR19 unavailable repository yields BLOCKED, never false PASS', (t) => {
  const f = fixture(t); const plan = multi(f); const assessment = assessCrossRepoPlan(plan, results(plan, {
    site: { status: 'UNAVAILABLE', completionDecision: 'BLOCKED_EXTERNAL', validationStatus: 'BLOCKED', evidenceReceipts: [] },
  }), f);
  assert.equal(assessment.decision, 'BLOCKED');
});

test('CR20 cross-repo plan is deterministic', (t) => {
  const f = fixture(t); assert.deepEqual(multi(f), multi(f)); assert.equal(validateCrossRepoPlan(multi(f)).status, 'VALID');
});

test('cross-repo adversarial handoff rejects repository authority leakage', (t) => {
  const plan = multi(fixture(t));
  assert.equal(validateCrossRepoHandoff(plan, { goalReference: plan.goalReference, taskId: 'site', repository: 'wayper', dispatchPlanId: `DP-${'a'.repeat(64)}` }), false);
});

test('cross-repo adversarial plan rejects open schema and globalized repository identity', (t) => {
  const plan = multi(fixture(t));
  assert.equal(validateCrossRepoPlan({ ...plan, globalLease: true }).status, 'INVALID');
  const forged = structuredClone(plan); forged.tasks[0].repository = 'wayper-site';
  assert.equal(validateCrossRepoPlan(forged).status, 'INVALID');
  const missingBaseline = structuredClone(plan); missingBaseline.baselineReference.repositories.pop();
  assert.equal(validateCrossRepoPlan(missingBaseline).status, 'INVALID');
});

test('full cross-repo circuit gates connected Completion without distributed rollback', async (t) => {
  const f = completionFixture(t, true); await f.ready();
  const tasks = [task('mobile', 'wayper', { scopes: [{ kind: 'FILE', path: 'README.md' }] }),
    task('site', 'wayper-site', { scopes: [{ kind: 'FILE', path: 'README.md' }] })];
  const plan = buildCrossRepoPlan({ execution: f.state.execution, repositories: f.repositories, tasks });
  persistCrossRepoPlan(plan, f);
  const failed = assessCrossRepoPlan(plan, results(plan, { site: { status: 'FAILED', completionDecision: 'NOT_ADMISSIBLE', validationStatus: 'INCOMPLETE' } }), f);
  persistCrossRepoAssessment(failed, plan, f);
  const blocked = assessGoalCompletion({ root: f.root, identity: f.identity });
  assert.equal(blocked.decision, 'NOT_ADMISSIBLE'); assert.ok(blocked.blockers.some((item) => item.kind === 'CROSS_REPO'));
  const complete = assessCrossRepoPlan(plan, results(plan), f); persistCrossRepoAssessment(complete, plan, f);
  const admissible = assessGoalCompletion({ root: f.root, identity: f.identity }); assert.equal(admissible.decision, 'ADMISSIBLE');
  const dependency = { repository: 'wayper', path: 'README.md', fingerprint: sourceFingerprint(f.root, 'README.md').hash };
  const candidate = buildLearningCandidate({ goalReference: f.identity, subject: 'Validated Project Goal repository isolation',
    proposedKind: 'VALIDATED_PATTERN', proposedStatement: 'Project completion composes repository-scoped task proof without authority leakage.',
    scope: { project: 'Wayper', repository: null, paths: ['README.md'], capabilities: [], domains: ['harness'] },
    supportingRefs: [
      { kind: 'SOURCE', id: 'fixture-source', repository: 'wayper', path: 'README.md', fingerprint: dependency.fingerprint },
      { kind: 'DOCUMENT', id: 'fixture-contract', repository: 'wayper', path: 'README.md', fingerprint: dependency.fingerprint },
      { kind: 'COMPLETION_ASSESSMENT', id: admissible.assessmentId, repository: null, path: null, fingerprint: null },
    ], contradictingRefs: [], dependencies: [dependency], durabilityReason: 'Prevents future cross-repository proof leakage.' });
  const memory = promoteLearningCandidate(candidate, emptyMemoryIndex(), { now: '2026-09-14T12:00:00.000Z', repositories: f.repositories });
  assert.equal(memory.status, 'PROMOTED');
  const reused = retrieveProjectMemory({ index: memory.index, repository: 'wayper-site', domains: ['harness'], repositories: f.repositories });
  assert.equal(reused.results[0].authority, 'CONTEXT_ONLY');
  fs.appendFileSync(path.join(f.root, 'README.md'), 'material dependency change\n');
  assert.equal(validateCurrentCrossRepoState({ plan, assessment: complete }, f.repositories).status, 'REPLAN_REQUIRED');
  const staleCompletion = assessGoalCompletion({ root: f.root, identity: f.identity });
  assert.notEqual(staleCompletion.decision, 'ADMISSIBLE');
});
