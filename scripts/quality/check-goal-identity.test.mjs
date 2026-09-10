import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { proveFixture } from './evidence-fixture.mjs';
import * as context from '../wayper-context.mjs';
import { recordContextEntry, refreshContextMap, validateContextMap } from '../wayper-context-map.mjs';
import { assertGoalExecution, captureRepositories, contextStatePath } from '../wayper-context-identity.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-goal-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ['a.js', 'b.js']) fs.writeFileSync(path.join(root, file), `export const value = '${file}';\n`);
  fs.writeFileSync(path.join(root, '.gitignore'), '.wayper-context/\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Wayper', '-c', 'user.email=wayper@example.test', 'commit', '-qm', 'fixture'], { cwd: root });
  return { root, repositories: [{ id: 'wayper', root, logicalRoot: '.' }],
    threadId: 'same-thread', taskClass: 'ARCHITECTURAL', objective: 'Goal A',
    specs: ['a.js', 'b.js'], requirements: ['SUCCESS:A', 'SUCCESS:stable'] };
}

function legacy() {
  return { schemaVersion: 1, goalId: 'same-thread', taskClass: 'BOUNDED',
    requirements: [{ kind: 'SUCCESS', id: 'A', status: 'SATISFIED', evidence: ['a.js:1'] }],
    artifacts: [{ spec: 'a.js', status: 'PROVEN', evidence: ['a.js:1'] }],
    contextDecision: 'STOP_WHEN_PROVEN' };
}

function mapFor(state, options) {
  return refreshContextMap(state.contextMap, { ...options, goalId: state.goalId, execution: state.execution,
    tokenCeiling: 16000, workingArtifacts: state.artifacts });
}

function proven(options) {
  let state = context.startWorkingContext(options);
  for (const artifact of options.specs) state = proveFixture(state, { artifact }, options);
  for (const requirement of options.requirements) state = proveFixture(state, { requirement }, options);
  state.contextMap = mapFor(state, options);
  state.contextMap = recordContextEntry(state.contextMap, 'evidence', { repository: 'wayper', path: 'a.js',
    claim: 'Goal A owner', category: 'OWNER', provenance: 'SOURCE', status: 'PROVEN' }, options.repositories);
  return state;
}

test('GI1 regression: thread-only refresh must reject inherited Goal A criteria/proof for Goal B', (t) => {
  const options = fixture(t);
  const a = legacy();
  a.artifacts[0] = { ...context.fingerprintArtifact(options.root, 'a.js'), ...a.artifacts[0] };
  // V1 clones A, appends B and preserves A as SATISFIED/KNOWN_GOOD_UNCHANGED.
  assert.throws(() => context.refreshWorkingContext({ ...options, existing: a,
    goalId: 'same-thread', requirements: ['SUCCESS:B'] }), /LEGACY|identity|explicit/i);
});

test('GI2 different Goals in one thread have separate requirements, evidence, proofs and Maps', (t) => {
  const options = fixture(t);
  const a = proven(options);
  const b = context.startWorkingContext({ ...options, objective: 'Goal B', requirements: ['SUCCESS:B'] });
  b.contextMap = mapFor(b, options);
  assert.notEqual(a.execution.identity.goalRunId, b.execution.identity.goalRunId);
  assert.equal(a.execution.identity.threadId, b.execution.identity.threadId);
  assert.deepEqual(b.requirements.map((item) => item.id), ['B']);
  assert.ok(b.artifacts.every((item) => !item.evidence.length && item.status === 'READ_REQUIRED'));
  assert.deepEqual(b.contextMap.evidence, []);
  assert.deepEqual(b.contextMap.knownGood, []);
  assert.notEqual(a.contextMap.goalId, b.contextMap.goalId);
  assert.throws(() => refreshContextMap(a.contextMap, { ...options, execution: b.execution, goalId: b.goalId }), /mismatch/i);
});

test('GI3 resume reuses the exact Goal/revision and immutable baseline', (t) => {
  const options = fixture(t);
  const a = proven(options);
  const resumed = context.refreshWorkingContext({ ...options, existing: a, identity: a.execution.identity });
  assert.deepEqual(resumed.execution, a.execution);
  assert.deepEqual(resumed.requirements, a.requirements);
  assert.ok(resumed.artifacts.every((item) => item.status === 'KNOWN_GOOD_UNCHANGED'));
  assert.deepEqual(resumed.contextMap.evidence, a.contextMap.evidence);
  assert.throws(() => context.refreshWorkingContext({ ...options, existing: a,
    identity: { ...a.execution.identity, revision: 2 } }), /mismatch/i);
  assert.throws(() => context.refreshWorkingContext({ ...options, existing: a,
    identity: a.execution.identity, objective: 'Different logical objective' }), /amendment or new Goal/);
});

test('GI4 amendment versions the Goal and invalidates only the declared affected slices', (t) => {
  const options = fixture(t);
  const a = proven(options);
  const before = structuredClone(a);
  const amended = context.amendWorkingContext({ ...options, existing: a, identity: a.execution.identity,
    changes: { requirements: { remove: ['SUCCESS:A'], add: ['SUCCESS:A2'] } },
    invalidate: { artifacts: ['a.js'], requirements: ['SUCCESS:A'], evidence: [a.contextMap.evidence[0].id],
      validations: [], capabilities: [], graphify: [] }, reason: 'A now requires the revised behavior' });
  assert.deepEqual(a, before);
  assert.equal(amended.execution.identity.goalRunId, a.execution.identity.goalRunId);
  assert.equal(amended.execution.identity.revision, 2);
  assert.deepEqual(amended.revisionHistory[0], a.execution);
  assert.equal(amended.requirements.find((item) => item.id === 'stable').status, 'REVALIDATION_REQUIRED');
  assert.equal(amended.requirements.find((item) => item.id === 'A2').status, 'PENDING');
  assert.equal(amended.artifacts.find((item) => item.spec === 'b.js').status, 'REUSE_BEFORE_READ');
  assert.equal(amended.artifacts.find((item) => item.spec === 'a.js').status, 'DIFF_BEFORE_FILE');
  assert.equal(amended.contextMap.evidence[0].status, 'STALE');
  assert.equal(amended.contextMap.goalId, amended.goalId);
  assert.equal(validateContextMap(amended.contextMap, { repositoryDefinitions: options.repositories }).status, 'VALID');
  assert.throws(() => context.amendWorkingContext({ ...options, existing: amended, identity: amended.execution.identity,
    changes: {}, reason: 'copy only' }), /NO_MATERIAL_AMENDMENT/);
});

test('GI5 a new Goal after completion cannot inherit the completed proof state', (t) => {
  const options = fixture(t);
  const a = proven(options);
  delete a.contextMap; // Native completion has no separate persisted bit in V1 or V2.
  assert.equal(context.contextDecision(a, options), 'STOP_WHEN_PROVEN');
  const b = context.startWorkingContext(options); // Even identical text is an explicit new execution.
  assert.notEqual(a.execution.identity.goalRunId, b.execution.identity.goalRunId);
  assert.equal(context.contextDecision(b, options), 'CONTINUE_CONTEXT');
  assert.ok(b.requirements.every((item) => item.status === 'PENDING'));
});

test('GI6 baseline stays historical while incompatible repository state requires revalidation', (t) => {
  const options = fixture(t);
  const a = proven(options);
  const baseline = structuredClone(a.execution.baseline);
  execFileSync('git', ['checkout', '-qb', 'other-branch'], { cwd: options.root });
  const changed = context.refreshWorkingContext({ ...options, existing: a, identity: a.execution.identity });
  assert.deepEqual(changed.execution.baseline, baseline);
  assert.ok(changed.artifacts.every((item) => item.status === 'DIFF_BEFORE_FILE'));
  assert.ok(changed.requirements.every((item) => item.status === 'PENDING'));
  assert.equal(changed.contextMap.evidence[0].status, 'STALE');
  assert.notEqual(changed.currentRepositories[0].branch, baseline.repositories[0].branch);
});

test('GI7 legacy is inspectable, never promoted, and its persisted bytes are preserved', (t) => {
  const options = fixture(t);
  const file = path.join(options.root, '.wayper-context', 'same-thread.md');
  fs.mkdirSync(path.dirname(file));
  const original = context.renderWorkingContext(legacy());
  fs.writeFileSync(file, original);
  const old = context.parseWorkingContext(fs.readFileSync(file, 'utf8'));
  assert.equal(old.schemaVersion, 1);
  assert.equal(context.contextDecision(old), 'REVALIDATION_REQUIRED');
  assert.throws(() => context.proveWorkingContext(old, { requirement: 'SUCCESS:A', evidence: 'node --test PASS' }), /LEGACY/);
  const fresh = context.startWorkingContext(options);
  assert.ok(fresh.requirements.every((item) => item.status === 'PENDING'));
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('GI8 baseline fingerprints track index, binary untracked content and immutable revision history', (t) => {
  const options = fixture(t);
  const a = proven(options);
  const initial = structuredClone(a.execution.baseline);
  fs.writeFileSync(path.join(options.root, 'binary.bin'), Buffer.from([0, 255, 1]));
  const first = captureRepositories(options.repositories);
  fs.writeFileSync(path.join(options.root, 'binary.bin'), Buffer.from([0, 254, 1]));
  const second = captureRepositories(options.repositories);
  assert.equal(first[0].dirty, true);
  assert.notEqual(first[0].contentFingerprint, second[0].contentFingerprint);
  execFileSync('git', ['add', 'binary.bin'], { cwd: options.root });
  const staged = captureRepositories(options.repositories);
  assert.notEqual(staged[0].contentFingerprint, second[0].contentFingerprint);
  const amended = context.amendWorkingContext({ ...options, existing: a, identity: a.execution.identity,
    changes: { objective: 'Goal A with expanded constraints' }, reason: 'Material objective expansion' });
  assert.deepEqual(amended.revisionHistory[0].baseline, initial);
  assert.notDeepEqual(amended.execution.baseline, initial);
  assert.equal(amended.execution.baseline.repositories[0].dirty, true);
  const tampered = structuredClone(amended.execution);
  tampered.baseline.repositories[0].head = '0'.repeat(40);
  assert.throws(() => assertGoalExecution(tampered), /baseline/);
  assert.throws(() => refreshContextMap(amended.contextMap, { ...options, goalId: amended.goalId,
    execution: a.execution }), /mismatch/i);
});

test('GI9 default amendment invalidation follows evidence edges, checks, gaps and known-good', (t) => {
  const options = fixture(t);
  const a = proven(options);
  const evidenceId = a.contextMap.evidence[0].id;
  for (const [kind, input] of [
    ['dependency', { from: { repository: 'wayper', ref: 'a.js' }, to: { repository: 'wayper', ref: 'b.js' },
      relation: 'CALLS', provenance: 'SOURCE', evidenceIds: [evidenceId] }],
    ['validation', { id: 'check-A', status: 'PASS', evidence: 'node --test PASS' }],
    ['known-good', { repository: 'wayper', artifact: 'a.js', proofRefs: [evidenceId] }],
    ['proof-gap', { claim: 'A behavior', reason: 'Needs proof', requiredEvidence: 'A owner',
      status: 'RESOLVED', evidenceIds: [evidenceId] }],
  ]) a.contextMap = recordContextEntry(a.contextMap, kind, input, options.repositories);
  const amended = context.amendWorkingContext({ ...options, existing: a, identity: a.execution.identity,
    changes: { objective: 'Goal A with different behavior' }, reason: 'Material definition change' });
  assert.equal(amended.execution.identity.revision, 2);
  assert.ok(amended.requirements.every((item) => item.status === 'PENDING'));
  assert.deepEqual(amended.contextMap.dependencies, []);
  assert.equal(amended.contextMap.validation.checks[0].status, 'NOT_RUN');
  assert.equal(amended.contextMap.knownGood[0].status, 'STALE');
  assert.equal(amended.contextMap.proofGaps[0].status, 'OPEN');
  assert.equal(validateContextMap(amended.contextMap, { repositoryDefinitions: options.repositories }).status, 'VALID');
});

test('GI10 cross-repo baselines and incompatible site state never replace mobile state', (t) => {
  const options = fixture(t);
  const site = fixture(t);
  options.repositories.push({ id: 'wayper-site', root: site.root, logicalRoot: '../wayper-site' });
  options.specs = ['a.js', 'wayper-site:a.js'];
  const a = proven(options);
  assert.deepEqual(a.execution.baseline.repositories.map((repo) => repo.repositoryId), ['wayper', 'wayper-site']);
  assert.notEqual(...a.execution.baseline.repositories.map((repo) => repo.checkoutFingerprint));
  execFileSync('git', ['checkout', '-qb', 'site-revision'], { cwd: site.root });
  const resumed = context.refreshWorkingContext({ ...options, existing: a, identity: a.execution.identity });
  assert.equal(resumed.artifacts.find((item) => item.repository === 'wayper').status, 'KNOWN_GOOD_UNCHANGED');
  assert.equal(resumed.artifacts.find((item) => item.repository === 'wayper-site').status, 'DIFF_BEFORE_FILE');
  assert.equal(resumed.contextMap.evidence[0].status, 'PROVEN');
  assert.deepEqual(resumed.execution.baseline, a.execution.baseline);
});

test('GI11 canonical CLI separates starts, resumes, revisions, legacy inspection and atomic files', (t) => {
  const threadId = `identity-cli-${process.pid}`;
  const run = (command, args) => spawnSync(process.execPath, [path.join(context.ROOT, 'scripts/wayper-context.mjs'),
    command, ...args], { encoding: 'utf8' });
  const start = () => {
    const result = run('start', ['--thread-id', threadId, '--objective', 'CLI identity contract', '--class', 'BOUNDED',
      '--track', 'AGENTS.md', '--requirement', 'SUCCESS:isolated']);
    assert.equal(result.status, 0, result.stderr);
    const goalRunId = result.stdout.match(/GOAL_RUN_ID (\S+)/)[1];
    const file = contextStatePath(context.ROOT, goalRunId);
    t.after(() => fs.rmSync(file, { force: true }));
    return { file, goalRunId, selector: ['--thread-id', threadId, '--goal-run-id', goalRunId, '--revision', '1'] };
  };
  const a = start(); const b = start();
  assert.notEqual(a.goalRunId, b.goalRunId);
  assert.equal(run('refresh', a.selector).status, 0);
  assert.equal(run('validate', a.selector).status, 0);
  const before = context.parseWorkingContext(fs.readFileSync(a.file, 'utf8'));
  const amendment = run('amend', [...a.selector, '--changes', JSON.stringify({ requirements: { add: ['SUCCESS:revision'] } }),
    '--reason', 'New required outcome']);
  assert.equal(amendment.status, 0, amendment.stderr);
  const after = context.parseWorkingContext(fs.readFileSync(a.file, 'utf8'));
  assert.equal(after.execution.identity.revision, 2);
  assert.deepEqual(after.revisionHistory[0], before.execution);
  const bytes = fs.readFileSync(a.file, 'utf8');
  assert.equal(run('refresh', a.selector).status, 2);
  assert.equal(fs.readFileSync(a.file, 'utf8'), bytes);
  const revisedSelector = [...a.selector.slice(0, -1), '2'];
  assert.equal(run('validate', revisedSelector).status, 0);
  const legacyFile = path.join(context.ROOT, '.wayper-context', `${threadId}.md`);
  const original = context.renderWorkingContext(legacy());
  fs.writeFileSync(legacyFile, original, { flag: 'wx' });
  t.after(() => fs.rmSync(legacyFile, { force: true }));
  assert.match(run('inspect', ['--goal-id', threadId]).stdout, /LEGACY_UNVERIFIED/);
  assert.equal(run('refresh', ['--goal-id', threadId]).status, 2);
  assert.equal(run('validate', ['--goal-id', threadId]).status, 1);
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), original);
  assert.ok(!fs.readdirSync(path.dirname(a.file)).some((file) => file.startsWith(a.goalRunId) && file.endsWith('.tmp')));
  assert.throws(() => contextStatePath(context.ROOT, '../outside'), /goal-run-id/);
});

test('GI12 removing a declared check preserves its stale proof references for inspection', (t) => {
  const options = { ...fixture(t), validations: ['check-A'] };
  const a = proven(options);
  a.contextMap = recordContextEntry(a.contextMap, 'validation', { id: 'check-A', status: 'PASS',
    evidence: 'node --test PASS' }, options.repositories);
  a.contextMap = recordContextEntry(a.contextMap, 'known-good', { repository: 'wayper', artifact: 'a.js',
    proofRefs: ['check-A'] }, options.repositories);
  const amended = context.amendWorkingContext({ ...options, existing: a, identity: a.execution.identity,
    changes: { validations: [] }, reason: 'Check retired by the changed contract' });
  const validation = validateContextMap(amended.contextMap, { repositoryDefinitions: options.repositories });
  assert.equal(validation.status, 'VALID', validation.errors.join('; '));
  assert.equal(amended.contextMap.knownGood[0].status, 'STALE');
  assert.equal(amended.contextMap.validation.checks[0].status, 'NOT_RUN');
});

test('GI13 reordering definition sets and whitespace-only objective edits do not create revisions', (t) => {
  const options = { ...fixture(t), riskFlags: ['BUILD_TOOLING', 'DOCUMENTATION'] };
  const state = context.startWorkingContext(options);
  assert.throws(() => context.amendWorkingContext({ ...options, existing: state, identity: state.execution.identity,
    changes: { riskFlags: ['DOCUMENTATION', 'BUILD_TOOLING'], objective: `  ${state.objective}  ` },
    reason: 'Metadata ordering only' }), /NO_MATERIAL_AMENDMENT/);
});
