import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { startWorkingContext, proveWorkingContext } from '../wayper-context.mjs';
import { evaluateCompletion, loadEvalSuite } from './check-meta-goal-completion.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.gitignore'), '.wayper-context/\n');
  fs.writeFileSync(path.join(root, 'owner.js'), 'export const owner = true;\n');
  fs.writeFileSync(path.join(root, 'pass.test.mjs'), "import assert from 'node:assert/strict'; assert.equal(1, 1);\n");
  fs.writeFileSync(path.join(root, 'fail.test.mjs'), "import assert from 'node:assert/strict'; assert.equal(1, 2);\n");
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  const repositories = [{ id: 'wayper', root, logicalRoot: '.' }];
  const state = startWorkingContext({ root, repositories, threadId: 'receipt-tests', objective: 'receipt tests',
    taskClass: 'ARCHITECTURAL', specs: ['owner.js'], requirements: ['TEST:unit'] });
  return { root, repositories, state, execution: state.execution };
}

for (const [id, evidence] of [['ER1', 'FAIL not validated'], ['ER2', 'all tests passed'],
  ['ER1b', 'PASS'], ['ER1c', 'verified']]) {
  test(`${id} raw text cannot prove a machine requirement`, (t) => {
    const { state } = fixture(t);
    assert.throws(() => proveWorkingContext(state, { requirement: 'TEST:unit', evidence }));
  });
}

test('ER2b Meta evaluator rejects friendly nonempty references', () => {
  const { baseRun } = loadEvalSuite();
  assert.equal(evaluateCompletion(baseRun).eligible, false);
});

const api = () => import('../wayper-evidence-receipts.mjs');
const observer = () => import('../wayper-evidence-observer.mjs');
const store = () => import('../wayper-evidence-store.mjs');
const source = async (f, extra = {}) => (await observer()).observeFile({ ...f, repository: 'wayper',
  path: 'owner.js', ...extra });
const runTest = async (f, fail = false) => (await observer()).runObservedTest({ mutability: 'READ_ONLY', ...f, repository: 'wayper',
  command: process.execPath, args: ['--test', fail ? 'fail.test.mjs' : 'pass.test.mjs'], target: 'unit' });

for (const [id, mutation, reason] of [
  ['ER3', (f, other) => ({ ...f, execution: other.execution }), 'WRONG_GOAL'],
  ['ER4', (f) => ({ ...f, execution: { ...f.execution,
    identity: { ...f.execution.identity, revision: 2 } } }), 'WRONG_REVISION'],
  ['ER5', (f, other) => ({ ...f, execution: { ...f.execution, baseline: other.execution.baseline } }), 'WRONG_BASELINE'],
]) test(`${id} receipt cannot cross execution identity`, async (t) => {
  const f = fixture(t); const receipt = await source(f); const other = fixture(t);
  const validation = (await store()).validateReceipt(receipt, mutation(f, other));
  assert.ok(validation.reasons.includes(reason), JSON.stringify(validation));
});

test('ER6 tampering and closed schema are rejected', async (t) => {
  const f = fixture(t); const receipt = await source(f); const { validateReceipt } = await store();
  const changed = structuredClone(receipt); changed.subject.path = 'pass.test.mjs';
  assert.ok(validateReceipt(changed, f).reasons.includes('INVALID_FINGERPRINT'));
  const { validateReceiptSchema } = await api();
  assert.equal(validateReceiptSchema({ ...receipt, extra: true }).status, 'INVALID_SCHEMA');
  assert.equal(validateReceiptSchema({ ...receipt, metadata: { unknown: true } }).status, 'INVALID_SCHEMA');
});

test('ER7 failed command remains observed FAIL', async (t) => {
  const f = fixture(t); const { runObservedCommand } = await observer();
  const receipt = await runObservedCommand({ mutability: 'READ_ONLY', ...f, repository: 'wayper', command: process.execPath,
    args: ['-e', 'process.exit(7)'], target: 'unit' });
  assert.equal(receipt.result, 'FAIL'); assert.equal(receipt.observation.exitCode, 7);
  const { validateReceipt, evaluateEvidenceRequirement } = await store();
  assert.equal(validateReceipt(receipt, f).status, 'VALID');
  assert.equal(evaluateEvidenceRequirement({ kinds: ['COMMAND'], repository: 'wayper', target: 'unit',
    result: 'PASS' }, [receipt.receiptId], f).status, 'UNSATISFIED');
});

test('ER8 failing test cannot satisfy PASS and has observed parent', async (t) => {
  const f = fixture(t); const { receipt, commandReceipt } = await runTest(f, true);
  assert.equal(receipt.result, 'FAIL'); assert.deepEqual(receipt.parentReceiptIds, [commandReceipt.receiptId]);
  assert.throws(() => proveWorkingContext(f.state, { requirement: 'TEST:unit', evidence: receipt.receiptId }, f));
});

test('ER9 actual passing test satisfies its compatible requirement only', async (t) => {
  const f = fixture(t); const { receipt } = await runTest(f);
  assert.equal(receipt.result, 'PASS'); assert.ok(receipt.observation.counts.passed > 0);
  const proven = proveWorkingContext(f.state, { requirement: 'TEST:unit', evidence: receipt.receiptId }, f);
  assert.equal(proven.requirements[0].status, 'SATISFIED');
  const { evaluateEvidenceRequirement } = await store();
  assert.equal(evaluateEvidenceRequirement({ kinds: ['TEST'], repository: 'wayper', target: 'another-suite',
    result: 'PASS' }, [receipt.receiptId], f).status, 'UNSATISFIED');
});

test('ER10 changed source is stale without rewriting receipt', async (t) => {
  const f = fixture(t); const receipt = await source(f); const original = JSON.stringify(receipt);
  fs.appendFileSync(path.join(f.root, 'owner.js'), '// changed\n');
  assert.equal((await store()).validateReceipt(receipt, f).status, 'STALE');
  assert.equal(JSON.stringify((await store()).readReceipt(receipt.receiptId, f)), original);
});

test('ER13 legacy proofs stay readable but cannot stop', async (t) => {
  const f = fixture(t); const { parseWorkingContext, renderWorkingContext, contextDecision } =
    await import('../wayper-context.mjs');
  for (const schemaVersion of [1, 2]) {
    const old = { ...f.state, schemaVersion, requirements: [{ kind: 'TEST', id: 'unit',
      status: 'SATISFIED', evidence: ['all tests passed'] }], artifacts: [{ ...f.state.artifacts[0],
      status: 'PROVEN', evidence: ['owner.js:1'] }] };
    const read = parseWorkingContext(renderWorkingContext(old));
    assert.notEqual(contextDecision(read, f), 'STOP_WHEN_PROVEN');
    assert.equal(read.requirements[0].verification, 'LEGACY_UNVERIFIED');
    assert.deepEqual(read.requirements[0].evidence, ['all tests passed']);
  }
});

test('ER14 persisted execution with sensitive arguments/output contains no raw secret', async (t) => {
  const f = fixture(t); const sensitive = 'fixture-secret-987654321';
  const receipt = await (await observer()).runObservedCommand({ mutability: 'READ_ONLY', ...f, repository: 'wayper',
    command: process.execPath, args: ['-e', `console.log('Authorization: Bearer ${sensitive}'); console.error('password=${sensitive}')`],
    target: 'redaction' });
  const persisted = JSON.stringify((await store()).readReceipt(receipt.receiptId, f));
  assert.ok(!persisted.includes(sensitive)); assert.ok(!persisted.includes('console.log'));
  assert.equal(receipt.observation.outputPolicy, 'HASH_ONLY');
  const { redactEvidenceText } = await api();
  for (const text of [`password=${sensitive}`, `Authorization: Bearer ${sensitive}`,
    `token: ${sensitive}`, `-----BEGIN PRIVATE KEY-----\n${sensitive}\n-----END PRIVATE KEY-----`]) {
    assert.ok(!redactEvidenceText(text).includes(sensitive));
  }
});

test('ER15 copied receipt is not issued in a different run; repeated execution has a new ID', async (t) => {
  const f = fixture(t); const other = fixture(t); const first = await runTest(f); const second = await runTest(f);
  assert.notEqual(first.receipt.receiptId, second.receipt.receiptId);
  assert.notEqual(first.commandReceipt.observation.executionId, second.commandReceipt.observation.executionId);
  const { validateReceipt, listReceipts } = await store();
  assert.equal(validateReceipt(first.receipt, other).status, 'INVALID');
  assert.equal(listReceipts(f).length, 4);
});

test('canonical receipt IDs, missing parent and unrecorded fabrication', async (t) => {
  const f = fixture(t); const { receipt, commandReceipt } = await runTest(f);
  const { sealReceipt } = await api();
  const reversed = Object.fromEntries(Object.entries(receipt).reverse());
  assert.deepEqual(sealReceipt(reversed), receipt);
  const { validateReceipt, receiptPath } = await store();
  const fabricated = sealReceipt({ ...receipt, producedAt: '2026-09-01T00:00:00.000Z' });
  assert.ok(validateReceipt(fabricated, f).reasons.includes('UNRECORDED_RECEIPT'));
  fs.unlinkSync(receiptPath(commandReceipt.receiptId, f));
  assert.ok(validateReceipt(receipt, f).reasons.includes('MISSING_PARENT'));
});

test('asserted TEST, RUNTIME, REVIEW and human decision cannot be upgraded to material proof', async (t) => {
  const f = fixture(t); const { recordAssertion } = await observer();
  const { evaluateEvidenceRequirement } = await store();
  for (const kind of ['TEST', 'RUNTIME', 'REVIEW', 'HUMAN_DECISION']) {
    const receipt = recordAssertion({ ...f, repository: 'wayper', kind, target: 'unit',
      origin: kind === 'HUMAN_DECISION' ? 'HUMAN_ASSERTED' : 'HANDOFF_ASSERTED',
      summary: 'all tests passed', environment: kind === 'RUNTIME' ? 'android physical' : null });
    const result = evaluateEvidenceRequirement({ kinds: [kind], repository: 'wayper', target: 'unit',
      result: 'PASS' }, [receipt.receiptId], f);
    assert.equal(result.status, 'UNSATISFIED');
    assert.equal(result.receipts[0].verification, 'UNVERIFIED');
  }
});

async function mapFixture(f) {
  const { refreshContextMap, integrateRouterOutput, recordContextEntry } = await import('../wayper-context-map.mjs');
  const { loadCapabilityFiles } = await import('./check-capability-routing.mjs');
  const { routeTask } = await import('../wayper-agent-router.mjs');
  const { goalReference } = await import('../wayper-context-identity.mjs');
  const { registry } = loadCapabilityFiles();
  const options = { ...f, goalId: goalReference(f.execution.identity), registry,
    taskClass: 'ARCHITECTURAL', tokenCeiling: 16_000 };
  let map = refreshContextMap(null, options);
  const routerOutput = routeTask({ schemaVersion: 1, goalId: options.goalId, operation: 'EVIDENCE_TEST',
    repositories: f.repositories.map((repo) => repo.id), changedFiles: [], candidatePaths: [], riskFlags: [],
    knownCapabilities: ['territory-capture'], knownGoodCapabilities: [], capabilityAssessmentComplete: true,
    structuralUncertainty: false, signals: [] }, registry);
  map = integrateRouterOutput(map, routerOutput, options);
  map = recordContextEntry(map, 'evidence', { repository: 'wayper', path: 'owner.js', claim: 'owner content',
    provenance: 'SOURCE', status: 'PROVEN', capabilityRefs: ['territory-capture'] }, f.repositories, options);
  return { map, options, registry, routerOutput };
}

test('ER11 mobile Packet excludes site-only receipts and rejects injected ref', async (t) => {
  const f = fixture(t); const site = fixture(t);
  f.repositories.push({ id: 'wayper-site', root: site.root, logicalRoot: site.root });
  const { createGoalExecution } = await import('../wayper-context-identity.mjs');
  f.execution = createGoalExecution({ threadId: 'cross-repo', repositories: f.repositories });
  const { map: initial, options, registry, routerOutput } = await mapFixture(f);
  const { recordContextEntry } = await import('../wayper-context-map.mjs');
  const { buildContextPacket, validateContextPacket } = await import('../wayper-context-packet.mjs');
  const siteReceipt = await source(f, { repository: 'wayper-site' });
  const map = recordContextEntry(initial, 'receipt', { receiptId: siteReceipt.receiptId }, f.repositories, options);
  const packet = buildContextPacket(map, { type: 'agentProfile', id: 'wayper_geospatial_reviewer',
    objective: 'review owner', paths: ['wayper:owner.js'] }, { registry, routerOutput });
  assert.ok(!packet.evidenceReceiptIds.includes(siteReceipt.receiptId));
  assert.equal(validateContextPacket(packet, { contextMap: map, registry, repositoryDefinitions: f.repositories }).status, 'VALID');
  packet.evidenceReceiptIds.push(siteReceipt.receiptId);
  assert.equal(validateContextPacket(packet, { contextMap: map, registry, repositoryDefinitions: f.repositories }).status, 'INVALID');
});

test('ER12 Handoff test assertion remains HANDOFF_ASSERTED and unverified', async (t) => {
  const f = fixture(t); const { map, registry, routerOutput } = await mapFixture(f);
  const { buildContextPacket } = await import('../wayper-context-packet.mjs');
  const { buildStructuredHandoff, planContextMapMerge } = await import('../wayper-structured-handoff.mjs');
  const packet = buildContextPacket(map, { type: 'agentProfile', id: 'wayper_geospatial_reviewer',
    objective: 'review owner', paths: ['wayper:owner.js'] }, { registry, routerOutput });
  const handoff = buildStructuredHandoff({ schemaVersion: 1, goalId: map.goalId, taskId: 'review-1',
    agentId: packet.target.id, packetId: packet.packetId, status: 'NO_FINDINGS', confidence: 0.9,
    coverage: packet.capabilities.required, findings: [], evidenceRefs: [], newEvidence: [], risks: [],
    recommendations: [], filesRead: [], filesChanged: [], tests: [{ command: 'node --test', status: 'PASS',
      summary: 'all tests passed', evidenceRefs: [] }], proofGaps: [], ambiguities: [], blockers: [] }, { packet });
  const plan = planContextMapMerge(handoff, { packet, contextMap: map, registry, taskId: 'review-1',
    agentId: packet.target.id, repositoryDefinitions: f.repositories });
  assert.equal(plan.candidateEvidence[0].origin, 'HANDOFF_ASSERTED');
  assert.equal(plan.candidateEvidence[0].verification, 'UNVERIFIED');
  assert.equal(plan.ownerAction, 'CONTEXT_MAP_OWNER_REVIEW_REQUIRED');
});

test('Map indexes receipt metadata and makes stale state visible on refresh', async (t) => {
  const f = fixture(t); const { map: initial, options, registry } = await mapFixture(f);
  const { recordContextEntry, refreshContextMap, validateContextMap } = await import('../wayper-context-map.mjs');
  const receipt = await source(f);
  let map = recordContextEntry(initial, 'receipt', { receiptId: receipt.receiptId }, f.repositories, options);
  assert.equal(map.evidenceReceipts.find((entry) => entry.receiptId === receipt.receiptId).verification, 'VERIFIED');
  fs.appendFileSync(path.join(f.root, 'owner.js'), '// stale\n');
  assert.equal(validateContextMap(map, { repositoryDefinitions: f.repositories, registry }).status, 'INVALID');
  map = refreshContextMap(map, options);
  assert.equal(map.evidenceReceipts.find((entry) => entry.receiptId === receipt.receiptId).verification, 'STALE');
});

test('Evidence Receipt behavioral evals: happy path and adversarial inputs', async (t) => {
  const suite = JSON.parse(fs.readFileSync(new URL('../../docs/ai/evidence-receipt-evals.json', import.meta.url)));
  assert.deepEqual(Object.keys(suite).sort(), ['cases', 'schemaVersion']);
  assert.equal(suite.schemaVersion, 1); assert.equal(suite.cases.length, 12);
  assert.equal(new Set(suite.cases.map((item) => item.id)).size, suite.cases.length);
  const { evaluateEvidenceRequirement } = await store();
  for (const item of suite.cases) {
    const f = fixture(t); let context = f;
    const policy = { kinds: ['TEST'], repository: 'wayper', target: 'unit', result: 'PASS' };
    let id;
    if (item.action === 'text') id = item.value;
    else if (item.action === 'handoffAssertion') id = (await observer()).recordAssertion({ ...f,
      repository: 'wayper', kind: 'TEST', origin: 'HANDOFF_ASSERTED', target: 'unit', summary: 'all tests passed' }).receiptId;
    else if (item.action === 'failedCommand') {
      policy.kinds = ['COMMAND'];
      id = (await (await observer()).runObservedCommand({ mutability: 'READ_ONLY', ...f, repository: 'wayper', command: process.execPath,
        args: ['-e', 'process.exit(9)'], target: 'unit' })).receiptId;
    } else {
      assert.ok(['pass', 'wrongGoal', 'wrongBaseline', 'stale', 'failedTest', 'wrongRepository', 'wrongTarget'].includes(item.action));
      id = (await runTest(f, item.action === 'failedTest')).receipt.receiptId;
      if (item.action === 'wrongGoal') context = { ...f, execution: fixture(t).execution };
      if (item.action === 'wrongBaseline') context = { ...f, execution: { ...f.execution, baseline: fixture(t).execution.baseline } };
      if (item.action === 'stale') fs.appendFileSync(path.join(f.root, 'owner.js'), '// stale\n');
      if (item.action === 'wrongRepository') policy.repository = 'wayper-site';
      if (item.action === 'wrongTarget') policy.target = 'unexecuted';
    }
    assert.equal(evaluateEvidenceRequirement(policy, [id], context).status, item.expected, item.id);
  }
});

test('runner errors, timeout and changes during execution cannot become passing current proof', async (t) => {
  const f = fixture(t); const { runObservedCommand } = await observer(); const { validateReceipt } = await store();
  const missing = await runObservedCommand({ mutability: 'READ_ONLY', ...f, repository: 'wayper', command: path.join(f.root, 'missing'), target: 'missing' });
  assert.equal(missing.result, 'FAIL'); assert.equal(missing.observation.exitCode, null);
  const timed = await runObservedCommand({ mutability: 'READ_ONLY', ...f, repository: 'wayper', command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 100, target: 'timeout' });
  assert.equal(timed.result, 'FAIL'); assert.equal(timed.observation.signal, 'SIGKILL');
  let mutated;
  await assert.rejects(() => runObservedCommand({ mutability: 'READ_ONLY', ...f, repository: 'wayper', command: process.execPath,
    args: ['-e', "require('fs').appendFileSync('owner.js', '// mutation')"], target: 'mutation' }), error => {
    mutated = error.receipt; return error.message === 'READ_ONLY_CONTRACT_VIOLATION';
  });
  assert.equal(mutated.result, 'PASS'); // V1 records exit zero; the separate boundary rejects the mutation.
  assert.equal(validateReceipt(mutated, f).status, 'STALE');
});

test('raw shell execution creates no receipt; secret paths, symlinks and origin upgrades are rejected', async (t) => {
  const f = fixture(t); const { observeFile, recordAssertion } = await observer(); const { listReceipts, receiptPath } = await store();
  execFileSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.deepEqual(listReceipts(f), []);
  assert.throws(() => observeFile({ ...f, repository: 'wayper', path: '.env' }), /Sensitive/);
  assert.throws(() => recordAssertion({ ...f, repository: 'wayper', kind: 'TEST', origin: 'RUNNER_OBSERVED', summary: 'PASS' }), /origin/);
  fs.symlinkSync(path.join(fixture(t).root, 'owner.js'), path.join(f.root, 'outside.js'));
  assert.throws(() => observeFile({ ...f, repository: 'wayper', path: 'outside.js' }), /escapes/);
  assert.throws(() => receiptPath('../outside', f), /reference/);
});

test('receipt-related schema, eval and producer changes select their gate', async () => {
  const { relevantQualityTests } = await import('./check-completion-backstop.mjs');
  for (const file of ['scripts/wayper-evidence-receipts.mjs', 'scripts/wayper-evidence-observer.mjs',
    'scripts/wayper-evidence-store.mjs', 'docs/ai/evidence-receipt-evals.json', 'package.json']) {
    assert.ok(relevantQualityTests([file]).includes('scripts/quality/check-evidence-receipts.test.mjs'), file);
  }
});

test('filename aliases, shortened ranges, forged verification and unrelated source do not prove tests', async (t) => {
  const f = fixture(t); const receipt = await source(f, { range: 'L1-L2' });
  const { readReceipt, receiptPath, validateReceipt, evaluateEvidenceRequirement } = await store();
  const alias = `ER-${'0'.repeat(64)}`;
  fs.copyFileSync(receiptPath(receipt.receiptId, f), receiptPath(alias, f));
  assert.throws(() => readReceipt(alias, f), /ID/);
  assert.equal(evaluateEvidenceRequirement({ kinds: ['TEST'], repository: 'wayper', target: 'unit', result: 'PASS' },
    [receipt.receiptId], f).status, 'UNSATISFIED');
  fs.writeFileSync(path.join(f.root, 'owner.js'), 'short');
  assert.equal(validateReceipt(receipt, f).status, 'STALE');
  assert.equal((await api()).validateReceiptSchema({ ...receipt, verification: 'VERIFIED' }).status, 'INVALID_SCHEMA');
});

test('DOCUMENT, GRAPH and reserved feedback metadata preserve provenance without promoting claims', async (t) => {
  const f = fixture(t); const { observeFile, recordGraphReference } = await observer();
  const { evidenceHash } = await api(); const { validateReceipt, inspectEvidenceRequirements } = await store();
  fs.mkdirSync(path.join(f.root, 'graphify-out'));
  fs.writeFileSync(path.join(f.root, 'graphify-out', 'graph.json'), '{"nodes":[],"edges":[]}');
  const graph = recordGraphReference({ ...f, repository: 'wayper', target: 'query', query: 'owner', queryResult: [],
    corpusFingerprint: evidenceHash('stale corpus') });
  assert.equal(graph.observation.freshness, 'STALE'); assert.equal(validateReceipt(graph, f).status, 'STALE');
  const document = observeFile({ ...f, repository: 'wayper', path: 'owner.js', kind: 'DOCUMENT',
    metadata: { taskId: 'task-1', attemptId: 'attempt-1', failureId: 'failure-1' } });
  const report = inspectEvidenceRequirements([{ kinds: ['DOCUMENT'], repository: 'wayper', path: 'owner.js',
    result: 'OBSERVED' }], f);
  assert.equal(report.requirements[0].status, 'SATISFIED');
  assert.deepEqual(document.metadata, { taskId: 'task-1', attemptId: 'attempt-1', failureId: 'failure-1' });
  assert.equal(report.inventory.filter((entry) => entry.kind === 'GRAPH')[0].verification, 'STALE');
});

test('SOURCE fingerprints raw bytes and range aliases compare consistently', async (t) => {
  const f = fixture(t); const { observeFile } = await observer(); const { validateReceipt, evaluateEvidenceRequirement } = await store();
  fs.writeFileSync(path.join(f.root, 'binary.bin'), Buffer.from([0xff]));
  const binary = observeFile({ ...f, repository: 'wayper', path: 'binary.bin' });
  fs.writeFileSync(path.join(f.root, 'binary.bin'), Buffer.from([0xfe]));
  assert.equal(validateReceipt(binary, f).status, 'STALE');
  const receipt = await source(f, { range: 'L1-L1' });
  assert.equal(evaluateEvidenceRequirement({ kinds: ['SOURCE'], repository: 'wayper', path: 'owner.js',
    range: 'L1', result: 'OBSERVED' }, [receipt.receiptId], f).status, 'SATISFIED');
});

test('future acceptance policies are closed and missing evidence is explicit', async (t) => {
  const f = fixture(t); const { validateEvidenceRequirement } = await api(); const { evaluateEvidenceRequirement } = await store();
  const policy = { kinds: ['TEST'], repository: 'wayper', target: 'unit', result: 'PASS' };
  assert.equal(validateEvidenceRequirement(policy).status, 'VALID');
  for (const changed of [{ ...policy, trusted: true }, { ...policy, kinds: [] }, { ...policy, target: '' },
    { ...policy, range: 'L0' }, { ...policy, fingerprint: 'verified' }]) {
    assert.equal(validateEvidenceRequirement(changed).status, 'INVALID_REQUIREMENT');
  }
  assert.deepEqual(evaluateEvidenceRequirement(policy, [], f).reasons, ['MISSING_RECEIPT']);
});
