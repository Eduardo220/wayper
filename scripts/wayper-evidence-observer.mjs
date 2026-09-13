import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertGoalExecution, repositorySnapshot, stable } from './wayper-context-identity.mjs';
import { evidenceHash, evidenceText, safeEvidencePath, sealReceipt, sourceFingerprint, validateReceiptSchema, receiptIntegrityValid } from './wayper-evidence-receipts.mjs';
import { evidenceRepositories, receiptPath, readReceipt } from './wayper-evidence-store.mjs';
import { inspectGraphFreshness, freshGraph } from './wayper-graph.mjs';

const producer = Object.freeze({ name: 'wayper-evidence-observer', version: 1 });
const now = () => new Date().toISOString();
const sensitivePath = /(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials[^/]*|id_rsa|id_ed25519|[^/]*\.(?:pem|key|p12))$/i;

function context(options) {
  assertGoalExecution(options.execution);
  const definition = evidenceRepositories(options).find((repo) => repo.id === options.repository);
  const baseline = options.execution.baseline.repositories.find((repo) => repo.repositoryId === options.repository);
  if (!definition || !baseline) throw new Error('Unknown evidence repository');
  const snapshot = repositorySnapshot(definition);
  if (snapshot.checkoutFingerprint !== baseline.checkoutFingerprint) throw new Error('Wrong evidence checkout');
  return { definition, snapshot, baseline };
}

// Trusted producer-only persistence, not an import/verification API for participant objects.
// Local project code and the filesystem are trusted; this is not cryptographic attestation.
function writeReceipt(receipt, options) {
  if (validateReceiptSchema(receipt).status !== 'VALID' || !receiptIntegrityValid(receipt)) throw new Error('Invalid receipt');
  assertGoalExecution(options.execution);
  if (stable(receipt.goalReference) !== stable(options.execution.identity) ||
    receipt.baselineReference.fingerprint !== options.execution.baseline.fingerprint) throw new Error('Receipt execution mismatch');
  const file = receiptPath(receipt.receiptId, options);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const bytes = JSON.stringify(receipt);
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.linkSync(temporary, file); }
    catch (error) {
      if (error.code !== 'EEXIST' || stable(readReceipt(receipt.receiptId, options)) !== stable(receipt)) throw error;
    }
    const fdDirectory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(fdDirectory); } finally { fs.closeSync(fdDirectory); }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return receipt;
}

function receipt(options, observed, content) {
  return writeReceipt(sealReceipt({ schemaVersion: 1, goalReference: options.execution.identity,
    baselineReference: { fingerprint: options.execution.baseline.fingerprint,
      repositoryFingerprint: observed.baseline.contentFingerprint },
    repositoryReference: observed.snapshot, ...content, producedAt: now(), producer,
    parentReceiptIds: content.parentReceiptIds ?? [],
    metadata: Object.fromEntries(Object.entries(options.metadata ?? {}).map(([key, value]) => [key, evidenceText(value, 120)])),
  }), options);
}

export function observeFile(options) {
  const observed = context(options);
  if (sensitivePath.test(options.path)) throw new Error('Sensitive source observation prohibited');
  const kind = options.kind ?? 'SOURCE';
  if (!['SOURCE', 'DOCUMENT'].includes(kind)) throw new Error('File observer requires SOURCE or DOCUMENT');
  const range = options.range ?? null;
  const source = sourceFingerprint(observed.definition.root, options.path, range);
  if (!source) throw new Error('Missing evidence source');
  return receipt(options, observed, { kind, origin: 'SOURCE_OBSERVED', result: 'OBSERVED',
    subject: { path: options.path, range, target: `${options.path}${range ? `#${range}` : ''}`, fingerprint: source.hash },
    observation: { type: 'FILE', bytes: source.bytes } });
}

function streamObservation(stream) {
  const hash = crypto.createHash('sha256'); let bytes = 0; let tail = '';
  stream.on('data', (chunk) => {
    hash.update(chunk); bytes += chunk.length;
    // Only retain a bounded in-memory tail for standard TAP summary counts; never persist output.
    tail = (tail + chunk.toString('utf8')).slice(-16_384);
  });
  return () => ({ fingerprint: `sha256:${hash.digest('hex')}`, bytes, tail });
}

function tapCounts(output) {
  const count = (key) => { const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, 'gm'))];
    return matches.length ? Number(matches.at(-1)[1]) : null; };
  const total = count('tests'); const passed = count('pass'); const failed = count('fail'); const skipped = count('skipped');
  return [total, passed, failed, skipped].every(Number.isSafeInteger) ? { total, passed, failed, skipped } : null;
}

export async function runObservedCommand(options) {
  const observed = context(options);
  const { command, args = [], cwd = '.', timeoutMs = 300_000 } = options;
  if (typeof command !== 'string' || !command || command.includes('\0') || !Array.isArray(args) || args.length > 256 ||
    args.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
    !(cwd === '.' || safeEvidencePath(cwd)) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new Error('Invalid observed command');
  }
  const { realpathSync } = await import('node:fs');
  const directory = realpathSync(path.resolve(observed.definition.root, cwd));
  const root = realpathSync(observed.definition.root);
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new Error('Command cwd escapes repository');
  const startedAt = now();
  const executionId = crypto.randomUUID();
  const target = evidenceText(options.target);
  // A parent node:test worker must not suppress a nested, explicitly requested test execution.
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const child = spawn(command, args, { cwd: directory, env: environment, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  timeout.unref();
  const stdout = streamObservation(child.stdout); const stderr = streamObservation(child.stderr);
  let executionError = false;
  child.on('error', () => { executionError = true; });
  const outcome = await new Promise((resolve) => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
  clearTimeout(timeout);
  const finishedAt = now(); const out = stdout(); const err = stderr();
  const after = repositorySnapshot(observed.definition);
  const exitCode = executionError || outcome.exitCode < 0 ? null : outcome.exitCode;
  return receipt(options, observed, { kind: 'COMMAND', origin: 'RUNNER_OBSERVED',
    result: exitCode === 0 && outcome.signal === null ? 'PASS' : 'FAIL',
    subject: { path: null, range: null, target, fingerprint: observed.snapshot.contentFingerprint },
    observation: { type: 'EXECUTION', executionId,
      command: `${evidenceText(path.basename(command), 100)} [${args.length} arguments withheld]`,
      commandFingerprint: evidenceHash(stable({ command, args })), cwd, startedAt, finishedAt,
      exitCode, signal: outcome.signal, stdoutFingerprint: out.fingerprint, stderrFingerprint: err.fingerprint,
      stdoutBytes: out.bytes, stderrBytes: err.bytes, outputPolicy: 'HASH_ONLY',
      stateBefore: observed.snapshot.contentFingerprint, stateAfter: after.contentFingerprint, counts: tapCounts(out.tail) } });
}

async function runDerived(options, kind) {
  const commandReceipt = await runObservedCommand(options);
  const observed = { snapshot: commandReceipt.repositoryReference,
    baseline: { contentFingerprint: commandReceipt.baselineReference.repositoryFingerprint } };
  const derived = receipt(options, observed, { kind, origin: 'RUNNER_OBSERVED',
    result: commandReceipt.result, subject: commandReceipt.subject,
    observation: { type: 'DERIVATION', commandReceiptId: commandReceipt.receiptId,
      executionId: commandReceipt.observation.executionId, counts: commandReceipt.observation.counts },
    parentReceiptIds: [commandReceipt.receiptId] });
  return { commandReceipt, receipt: derived };
}

export const runObservedTest = (options) => runDerived(options, 'TEST');
export const runObservedQualityGate = (options) => runDerived(options, 'QUALITY_GATE');

export function recordAssertion(options) {
  if (!['HANDOFF_ASSERTED', 'MODEL_ASSERTED', 'HUMAN_ASSERTED', 'IMPORTED_LEGACY'].includes(options.origin)) {
    throw new Error('Assertion cannot claim an observed origin');
  }
  const observed = context(options);
  const summary = evidenceText(options.summary);
  return receipt(options, observed, { kind: options.kind, origin: options.origin, result: 'UNKNOWN',
    subject: { path: null, range: null, target: evidenceText(options.target), fingerprint: evidenceHash(summary) },
    observation: { type: 'ASSERTION', summary, environment: options.environment ? evidenceText(options.environment) :
      options.kind === 'RUNTIME' ? 'UNKNOWN' : null } });
}

// Observes a cache reference, not execution of a Graphify query or source correctness.
export function recordGraphReference(options) {
  if (typeof options.query !== 'string' || !options.query.trim() || options.queryResult === undefined) throw new Error('Graph query and result required');
  const observed = context(options); const graphPath = options.graphPath ?? 'graphify-out/graph.json';
  const graph = sourceFingerprint(observed.definition.root, graphPath);
  if (!graph) throw new Error('Graph unavailable');
  const current = inspectGraphFreshness({ repository: options.repository, root: observed.definition.root,
    peerDirectory: options.repository === 'wayper' ? 'wayper-site' : 'wayper', querySymbols: [] }, options.graphOptions);
  const freshness = freshGraph(current.status) && current.corpus.corpusFingerprint === options.corpusFingerprint ? 'CURRENT' : 'STALE';
  return receipt(options, observed, { kind: 'GRAPH', origin: 'MODEL_ASSERTED', result: 'UNKNOWN',
    subject: { path: graphPath, range: null, target: evidenceText(options.target), fingerprint: graph.hash },
    observation: { type: 'GRAPH_REFERENCE', graphPath, corpusFingerprint: options.corpusFingerprint,
      graphFingerprint: graph.hash, queryFingerprint: evidenceHash(String(options.query)),
      resultFingerprint: evidenceHash(stable(options.queryResult)), freshness } });
}

export function recordGraphQueryExecution(options) {
  const observed = context(options); const graphPath = options.graphPath ?? 'graphify-out/graph.json';
  const current = inspectGraphFreshness({ repository: options.repository, root: observed.definition.root,
    peerDirectory: options.repository === 'wayper' ? 'wayper-site' : 'wayper', querySymbols: [] }, options.graphOptions);
  if (!freshGraph(current.status) || current.corpus.corpusFingerprint !== options.corpusFingerprint ||
    current.graphFingerprint !== options.graphFingerprint || current.corpus.scopeFingerprint !== options.scopeFingerprint) {
    throw new Error('Graph changed before execution receipt');
  }
  const execution = options.executionObservation;
  return receipt(options, observed, { kind: 'GRAPH', origin: 'RUNNER_OBSERVED', result: 'PASS',
    subject: { path: graphPath, range: null, target: evidenceText(options.target), fingerprint: current.graphFingerprint },
    observation: { type: 'GRAPH_QUERY_EXECUTION', graphPath, corpusFingerprint: options.corpusFingerprint,
      graphFingerprint: options.graphFingerprint, scopeFingerprint: options.scopeFingerprint, ...execution } });
}

async function main() {
  const [mode, ...args] = process.argv.slice(2); const split = args.indexOf('--');
  const flags = split < 0 ? args : args.slice(0, split); const input = {};
  for (let i = 0; i < flags.length; i += 2) {
    if (!/^--[a-z-]+$/.test(flags[i]) || flags[i + 1] === undefined || input[flags[i].slice(2)] !== undefined) throw new Error('Invalid observer argument');
    input[flags[i].slice(2)] = flags[i + 1];
  }
  const { readWorkingContext, repositoryDefinitions, ROOT } = await import('./wayper-context.mjs');
  const state = readWorkingContext(ROOT, input);
  const options = { root: ROOT, execution: state.execution, repositories: repositoryDefinitions(input, state),
    repository: input['repository-id'] ?? 'wayper', target: input.target, path: input.path, range: input.range,
    command: args[split + 1], args: args.slice(split + 2) };
  const execute = { source: observeFile, document: (o) => observeFile({ ...o, kind: 'DOCUMENT' }),
    command: runObservedCommand, test: runObservedTest, gate: runObservedQualityGate }[mode];
  if (!execute || ['command', 'test', 'gate'].includes(mode) && split < 0) throw new Error('Usage: observer source|document|command|test|gate --thread-id ID --goal-run-id ID --revision N ... [-- executable args]');
  const observed = await execute(options); const value = observed.receipt ?? observed;
  console.log(JSON.stringify({ receiptId: value.receiptId, kind: value.kind, result: value.result,
    commandReceiptId: observed.commandReceipt?.receiptId ?? null }));
  if (value.result === 'FAIL') process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
