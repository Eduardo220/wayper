import assert from 'node:assert/strict';
import test from 'node:test';
import { routeTask } from '../wayper-agent-router.mjs';
import { assessGoalCompletion } from '../wayper-completion-boundary.mjs';
import { contextEconomyAssessment } from '../wayper-context-economy.mjs';
import { classifyFeedbackFailures, compareFeedbackProgress } from '../wayper-feedback-policy.mjs';
import { issuePermit } from '../wayper-dispatch-execution.mjs';
import { assertMemoryAuthority } from '../wayper-project-memory.mjs';
import { buildValidationPlan } from '../wayper-validation-planner.mjs';
import { loadCapabilityFiles } from './check-capability-routing.mjs';
import { completionFixture, finding } from './completion-fixture.mjs';
import { fixture as contextFixture } from './context-economy-fixture.mjs';
import { writer } from './dispatch-fixture.mjs';

const registry = loadCapabilityFiles().registry;
const input = (extra = {}) => ({ schemaVersion: 1, goalId: 'PT-goal', operation: 'LOCAL_CHANGE', repositories: ['wayper'],
  changedFiles: ['README.md'], candidatePaths: ['README.md'], riskFlags: [], knownCapabilities: [], knownGoodCapabilities: [],
  capabilityAssessmentComplete: true, structuralUncertainty: false, taskClass: 'TRIVIAL', orchestrationMode: 'S0',
  executionIntent: 'NONE', signals: [], ...extra });
const assess = (f) => assessGoalCompletion({ root: f.root, identity: f.identity });
const levels = (plan) => new Set(plan.requirements.filter((r) => r.applicability.status === 'APPLICABLE').map((r) => r.level));

test('PT1 LOW local change keeps main-first routing', () => {
  const route = routeTask(input(), registry);
  assert.equal(route.selectionReceipt.decision, 'BEHAVIORAL_FALLBACK');
  assert.deepEqual(route.selectionReceipt.profileIds, []);
});
test('PT2 LOW does not select a specialist from profile availability alone', () => {
  const route = routeTask(input({ orchestrationMode: 'S1', executionIntent: 'READ_ONLY_SPECIALIST' }), registry);
  assert.equal(route.selectionReceipt.decision, 'BEHAVIORAL_FALLBACK');
  assert.deepEqual(route.selectionReceipt.profileIds, []);
});
test('PT3 missing local check does not become BLOCKED_EXTERNAL', async (t) => {
  const f = completionFixture(t); await f.ready();
  f.input.operation = 'BUG_FIX'; f.input.repositories[0].capabilities = ['product-rules']; f.plan(); f.refresh();
  const a = assess(f); assert.equal(a.decision, 'NOT_ADMISSIBLE');
  assert.ok(a.blockers.some((b) => b.reasonCode === 'APPROVED_CHECK_UNAVAILABLE'));
});
test('PT4 enough current context stops additional acquisition', async (t) => {
  const f = contextFixture(t); const first = await f.resolve(); const second = await f.resolve();
  assert.equal(second.artifactId, first.artifactId);
  assert.equal(contextEconomyAssessment(f.options).artifactsAcquired, 1);
});
test('PT5 MEDIUM specialist requires matched read-only capability', () => {
  const route = routeTask(input({ operation: 'REVIEW_ROUTE_GEOMETRY', taskClass: 'BOUNDED', riskFlags: ['GPS_GEO'],
    knownCapabilities: ['route-geometry'], orchestrationMode: 'S1', executionIntent: 'READ_ONLY_SPECIALIST' }), registry);
  assert.equal(route.selectionReceipt.decision, 'ROUTER_SELECTED');
  assert.ok(route.selectionReceipt.profileIds.length > 0);
});
test('PT6 HIGH authorization keeps L2 validation', (t) => {
  const f = completionFixture(t); f.input.operation = 'BUG_FIX';
  Object.assign(f.input.repositories[0], { capabilities: ['firebase-auth'], risks: ['AUTH_SECURITY'] });
  assert.ok(levels(buildValidationPlan({ ...f.options(), inputs: f.input })).has('L2'));
});
test('PT7 CRITICAL physical claim keeps deep safety requirement', (t) => {
  const f = completionFixture(t); f.input.operation = 'CRITICAL_RUNTIME'; f.input.taskClass = 'CRITICAL_RUNTIME';
  Object.assign(f.input.repositories[0], { capabilities: ['active-run-recovery'], risks: ['RUN_DATA_LOSS', 'LIFECYCLE'], platforms: ['android'] });
  f.input.criteria.push({ id: 'real-device', repository: 'wayper', platform: 'android', claim: 'PHYSICAL_DEVICE', required: true, blocking: true });
  const required = levels(buildValidationPlan({ ...f.options(), inputs: f.input }));
  assert.ok(required.has('L2')); assert.ok(required.has('L5'));
});
test('PT8 material product ambiguity still needs a human', async (t) => {
  const f = completionFixture(t); await f.ready();
  f.state.contextMap.ambiguities.push({ code: 'PRODUCT_DECISION', repository: 'wayper', materiality: 'MATERIAL',
    status: 'OPEN', reason: 'Conflicting approved rules', relatedRequirementIds: [], receiptIds: [] }); f.refresh();
  assert.ok(assess(f).blockers.some((b) => b.kind === 'AMBIGUITY'));
});
test('PT9 local technical gap routes to replan, not human', () => {
  const blocker = { kind: 'VALIDATION', sourceId: 'VR-local', reasonCode: 'APPROVED_CHECK_UNAVAILABLE', repository: 'wayper',
    blocking: true, relatedRequirementIds: ['VR-local'], relatedReceiptIds: [], relatedFindingIds: [], blockerId: 'CB-local' };
  assert.equal(classifyFeedbackFailures({ blockers: [blocker] })[0].failureClass, 'REPLAN');
});
test('RB3 RB4 local validation and investigable technical gaps stay local', () => {
  const blocker = (kind, reasonCode) => ({ kind, sourceId: 'local', reasonCode, repository: 'wayper',
    blocking: true, relatedRequirementIds: [], relatedReceiptIds: [], relatedFindingIds: [], blockerId: 'CB-local' });
  assert.equal(classifyFeedbackFailures({ blockers: [blocker('VALIDATION', 'APPROVED_CHECK_UNAVAILABLE')] })[0].failureClass, 'REPLAN');
  assert.equal(classifyFeedbackFailures({ blockers: [blocker('PROOF_GAP', 'OPEN')] })[0].failureClass, 'REVALIDATE');
});
test('PT10 unchanged context uses cache', async (t) => {
  const f = contextFixture(t); await f.resolve(); const again = await f.resolve();
  assert.equal(again.disposition, 'REUSED'); assert.equal(contextEconomyAssessment(f.options).cacheHits, 1);
});
test('PT11 repeated failure without material progress remains no progress', () => {
  const state = { failures: [{ failureId: 'FL-same', severity: 'HIGH', kind: 'FINDING', reasonCode: 'OPEN' }],
    assessment: { decision: 'NOT_ADMISSIBLE', requirementState: [] } };
  const progress = compareFeedbackProgress(state, structuredClone(state), { previousNoProgress: 1 });
  assert.equal(progress.materialProgress, false); assert.equal(progress.consecutiveNoProgress, 2);
});
test('PT12 completion without a proved criterion is rejected', (t) => {
  const f = completionFixture(t); f.plan(); f.refresh(); assert.notEqual(assess(f).decision, 'ADMISSIBLE');
});
test('PT13 mutation requires project ownership and a permit', (t) => {
  const f = writer(t); assert.throws(() => issuePermit({ ...f.options7,
    action: { kind: 'WRITE_FILE', file: 'README.md', content: '# Changed\n' } }), /GRANT|OWNERSHIP|DISPATCH/);
});
test('PT14 cross-repo blocker remains scoped to its repository', async (t) => {
  const f = completionFixture(t, true); await f.ready(); f.state.contextMap.findings = [finding({ repository: 'wayper-site' })]; f.refresh();
  const a = assess(f); assert.equal(a.decision, 'NOT_ADMISSIBLE');
  assert.ok(a.blockers.some((b) => b.kind === 'FINDING' && b.repository === 'wayper-site'));
});
test('PT15 Memory remains CONTEXT_ONLY', () => {
  assert.equal(assertMemoryAuthority('CONTEXT').authority, 'CONTEXT_ONLY');
  for (const purpose of ['EVIDENCE', 'AUTHORIZATION', 'COMPLETION']) assert.throws(() => assertMemoryAuthority(purpose));
});
