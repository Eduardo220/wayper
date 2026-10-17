import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stable, repositorySnapshot, assertGoalExecution, assertIdentity } from './wayper-context-identity.mjs';
import { evidenceHash, HASH, safeEvidencePath, sourceFingerprint, validAndroidProfileReference } from './wayper-evidence-receipts.mjs';

const exec = promisify(execFile);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join('|') === keys.split(' ').sort().join('|');
const iso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const read = (root, file) => {
  sourceFingerprint(root, file); // Enforces file and symlink boundaries for binary artifacts too.
  return fs.readFileSync(path.join(root, file));
};
const json = (root, file) => JSON.parse(read(root, file));
const pointer = (value, parts) => parts.reduce((v, key) => v != null && Object.hasOwn(v, key) ? v[key] : undefined, value);

function secureDirectory(root, directory) {
  let current = fs.realpathSync(root);
  for (const part of directory.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error('UNSAFE_ANDROID_STORE');
    if (!stat) fs.mkdirSync(current, { mode: 0o700 });
  }
}

function allowedArgs(args, pkg) {
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string' || a.length > 240 || /[\u0000-\u001f;&|`$<>]/.test(a))) return false;
  if (stable(args) === stable(['logcat', '-d', '-v', 'threadtime'])) return true;
  if (stable(args) === stable(['shell', 'dumpsys', 'activity', 'activities'])) return true;
  if (args.length === 5 && stable(args.slice(0, 4)) === stable(['exec-out', 'run-as', pkg, 'cat'])) return safeEvidencePath(args[4]);
  return args.length === 3 && args[0] === 'exec-out' && args[1] === 'cat' &&
    /^\/sdcard\/[a-zA-Z0-9_./-]+$/.test(args[2]) && !args[2].split('/').includes('..');
}

export function loadAndroidProfile(root, reference) {
  if (!validAndroidProfileReference(reference) || sourceFingerprint(root, reference.path)?.hash !== reference.fingerprint) throw new Error('ANDROID_PROFILE_CHANGED');
  const p = json(root, reference.path);
  if (!exact(p, 'schemaVersion package apkFingerprint sourceSubjects steps') || p.schemaVersion !== 1 ||
    !/^com\.wayper\.app(?:\.dev)?$/.test(p.package) || !HASH.test(p.apkFingerprint) || !Array.isArray(p.steps) ||
    !p.steps.length || p.steps.length > 16 || new Set(p.steps.map((s) => s.id)).size !== p.steps.length) throw new Error('INVALID_ANDROID_PROFILE');
  if (!Array.isArray(p.sourceSubjects) || !p.sourceSubjects.length || p.sourceSubjects.length > 64 ||
    new Set(p.sourceSubjects.map((s) => s.path)).size !== p.sourceSubjects.length || p.sourceSubjects.some((s) =>
      !validAndroidProfileReference(s) || sourceFingerprint(root, s.path)?.hash !== s.fingerprint)) throw new Error('ANDROID_SOURCE_SUBJECT_CHANGED');
  let freshness = false;
  for (const s of p.steps) {
    if (!exact(s, 'id args checks') || !/^[a-z0-9-]{1,60}$/.test(s.id) || !allowedArgs(s.args, p.package) ||
      !Array.isArray(s.checks) || s.checks.length > 32) throw new Error('INVALID_ANDROID_STEP');
    for (const c of s.checks) {
      if (!exact(c, 'type pointer expected') || !['JSON_EQUALS', 'JSON_TIMESTAMP_IN_WINDOW', 'NDJSON_EVENT_SEQUENCE', 'TEXT_INCLUDES', 'TEXT_EXCLUDES'].includes(c.type) ||
        !Array.isArray(c.pointer) || c.pointer.length > 16 || c.pointer.some((v) => typeof v !== 'string' || v.length > 120) ||
        c.type.startsWith('TEXT_') && (c.pointer.length || typeof c.expected !== 'string' || !c.expected.length) ||
        c.type === 'JSON_TIMESTAMP_IN_WINDOW' && c.expected !== null ||
        c.type === 'NDJSON_EVENT_SEQUENCE' && (c.pointer.length || !exact(c.expected, 'eventKey timeKey runIdKey events') ||
          ['eventKey', 'timeKey', 'runIdKey'].some((k) => !/^[a-zA-Z][a-zA-Z0-9]{0,59}$/.test(c.expected[k])) ||
          !Array.isArray(c.expected.events) || c.expected.events.length < 2 || c.expected.events.length > 32 ||
          c.expected.events.some((v) => typeof v !== 'string' || !v.length || v.length > 120))) throw new Error('INVALID_ANDROID_CHECK');
      freshness ||= ['JSON_TIMESTAMP_IN_WINDOW', 'NDJSON_EVENT_SEQUENCE'].includes(c.type);
    }
  }
  // Fresh diagnostic timestamps are mandatory; reading an old PASS on today's device is not a new physical test.
  if (!freshness || p.steps.every((s) => s.checks.every((c) => c.type === 'JSON_TIMESTAMP_IN_WINDOW'))) throw new Error('ANDROID_SCENARIO_CHECKS_REQUIRED');
  return p;
}

function eventSequence(output, expected, startedAt, finishedAt) {
  const rows = output.split(/\r?\n/).filter((s) => s.trim()).map((s) => JSON.parse(s));
  const runs = new Map();
  for (const row of rows) {
    const at = row[expected.timeKey], id = row[expected.runIdKey];
    if (!iso(at) || at < startedAt || at > finishedAt || typeof id !== 'string' || !id) continue;
    const prior = runs.get(id) ?? { index: 0, at: startedAt };
    if (at >= prior.at && row[expected.eventKey] === expected.events[prior.index]) {
      prior.index += 1; prior.at = at; runs.set(id, prior);
      if (prior.index === expected.events.length) return true;
    }
  }
  return false;
}

async function capture(root, directory, serial, id, args) {
  secureDirectory(root, directory);
  const startedAt = new Date().toISOString();
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), exitCode = 0;
  try {
    const result = await exec('adb', ['-s', serial, ...args], { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: 60_000, shell: false });
    stdout = result.stdout; stderr = result.stderr;
  } catch (error) { stdout = error.stdout ?? stdout; stderr = error.stderr ?? stderr; exitCode = Number.isInteger(error.code) ? error.code : null; }
  const output = `${directory}/${id}.stdout`, errorOutput = `${directory}/${id}.stderr`;
  fs.writeFileSync(path.join(root, output), stdout, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(root, errorOutput), stderr, { flag: 'wx', mode: 0o600 });
  return { id, args: ['-s', serial, ...args], startedAt, finishedAt: new Date().toISOString(), exitCode,
    output, errorOutput, stdoutFingerprint: evidenceHash(stdout), stderrFingerprint: evidenceHash(stderr) };
}

async function identity(root, directory, serial, pkg, prefix) {
  const specs = [ ['state', ['get-state']], ['model', ['shell', 'getprop', 'ro.product.model']],
    ['build', ['shell', 'getprop', 'ro.build.fingerprint']], ['emulator', ['shell', 'getprop', 'ro.kernel.qemu']],
    ['package', ['shell', 'dumpsys', 'package', pkg]], ['paths', ['shell', 'pm', 'path', pkg]] ];
  const commands = [];
  for (const [id, args] of specs) commands.push(await capture(root, directory, serial, `${prefix}-${id}`, args));
  const paths = read(root, commands.at(-1).output).toString().trim().split('\n');
  if (paths.length !== 1 || !/^package:\/data\/app\/[a-zA-Z0-9_./=+~-]+\.apk$/.test(paths[0]) || paths[0].includes('/../')) throw new Error('ANDROID_APK_PATH_UNAVAILABLE_OR_SPLIT');
  commands.push(await capture(root, directory, serial, `${prefix}-apk`, ['exec-out', 'cat', paths[0].slice(8)]));
  return commands;
}

function device(root, commands, serial, pkg) {
  const out = (n) => read(root, commands[n].output).toString().trim();
  if (commands.length !== 7 || commands.some((c) => c.exitCode !== 0) || out(0) !== 'device' || out(3) !== '0' ||
    /^(?:emulator-|localhost|127\.)/.test(serial) || !out(1) || !out(2) || !out(4).includes(`Package [${pkg}]`) ||
    !/versionCode=\d+/.test(out(4)) || !/versionName=\S+/.test(out(4))) throw new Error('ANDROID_PHYSICAL_IDENTITY_UNPROVEN');
  const expected = [ ['get-state'], ['shell', 'getprop', 'ro.product.model'], ['shell', 'getprop', 'ro.build.fingerprint'],
    ['shell', 'getprop', 'ro.kernel.qemu'], ['shell', 'dumpsys', 'package', pkg], ['shell', 'pm', 'path', pkg],
    ['exec-out', 'cat', out(5).replace(/^package:/, '')] ];
  if (commands.some((c, i) => stable(c.args) !== stable(['-s', serial, ...expected[i]]))) throw new Error('ANDROID_IDENTITY_COMMAND_MISMATCH');
  return { serial, model: out(1), build: out(2), package: pkg,
    versionCode: out(4).match(/versionCode=(\d+)/)[1], versionName: out(4).match(/versionName=(\S+)/)[1],
    apkFingerprint: commands[6].stdoutFingerprint };
}

export async function beginAndroidObservation(options) {
  assertGoalExecution(options.execution);
  if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(options.serial ?? '') || options.repository !== 'wayper') throw new Error('INVALID_ANDROID_DEVICE');
  const profile = loadAndroidProfile(options.root, options.androidProfile);
  const directory = `.wayper-context/android/${crypto.randomUUID()}`;
  const before = repositorySnapshot({ id: 'wayper', root: options.root });
  secureDirectory(options.root, directory);
  const commands = await identity(options.root, directory, options.serial, profile.package, 'before');
  const observedDevice = device(options.root, commands, options.serial, profile.package);
  if (observedDevice.apkFingerprint !== profile.apkFingerprint) throw new Error('ANDROID_APK_MISMATCH');
  const session = { schemaVersion: 1, goalReference: options.execution.identity, repositoryFingerprint: before.contentFingerprint,
    profile: options.androidProfile, serial: options.serial, device: observedDevice, commands, startedAt: commands[0].startedAt };
  const sessionPath = `${directory}/session.json`;
  fs.writeFileSync(path.join(options.root, sessionPath), JSON.stringify(session), { flag: 'wx', mode: 0o600 });
  return { sessionPath, device: observedDevice, startedAt: session.startedAt };
}

export async function finishAndroidObservation(options) {
  assertGoalExecution(options.execution);
  if (!/^\.wayper-context\/android\/[a-f0-9-]{36}\/session\.json$/.test(options.sessionPath ?? '')) throw new Error('INVALID_ANDROID_SESSION');
  const session = json(options.root, options.sessionPath);
  if (stable(session.goalReference) !== stable(options.execution.identity)) throw new Error('ANDROID_SESSION_WRONG_GOAL_OR_REVISION');
  const profile = loadAndroidProfile(options.root, session.profile);
  let directory = path.posix.dirname(options.sessionPath);
  let commands = [...session.commands];
  const priorBundle = directory + '/bundle.json';
  if (fs.existsSync(path.join(options.root, priorBundle))) {
    const prior = inspectAndroidBundle(options.root, priorBundle);
    const bundle = json(options.root, priorBundle);
    if (prior.result !== 'FAIL' || stable(bundle.commands.slice(0, 7)) !== stable(session.commands) ||
      stable(bundle.goalReference) !== stable(session.goalReference) || stable(bundle.profile) !== stable(session.profile)) {
      throw new Error('ANDROID_CAPTURE_ALREADY_COMPLETE');
    }
    directory = '.wayper-context/android/' + crypto.randomUUID();
    secureDirectory(options.root, directory);
    // Retry artifact reads within the same observed window; original captures and timestamps stay immutable.
    commands = session.commands.map((command) => {
      const output = directory + '/' + command.id + '.stdout';
      const errorOutput = directory + '/' + command.id + '.stderr';
      fs.copyFileSync(path.join(options.root, command.output), path.join(options.root, output), fs.constants.COPYFILE_EXCL);
      fs.copyFileSync(path.join(options.root, command.errorOutput), path.join(options.root, errorOutput), fs.constants.COPYFILE_EXCL);
      return { ...command, output, errorOutput };
    });
    fs.writeFileSync(path.join(options.root, directory + '/session.json'), JSON.stringify({ ...session, commands }),
      { flag: 'wx', mode: 0o600 });
  }
  for (const step of profile.steps) commands.push(await capture(options.root, directory, session.serial, step.id, step.args));
  const afterCommands = await identity(options.root, directory, session.serial, profile.package, 'after');
  const afterDevice = device(options.root, afterCommands, session.serial, profile.package);
  if (stable(afterDevice) !== stable(session.device)) throw new Error('ANDROID_DEVICE_OR_BUILD_CHANGED');
  commands.push(...afterCommands);
  const bundle = { ...session, commands, finishedAt: commands.at(-1).finishedAt };
  const bundlePath = `${directory}/bundle.json`;
  fs.writeFileSync(path.join(options.root, bundlePath), JSON.stringify(bundle), { flag: 'wx', mode: 0o600 });
  return inspectAndroidBundle(options.root, bundlePath);
}

export function inspectAndroidBundle(root, bundlePath) {
  if (!/^\.wayper-context\/android\/[a-f0-9-]{36}\/bundle\.json$/.test(bundlePath ?? '')) throw new Error('INVALID_ANDROID_BUNDLE');
  const b = json(root, bundlePath);
  if (!exact(b, 'schemaVersion goalReference repositoryFingerprint profile serial device commands startedAt finishedAt') || b.schemaVersion !== 1 ||
    !iso(b.startedAt) || !iso(b.finishedAt) || b.startedAt > b.finishedAt || !HASH.test(b.repositoryFingerprint)) throw new Error('ANDROID_BUNDLE_STATE_MISMATCH');
  assertIdentity(b.goalReference);
  if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(b.serial ?? '')) throw new Error('INVALID_ANDROID_DEVICE');
  const profile = loadAndroidProfile(root, b.profile);
  if (b.commands.length !== profile.steps.length + 14) throw new Error('ANDROID_COMMANDS_MISSING');
  const directory = path.posix.dirname(bundlePath);
  for (const c of b.commands) {
    if (!exact(c, 'id args startedAt finishedAt exitCode output errorOutput stdoutFingerprint stderrFingerprint') ||
      c.output !== `${directory}/${c.id}.stdout` || c.errorOutput !== `${directory}/${c.id}.stderr` ||
      !iso(c.startedAt) || !iso(c.finishedAt) || c.startedAt < b.startedAt || c.finishedAt > b.finishedAt || c.startedAt > c.finishedAt ||
      sourceFingerprint(root, c.output)?.hash !== c.stdoutFingerprint || sourceFingerprint(root, c.errorOutput)?.hash !== c.stderrFingerprint) throw new Error('ANDROID_ARTIFACT_INTEGRITY');
  }
  if (b.startedAt !== b.commands[0].startedAt || b.finishedAt !== b.commands.at(-1).finishedAt ||
    b.commands.some((c, i) => i > 0 && c.startedAt < b.commands[i - 1].finishedAt)) throw new Error('ANDROID_COMMAND_TIME_MISMATCH');
  if (new Set(b.commands.map((c) => c.id)).size !== b.commands.length) throw new Error('ANDROID_DUPLICATE_COMMAND');
  const before = device(root, b.commands.slice(0, 7), b.serial, profile.package);
  const after = device(root, b.commands.slice(-7), b.serial, profile.package);
  if (stable(before) !== stable(after) || stable(before) !== stable(b.device) || before.apkFingerprint !== profile.apkFingerprint) throw new Error('ANDROID_BUILD_MISMATCH');
  const checks = [];
  for (const [i, step] of profile.steps.entries()) {
    const command = b.commands[i + 7];
    if (command.id !== step.id || stable(command.args) !== stable(['-s', b.serial, ...step.args])) throw new Error('ANDROID_PROFILE_COMMAND_MISMATCH');
    const output = read(root, command.output).toString('utf8');
    for (const [n, check] of step.checks.entries()) {
      let passed = false;
      try {
        const value = check.type.startsWith('JSON_') ? pointer(JSON.parse(output), check.pointer) : output;
        passed = command.exitCode === 0 && (check.type === 'NDJSON_EVENT_SEQUENCE' ? eventSequence(output, check.expected, b.startedAt, command.finishedAt) :
          check.type === 'JSON_EQUALS' ? stable(value) === stable(check.expected) :
          check.type === 'JSON_TIMESTAMP_IN_WINDOW' ? iso(value) && value >= b.startedAt && value <= command.finishedAt :
            check.type === 'TEXT_INCLUDES' ? value.includes(check.expected) : !value.includes(check.expected));
      } catch { /* Malformed or missing observable data fails, never defaults to PASS. */ }
      checks.push({ step: step.id, check: n, passed });
    }
  }
  const result = b.commands.every((c) => c.exitCode === 0) && checks.every((c) => c.passed) ? 'PASS' : 'FAIL';
  return { result, device: before, checks, capturedGoalReference: b.goalReference,
    observation: { type: 'ANDROID_ARTIFACTS', bundlePath, bundleFingerprint: sourceFingerprint(root, bundlePath).hash,
      profilePath: b.profile.path, profileFingerprint: b.profile.fingerprint, environment: 'PHYSICAL_DEVICE',
      startedAt: b.startedAt, finishedAt: b.finishedAt } };
}
