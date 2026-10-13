import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { createGoalExecution, contextStatePath } from '../wayper-context-identity.mjs';
import { evidenceHash } from '../wayper-evidence-receipts.mjs';
import { beginAndroidObservation, loadAndroidProfile } from '../wayper-evidence-android.mjs';
import { observeAndroidArtifacts, recordAssertion, runObservedCommand } from '../wayper-evidence-observer.mjs';
import { validateReceipt, evaluateEvidenceRequirement } from '../wayper-evidence-store.mjs';
import { buildValidationPlan, evaluateValidationPlan } from '../wayper-validation-planner.mjs';
import { startWorkingContext, amendWorkingContext, proveWorkingContext, renderWorkingContext } from '../wayper-context.mjs';
import { recordContextEntry, refreshContextMap } from '../wayper-context-map.mjs';
import { loadCapabilityFiles } from './check-capability-routing.mjs';
import { assessGoalCompletion } from '../wayper-completion-boundary.mjs';

// Fake ADB is test infrastructure, never a receipt for a real device or a production Goal.
function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-android-evidence-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-fake-adb-'));
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  t.after(() => { process.env.PATH = originalPath; fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, '.gitignore'), '.wayper-context/\n');
  fs.writeFileSync(path.join(root, 'owner.js'), 'export const owner = true;\n');
  const profile = { schemaVersion: 1, package: 'com.wayper.app', apkFingerprint: evidenceHash('fixture APK'),
    sourceSubjects: [{ path: 'owner.js', fingerprint: evidenceHash('export const owner = true;\n') }],
    steps: [{ id: 'diagnosis', args: ['exec-out', 'run-as', 'com.wayper.app', 'cat', 'files/diagnosis.json'], checks: [
      { type: 'JSON_EQUALS', pointer: ['status'], expected: 'IDLE' },
      { type: 'JSON_TIMESTAMP_IN_WINDOW', pointer: ['at'], expected: null },
    ] }] };
  fs.writeFileSync(path.join(root, 'profile.json'), JSON.stringify(profile));
  const androidProfile = { path: 'profile.json', fingerprint: evidenceHash(JSON.stringify(profile)) };
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  fs.writeFileSync(path.join(bin, 'adb'), `#!/usr/bin/env node
const args = process.argv.slice(4); const config = ${JSON.stringify(overrides)};
let output;
if(args[0] === 'get-state') output = 'device';
else if(args.includes('ro.product.model')) output = 'Fixture';
else if(args.includes('ro.build.fingerprint')) output = 'Fixture/build';
else if(args.includes('ro.kernel.qemu')) output = config.emulator ?? '0';
else if(args[1] === 'dumpsys') output = 'Package [com.wayper.app] versionCode=1 versionName=fixture';
else if(args[1] === 'pm') output = 'package:/data/app/~~fixture/package==/base.apk';
else if(args[1] === 'cat') output = config.apk ?? 'fixture APK';
else if(args[1] === 'run-as') output = config.events ? config.events.map(([event, localRunId]) => JSON.stringify({event, localRunId,
  wallTime: new Date().toISOString()})).join('\\n') : JSON.stringify({status: config.status ?? 'IDLE', at: config.at ?? new Date().toISOString()});
else process.exit(2);
process.stdout.write(output);
`, { mode: 0o700 });
  const repositories = [{ id: 'wayper', root, logicalRoot: '.' }];
  const execution = createGoalExecution({ threadId: 'android-fixture', repositories });
  return { root, repositories, execution, repository: 'wayper', serial: 'FIXTURE_SERIAL', androidProfile, target: 'physical' };
}
const capture = async (f) => observeAndroidArtifacts({ ...f, ...(await beginAndroidObservation(f)) });

test('Android capture verifies artifacts, commands, APK, timestamps and deterministic checks', async (t) => {
  const f = fixture(t); const receipt = await capture(f);
  assert.equal(receipt.result, 'PASS'); assert.equal(validateReceipt(receipt, f).status, 'VALID');
  const policy = { kinds: ['RUNTIME'], repository: 'wayper', result: 'PASS', target: f.target, androidProfile: f.androidProfile };
  assert.equal(evaluateEvidenceRequirement(policy, [receipt.receiptId], f).status, 'SATISFIED');
  const { androidProfile: omitted, ...unapproved } = policy;
  assert.equal(evaluateEvidenceRequirement(unapproved, [receipt.receiptId], f).status, 'UNSATISFIED');
  assert.equal(evaluateEvidenceRequirement({ ...policy, androidProfile: { ...f.androidProfile, fingerprint: evidenceHash('another profile') } }, [receipt.receiptId], f).status, 'UNSATISFIED');
  const reused = await observeAndroidArtifacts({ ...f, bundlePath: receipt.observation.bundlePath });
  assert.equal(validateReceipt(reused, f).status, 'VALID');
  const other = { ...f, execution: createGoalExecution({ threadId: 'another-goal', repositories: f.repositories }) };
  assert.ok(validateReceipt(receipt, other).reasons.includes('WRONG_GOAL'));
  const reobserved = await observeAndroidArtifacts({ ...other, bundlePath: receipt.observation.bundlePath });
  assert.equal(validateReceipt(reobserved, other).status, 'VALID');
  assert.notEqual(reobserved.receiptId, receipt.receiptId);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, receipt.observation.bundlePath))).goalReference, f.execution.identity);
  fs.writeFileSync(path.join(f.root, 'unrelated-harness.txt'), 'unrelated change\n');
  assert.equal(validateReceipt(receipt, f).status, 'VALID');
  const bundle = JSON.parse(fs.readFileSync(path.join(f.root, receipt.observation.bundlePath)));
  fs.appendFileSync(path.join(f.root, bundle.commands[7].output), 'tampered');
  assert.equal(validateReceipt(receipt, f).status, 'INVALID');
  await assert.rejects(() => observeAndroidArtifacts({ ...f, bundlePath: receipt.observation.bundlePath }), /INTEGRITY/);
});

for (const [title, events, expected] of [
  ['ordered same run', [['START', 'one'], ['SAVE', 'one']], 'PASS'],
  ['different runs', [['START', 'one'], ['SAVE', 'two']], 'FAIL'],
  ['wrong order', [['SAVE', 'one'], ['START', 'one']], 'FAIL'],
]) test(`Flight Recorder sequence requires ${title}`, async (t) => {
  const f = fixture(t, { events });
  const p = JSON.parse(fs.readFileSync(path.join(f.root, 'profile.json')));
  p.steps[0].checks = [{ type: 'NDJSON_EVENT_SEQUENCE', pointer: [], expected: {
    eventKey: 'event', timeKey: 'wallTime', runIdKey: 'localRunId', events: ['START', 'SAVE'],
  } }];
  fs.writeFileSync(path.join(f.root, 'profile.json'), JSON.stringify(p));
  f.androidProfile.fingerprint = evidenceHash(JSON.stringify(p));
  const result = await capture(f); assert.equal(result.result, expected);
});

test('Canonical completion consumes Android receipts and revokes admissibility after artifact tampering', async (t) => {
  const f = fixture(t); const { registry } = loadCapabilityFiles();
  let state = startWorkingContext({ ...f, threadId: 'android-completion-fixture', objective: 'Fixture admission circuit', taskClass: 'BOUNDED' });
  state = amendWorkingContext({ ...f, existing: state, identity: state.execution.identity, reason: 'Bind exact fixture profile',
    changes: { requirements: { add: [{ kind: 'RUNTIME', id: 'physical', receiptRequirement: { kinds: ['RUNTIME'], repository: 'wayper', target: 'physical',
      result: 'PASS', androidProfile: f.androidProfile } }] } } });
  f.execution = state.execution;
  state.contextMap = refreshContextMap(null, { ...f, registry, goalId: state.goalId, taskClass: state.taskClass, tokenCeiling: 16000 });
  const receipt = await capture(f);
  state = proveWorkingContext(state, { requirement: 'RUNTIME:physical', evidence: receipt.receiptId }, f);
  const inputs = { operation: 'TRIVIAL', taskClass: 'BOUNDED', repositories: [{ repository: 'wayper', platforms: ['android'], changedPaths: ['owner.js'],
    capabilities: [], risks: [], testTargets: { L1: [], L2: [] } }], criteria: [{ id: 'physical', repository: 'wayper', platform: 'android',
    claim: 'REAL_SCENARIO', required: true, blocking: true, androidProfile: f.androidProfile }] };
  state.contextMap = recordContextEntry(state.contextMap, 'validation-plan', { inputs }, f.repositories, { ...f, registry });
  const plan = buildValidationPlan({ ...f, inputs });
  for (const r of plan.requirements) {
    if (r.kind === 'OBSERVED_SCENARIO') await observeAndroidArtifacts({ ...f, bundlePath: receipt.observation.bundlePath, target: r.evidencePolicy.receiptRequirement.target });
    else await runObservedCommand({ ...f, mutability: 'READ_ONLY', command: 'git', args: ['diff', '--check', 'HEAD', '--'],
      target: r.evidencePolicy.receiptRequirement.target });
  }
  fs.mkdirSync(path.join(f.root, '.wayper-context'), { recursive: true });
  fs.writeFileSync(contextStatePath(f.root, f.execution.identity.goalRunId), renderWorkingContext(state));
  assert.equal(assessGoalCompletion({ root: f.root, identity: f.execution.identity }).decision, 'ADMISSIBLE');
  const b = JSON.parse(fs.readFileSync(path.join(f.root, receipt.observation.bundlePath)));
  fs.appendFileSync(path.join(f.root, b.commands[7].output), 'tampered');
  assert.notEqual(assessGoalCompletion({ root: f.root, identity: f.execution.identity }).decision, 'ADMISSIBLE');
});

for (const [title, config, expected] of [
  ['emulator', { emulator: '1' }, 'PHYSICAL_IDENTITY'], ['wrong APK', { apk: 'wrong' }, 'APK_MISMATCH'],
]) test(`Android rejects ${title}`, async (t) => { await assert.rejects(() => capture(fixture(t, config)), new RegExp(expected)); });

for (const [title, config] of [['failed check', { status: 'RUNNING' }], ['old execution', { at: '2025-01-01T00:00:00.000Z' }]]) {
  test(`Android preserves FAIL for ${title}`, async (t) => {
    const f = fixture(t, config); const receipt = await capture(f);
    assert.equal(receipt.result, 'FAIL'); assert.equal(validateReceipt(receipt, f).status, 'VALID');
  });
}

test('Android rejects changed source, profile, unsafe command and mismatched session revision', async (t) => {
  const f = fixture(t); const session = await beginAndroidObservation(f);
  await assert.rejects(() => observeAndroidArtifacts({ ...f, ...session, execution: { ...f.execution,
    identity: { ...f.execution.identity, revision: 2 } } }), /WRONG_GOAL_OR_REVISION/);
  const receipt = await observeAndroidArtifacts({ ...f, ...session });
  fs.appendFileSync(path.join(f.root, 'owner.js'), '// new source\n');
  assert.equal(validateReceipt(receipt, f).status, 'INVALID');
  fs.writeFileSync(path.join(f.root, 'owner.js'), 'export const owner = true;\n');
  const p = JSON.parse(fs.readFileSync(path.join(f.root, 'profile.json'))); p.steps[0].args = ['shell', 'rm', '-rf', '/sdcard'];
  fs.writeFileSync(path.join(f.root, 'profile.json'), JSON.stringify(p));
  assert.throws(() => loadAndroidProfile(f.root, f.androidProfile), /PROFILE_CHANGED/);
  assert.throws(() => loadAndroidProfile(f.root, { path: 'profile.json', fingerprint: evidenceHash(JSON.stringify(p)) }), /INVALID_ANDROID_STEP/);
});

test('Planner admits only explicit approved Android profile for L3/L5/L6; assertion and another profile fail', async (t) => {
  const f = fixture(t);
  const inputs = { operation: 'FEATURE', taskClass: 'BOUNDED', repositories: [{ repository: 'wayper', platforms: ['android'],
    changedPaths: ['owner.js'], capabilities: ['product-rules'], risks: [], testTargets: { L1: [], L2: [] } }],
    criteria: [{ id: 'physical', repository: 'wayper', platform: 'android', claim: 'REAL_SCENARIO', required: true, blocking: true,
      androidProfile: f.androidProfile }] };
  const plan = buildValidationPlan({ ...f, inputs });
  for (const requirement of plan.requirements.filter((r) => r.kind === 'OBSERVED_SCENARIO')) {
    const opts = { ...f, target: requirement.evidencePolicy.receiptRequirement.target };
    const receipt = await capture(opts);
    const assessed = evaluateValidationPlan(plan, { ...f, inputs, receiptIds: [receipt.receiptId] });
    assert.equal(assessed.requirements.find((r) => r.validationRequirementId === requirement.validationRequirementId).status, 'SATISFIED');
    const different = { ...f.androidProfile, fingerprint: evidenceHash('another profile') };
    const otherInputs = structuredClone(inputs); otherInputs.criteria[0].androidProfile = different;
    assert.throws(() => buildValidationPlan({ ...f, inputs: otherInputs }), /PROFILE_CHANGED/);
    const assertion = recordAssertion({ ...opts, kind: 'RUNTIME', origin: 'MODEL_ASSERTED', summary: 'physical test passed' });
    const rejected = evaluateValidationPlan(plan, { ...f, inputs, receiptIds: [assertion.receiptId] });
    assert.notEqual(rejected.requirements.find((r) => r.validationRequirementId === requirement.validationRequirementId).status, 'SATISFIED');
  }
  const physical = plan.requirements.find((r) => r.level === 'L5');
  const simple = await runObservedCommand({ ...f, command: process.execPath, args: ['-e', 'process.exit(0)'],
    target: physical.evidencePolicy.receiptRequirement.target, mutability: 'READ_ONLY' });
  assert.notEqual(evaluateValidationPlan(plan, { ...f, inputs, receiptIds: [simple.receiptId] }).requirements.find((r) => r.level === 'L5').status, 'SATISFIED');
  const noProfile = structuredClone(inputs); delete noProfile.criteria[0].androidProfile;
  assert.equal(evaluateValidationPlan(buildValidationPlan({ ...f, inputs: noProfile }), { ...f, inputs: noProfile }).requirements.find((r) => r.level === 'L5').status, 'UNAVAILABLE');
});


test('Failed artifact capture can be reobserved without rewriting or rebinding the original window', async (t) => {
  const f = fixture(t, { status: 'RUNNING' });
  const started = await beginAndroidObservation(f);
  const failed = await observeAndroidArtifacts({ ...f, ...started });
  assert.equal(failed.result, 'FAIL');
  const originalPath = path.join(f.root, failed.observation.bundlePath);
  const original = fs.readFileSync(originalPath);
  const originalBundle = JSON.parse(original);
  const adb = path.join(process.env.PATH.split(path.delimiter)[0], 'adb');
  fs.writeFileSync(adb, fs.readFileSync(adb, 'utf8').replace('"status":"RUNNING"', '"status":"IDLE"'));
  const retried = await observeAndroidArtifacts({ ...f, ...started });
  assert.equal(retried.result, 'PASS');
  assert.equal(validateReceipt(retried, f).status, 'VALID');
  assert.equal(validateReceipt(failed, f).status, 'VALID');
  assert.notEqual(retried.observation.bundlePath, failed.observation.bundlePath);
  assert.deepEqual(fs.readFileSync(originalPath), original);
  const next = JSON.parse(fs.readFileSync(path.join(f.root, retried.observation.bundlePath)));
  assert.deepEqual(next.goalReference, originalBundle.goalReference);
  assert.deepEqual(next.profile, originalBundle.profile);
  assert.equal(next.startedAt, originalBundle.startedAt);
  assert.deepEqual(next.commands.slice(0, 7).map(c => [c.args, c.startedAt, c.finishedAt, c.stdoutFingerprint, c.stderrFingerprint]),
    originalBundle.commands.slice(0, 7).map(c => [c.args, c.startedAt, c.finishedAt, c.stdoutFingerprint, c.stderrFingerprint]));
  await assert.rejects(() => observeAndroidArtifacts({ ...f, sessionPath: retried.observation.bundlePath.replace('bundle.json', 'session.json') }), /ALREADY_COMPLETE/);
  fs.appendFileSync(path.join(f.root, originalBundle.commands[7].output), 'tampered');
  await assert.rejects(() => observeAndroidArtifacts({ ...f, ...started }), /INTEGRITY/);
});
