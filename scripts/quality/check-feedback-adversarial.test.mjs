import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { completionFixture, finding } from './completion-fixture.mjs';
import { startFeedbackSession, runFeedbackIteration, resumeFeedbackSession, recoverFeedbackSession, reconcileFeedbackSession } from '../wayper-feedback.mjs';
import { failureIdentity, compareFeedbackProgress, normalizeActionCommand, operationalActionFingerprint, actionFingerprint, failureLineage } from '../wayper-feedback-policy.mjs';
import { readFeedbackSession, readFeedbackHistory, readFeedbackAttempt, appendFeedbackCheckpoint, feedbackTelemetry } from '../wayper-feedback-store.mjs';
import { validateFeedbackSession, validateFeedbackAttempt, sealFeedback } from '../wayper-feedback-schema.mjs';
import { readWorkingContext, ROOT } from '../wayper-context.mjs';
import { buildContextPacket, validateContextPacket } from '../wayper-context-packet.mjs';
import { buildStructuredHandoff, validateStructuredHandoff, planContextMapMerge } from '../wayper-structured-handoff.mjs';
import { relevantQualityTests } from './check-completion-backstop.mjs';

const options = (f, extra = {}) => ({ root: f.root, identity: f.identity, ...extra });
const diagnose = ({ failure, evidenceRefs }) => ({ failureIds: [failure.failureId], causeClass: failure.failureClass,
  summary: 'Observed defect', hypothesis: 'Correct the observed source condition', confidence: 0.8,
  affectedScope: { repository: failure.repository, paths: ['README.md'] }, proposedActionKind: 'EDIT', validationRequirementIds: [], evidenceRefs, actionCommand: null });
async function fixture(t, cross = false) {
  const f = completionFixture(t, cross); await f.ready();
  f.state.contextMap.findings = [finding()]; f.state.contextMap.capabilities.optional = ['test-build']; f.plan(); f.refresh(); return f;
}
const reload = (f) => readWorkingContext(f.root, { 'thread-id': f.identity.threadId, 'goal-run-id': f.identity.goalRunId, revision: f.identity.revision });
const suite = JSON.parse(fs.readFileSync(new URL('../../docs/ai/feedback-loop-evals.json', import.meta.url)));
assert.equal(suite.schemaVersion, 1);
for (const c of suite.cases) test(`${c.id} ${c.claim}`, async (t) => {
  const f = await fixture(t);
  if (['UNIT_DEVICE', 'EXTERNAL'].includes(c.scenario)) {
    f.state.contextMap.findings = []; f.input.repositories[0].platforms = ['android'];
    f.input.criteria = [{ id: 'device', repository: 'wayper', platform: 'android', claim: 'PHYSICAL_DEVICE', required: true, blocking: true }];
    f.plan(); await f.prove('unit-green'); f.refresh();
  }
  if (c.scenario === 'HUMAN') { f.state.contextMap.ambiguities.push({ code: 'PRODUCT', repository: 'wayper', materiality: 'MATERIAL',
    status: 'OPEN', reason: 'Conflicting product constraints', relatedRequirementIds: [], receiptIds: [] }); f.refresh(); }
  let s = startFeedbackSession(options(f, c.scenario === 'BUDGET' ? { attemptBudget: 0 } : {}));
  if (c.scenario === 'TEXT') {
    const a = s.currentFailureSet[0]; assert.equal(failureIdentity({ ...a, message: 'different words' }), a.failureId);
    assert.equal(compareFeedbackProgress({ failures: [a], assessment: {} }, { failures: [{ ...a, message: 'different words' }], assessment: {} }).relation, c.expected); return;
  }
  let calls = 0;
  const act = async (ctx) => { calls++;
    if (c.scenario === 'EDIT') ctx.edit({ repository: 'wayper', file: 'README.md', content: '# More code, same bug\n' });
    if (c.scenario === 'GREEN') await ctx.observeQualityGate({ repository: 'wayper', target: 'green', command: 'node', args: ['-e', 'process.exit(0)'] });
  };
  s = await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act }));
  if (!s.outcome) {
    assert.equal(s.progressState.materialProgress, false);
    s = await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act }));
  }
  assert.equal(s.outcome, c.expected); assert.ok(calls <= 1);
});

test('persisted closed contracts, deterministic IDs, immutable attempts, telemetry and forged success', async (t) => {
  const f = await fixture(t); const s = startFeedbackSession(options(f));
  assert.deepEqual(startFeedbackSession(options(f)), s);
  assert.equal(validateFeedbackSession(sealFeedback({ ...s, transcript: 'private reasoning' })), false);
  assert.throws(() => appendFeedbackCheckpoint({ ...s, state: 'FINISHED', outcome: 'SUCCEEDED', currentFailureSet: [],
    finalAssessmentId: s.currentAssessmentId }, options(f), s), /INVALID/);
  const next = await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act: async () => {} }));
  const a = readFeedbackAttempt(s.feedbackId, next.attempts[0].attemptId, options(f));
  assert.equal(validateFeedbackAttempt(a), true);
  assert.equal(validateFeedbackAttempt(sealFeedback({ ...a, actionFingerprint: s.fingerprint })), false);
  assert.equal(validateFeedbackAttempt(sealFeedback({ ...a, chainOfThought: 'private' })), false);
  assert.throws(() => appendFeedbackCheckpoint(next, options(f), s), /BUSY/);
  const stats = feedbackTelemetry([readFeedbackHistory(s.feedbackId, options(f))]);
  assert.equal(stats.sessionsStarted, 1); assert.equal(stats.sameFailureCount, 1); assert.equal(stats.attempts, 1);
  assert.equal(stats.providerTokens, 'UNKNOWN');
});

test('simultaneous invocation cannot reserve a second mutation or interrupt the owner', async (t) => {
  const f = await fixture(t); const s = startFeedbackSession(options(f)); let calls = 0;
  await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act: async () => {
    calls++;
    await assert.rejects(runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act: async () => { calls++; } })), /BUSY/);
  } }));
  assert.equal(calls, 1); assert.equal(readFeedbackSession(s.feedbackId, options(f)).attempts.length, 1);
});

test('real host interruption after action resumes validation without replay', async (t) => {
  const f = await fixture(t); const s = startFeedbackSession(options(f)); const o = options(f, { feedbackId: s.feedbackId });
  const script = `import fs from 'node:fs'; import {runFeedbackIteration} from ${JSON.stringify(new URL('../wayper-feedback.mjs', import.meta.url).href)};
    await runFeedbackIteration({...${JSON.stringify(o)}, diagnose: ${diagnose.toString()},
      act: async () => fs.appendFileSync(${JSON.stringify(path.join(f.root, '.wayper-context', 'calls'))}, ${JSON.stringify('action\n')}),
      validate: async () => process.exit(23)});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(child.status, 23, child.stderr);
  assert.equal(resumeFeedbackSession(o).status, 'INTERRUPTED_UNKNOWN_OUTCOME');
  await assert.rejects(recoverFeedbackSession(o), /OWNER_STOP/);
  const recovered = await recoverFeedbackSession({ ...o, ownerStopped: true });
  assert.equal(recovered.attempts.length, 1); assert.notEqual(recovered.outcome, 'SUCCEEDED');
  assert.equal(fs.readFileSync(path.join(f.root, '.wayper-context', 'calls'), 'utf8'), 'action\n');
});

test('mid-action concurrent WIP is detected before next edit and preserved', async (t) => {
  const f = await fixture(t); const s = startFeedbackSession(options(f));
  const next = await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act: async (ctx) => {
    fs.writeFileSync(path.join(f.root, 'README.md'), 'External WIP\n');
    ctx.edit({ repository: 'wayper', file: 'README.md', content: 'Must never overwrite' });
  } }));
  assert.equal(next.reasonCode, 'CONCURRENT_CHANGE'); assert.equal(next.outcome, 'REPLAN_REQUIRED');
  assert.equal(fs.readFileSync(path.join(f.root, 'README.md'), 'utf8'), 'External WIP\n');
});

test('scoped edit, fresh receipts and owner resolution reach canonical admissibility', async (t) => {
  const f = await fixture(t); const s = startFeedbackSession(options(f)); const baseline = s.baselineReference.fingerprint;
  const next = await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act: async (ctx) => {
    ctx.edit({ repository: 'wayper', file: 'README.md', content: '# Corrected implementation\n' });
    const { receiptId } = await ctx.observeQualityGate({ repository: 'wayper', target: 'finding:F-bug:RESOLVED', command: 'node',
      args: ['-e', 'require("node:assert/strict").match(require("node:fs").readFileSync("README.md","utf8"),/Corrected/)'] });
    ctx.record('finding', finding({ status: 'RESOLVED', receiptIds: [receiptId], resolution: { reviewer: 'OWNER', reason: 'Observed corrected behavior',
      humanDecisionRequired: false, goalReference: ctx.identity, baselineFingerprint: baseline } }));
  }, validate: async (ctx) => {
    const { receiptId } = await ctx.observeQualityGate({ repository: 'wayper', target: 'criterion', command: 'node',
      args: ['-e', 'require("node:assert/strict").match(require("node:fs").readFileSync("README.md","utf8"),/Corrected/)'] });
    ctx.prove('SUCCESS:criterion', receiptId);
  } }));
  assert.equal(next.outcome, 'SUCCEEDED'); assert.equal(next.baselineReference.fingerprint, baseline);
  const a = readFeedbackAttempt(next.feedbackId, next.attempts[0].attemptId, options(f));
  assert.deepEqual(a.changedFiles, ['wayper:README.md']); assert.notEqual(a.stateBefore, a.stateAfter);
});

test('revalidation rejects EDIT diagnosis and validation callbacks cannot edit', async (t) => {
  const f = await fixture(t); let s = startFeedbackSession(options(f));
  s = await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act: async () => {}, validate: async (ctx) => {
    assert.throws(() => ctx.edit({ repository: 'wayper', file: 'README.md', content: 'bad' }), /EDIT_SCOPE/);
  } }));
  assert.equal(s.attempts[0].changedFiles, undefined); // Compact index omits detailed changed scope.
  assert.match(fs.readFileSync(path.join(f.root, 'README.md'), 'utf8'), /Completion fixture/);
});

test('Packet carries only selected repository feedback; Handoff proposal has no attempt authority', async (t) => {
  const f = await fixture(t, true); let s = startFeedbackSession(options(f));
  s = await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act: async () => {} }));
  const map = reload(f).contextMap; const common = { registry: f.registry, repositoryDefinitions: f.repositories, contextMap: map };
  const target = { type: 'validationRole', id: 'followup-review', repositories: ['wayper'], capabilities: ['test-build'], paths: [], objective: 'Review active failure' };
  const p = buildContextPacket(map, target, common);
  assert.equal(p.feedback.failures.length, 1); assert.ok(p.feedback.failedHypotheses.length <= 2); assert.equal(p.feedback.attempts, undefined);
  const site = buildContextPacket(map, { ...target, repositories: ['wayper-site'] }, common);
  assert.deepEqual(site.feedback.failures, []); assert.deepEqual(site.feedback.failedHypotheses, []);
  assert.equal(validateContextPacket(p, common).status, 'VALID');
  const omitted = structuredClone(p); delete omitted.feedback; assert.equal(validateContextPacket(omitted, common).status, 'INVALID');
  const draft = { schemaVersion: 1, goalId: p.goalId, taskId: 'feedback-review', agentId: p.target.id, packetId: p.packetId,
    status: 'DONE', confidence: 0.9, coverage: ['test-build'], findings: [], evidenceRefs: [], newEvidence: [], risks: [], recommendations: [],
    filesRead: [], filesChanged: [], tests: [], proofGaps: [], ambiguities: [], blockers: [],
    feedback: { feedbackId: s.feedbackId, attemptId: p.feedback.attemptId, failureId: p.feedback.failures[0].failureId, diagnosisSummary: 'A bounded review observation' } };
  const h = buildStructuredHandoff(draft, { packet: p }); const merge = planContextMapMerge(h, { ...common, packet: p });
  assert.equal(merge.feedbackProposal.attemptAuthority, 'NONE'); assert.equal(merge.completionAuthority, 'NONE');
  assert.equal(readFeedbackSession(s.feedbackId, options(f)).fingerprint, s.fingerprint);
  draft.feedback.failureId = `FL-${'0'.repeat(64)}`;
  assert.equal(validateStructuredHandoff(buildStructuredHandoff(draft, { packet: p }), { ...common, packet: p }).status, 'INVALID_HANDOFF');
});

test('feedback storage refuses symlink and quality selection covers schema/policy/lifecycle/evals', async (t) => {
  const f = await fixture(t); fs.symlinkSync(f.root, path.join(f.root, '.wayper-context', 'feedback'));
  assert.throws(() => startFeedbackSession(options(f)), /Unsafe/);
  for (const file of ['scripts/wayper-feedback-schema.mjs', 'scripts/wayper-feedback-policy.mjs', 'scripts/wayper-feedback.mjs', 'docs/ai/feedback-loop-evals.json']) {
    assert.ok(relevantQualityTests([file]).includes('scripts/quality/check-feedback-adversarial.test.mjs'), file);
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/quality/check-feedback-loop.test.mjs')), true);
});

const feedbackFacts = (failures, decision = 'NOT_ADMISSIBLE') => ({ failures, assessment: { decision, requirementState: [] } });
const feedbackFailure = (id, severity = 'LOW', repository = 'wayper', sourceId = id) => ({ failureId: id, severity, repository, sourceId,
  relatedReceiptIds: [], kind: 'FINDING', reasonCode: 'OPEN' });

test('FH1/FH2/FH3/FH23 interrupted side effects reconcile without replay', async (t) => {
  const f = await fixture(t); const s = startFeedbackSession(options(f)); const o = options(f, { feedbackId: s.feedbackId });
  const interrupted = ({ failure, evidenceRefs }) => ({ failureIds: [failure.failureId], causeClass: failure.failureClass, summary: 'Interrupted inspection',
    hypothesis: 'Inspect two bounded paths', confidence: 0.8, affectedScope: { repository: failure.repository, paths: ['README.md', 'other.md'] },
    proposedActionKind: 'INSPECT', validationRequirementIds: [], evidenceRefs, actionCommand: null });
  const script = `import fs from 'node:fs'; import {runFeedbackIteration} from ${JSON.stringify(new URL('../wayper-feedback.mjs', import.meta.url).href)};
    await runFeedbackIteration({...${JSON.stringify(o)}, diagnose: ${interrupted.toString()}, act: async () => { fs.writeFileSync(${JSON.stringify(path.join(f.root, 'README.md'))}, 'partial side effect'); process.exit(23); }});`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20_000 }).status, 23);
  const reconciliation = reconcileFeedbackSession(o);
  assert.equal(reconciliation.outcome, 'ACTION_PARTIALLY_APPLIED');
  const recovered = await recoverFeedbackSession({ ...o, ownerStopped: true });
  assert.equal(recovered.outcome, 'REPLAN_REQUIRED');
  assert.equal(fs.readFileSync(path.join(f.root, 'README.md'), 'utf8'), 'partial side effect');
});

test('FH4/FH18/FH19 completed checkpoint resumes validation only', async (t) => {
  const f = await fixture(t); const s = startFeedbackSession(options(f)); const o = options(f, { feedbackId: s.feedbackId });
  const script = `import {runFeedbackIteration} from ${JSON.stringify(new URL('../wayper-feedback.mjs', import.meta.url).href)};
    await runFeedbackIteration({...${JSON.stringify(o)}, diagnose: ${diagnose.toString()}, act: async () => {}, validate: async () => process.exit(23)});`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20_000 }).status, 23);
  const recovered = await recoverFeedbackSession({ ...o, ownerStopped: true });
  assert.equal(recovered.attempts.length, 1); assert.notEqual(recovered.outcome, 'SUCCEEDED');
});

test('FH5/FH6/FH7/FH8 command identity is normalized and state/failure bound', () => {
  const a = { kind: 'INSPECT', repository: 'wayper', paths: ['README.md'], validationRequirementIds: [],
    command: normalizeActionCommand({ command: ' node ', args: ['--version'], cwd: './scripts/../.', environmentKeys: ['CI'] }) };
  const b = { ...a, command: normalizeActionCommand({ argv: ['node', '--version'], cwd: '.', environmentKeys: ['CI'] }) };
  assert.equal(operationalActionFingerprint(a), operationalActionFingerprint(b));
  assert.notEqual(operationalActionFingerprint(a), operationalActionFingerprint({ ...a, command: normalizeActionCommand(['node', '-e', '0']) }));
  assert.notEqual(actionFingerprint(a, 'FL-a', 'state-a'), actionFingerprint(b, 'FL-a', 'state-b'));
  assert.notEqual(actionFingerprint(a, 'FL-a', 'state-a'), actionFingerprint(b, 'FL-b', 'state-a'));
});

test('FH9/FH10/FH15/FH16 material vector detects regression and progress', () => {
  const low = feedbackFailure('FL-low', 'LOW'); const critical = feedbackFailure('FL-critical', 'CRITICAL');
  const regression = compareFeedbackProgress(feedbackFacts([low]), feedbackFacts([critical]));
  assert.equal(regression.regression, true); assert.equal(regression.materialProgress, false);
  const progress = compareFeedbackProgress(feedbackFacts([critical]), feedbackFacts([], 'ADMISSIBLE'));
  assert.equal(progress.regression, false); assert.equal(progress.materialProgress, true);
});

test('FH11/FH12/FH13/FH14 lineage stays factual and bounded', () => {
  const old = feedbackFailure('FL-old', 'HIGH', 'wayper', 'source'); const same = feedbackFailure('FL-old', 'HIGH', 'wayper', 'source');
  const superseding = feedbackFailure('FL-next', 'MEDIUM', 'wayper', 'source'); const independent = feedbackFailure('FL-site', 'LOW', 'wayper-site', 'other');
  const caused = { ...feedbackFailure('FL-caused', 'HIGH', 'wayper', 'new'), relatedReceiptIds: ['ER-a'] };
  const lines = failureLineage(feedbackFacts([old]), feedbackFacts([same, superseding, independent, caused]), { repository: 'wayper', receiptIds: ['ER-a'] });
  assert.deepEqual(lines.map((x) => x.relation), ['SAME_ROOT', 'SUPERSEDES', 'INDEPENDENT', 'CAUSED_BY_ATTEMPT']);
  assert.equal(failureLineage(feedbackFacts([]), feedbackFacts([feedbackFailure('FL-unknown')]), { repository: 'wayper', receiptIds: [] })[0].relation, 'UNKNOWN');
});

test('FH17/FH20/FH21/FH22/FH24/FH25 reuse bounded canonical paths', async (t) => {
  const f = await fixture(t); let s = startFeedbackSession(options(f)); let calls = 0;
  s = await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act: async () => { calls++; } }));
  const duplicate = await runFeedbackIteration(options(f, { feedbackId: s.feedbackId, diagnose, act: async () => { calls++; } }));
  assert.equal(calls, 1); assert.equal(duplicate.outcome, 'NO_PROGRESS');
  const index = readFeedbackSession(s.feedbackId, options(f));
  assert.ok(index.attempts[0].hypothesisFingerprint); assert.equal(index.outcome, 'NO_PROGRESS');
});
