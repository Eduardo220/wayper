import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './wayper-harness-benchmark.mjs';
import { singleTrial, usage } from './wayper-harness-benchmark-agentic.mjs';
import { readFrozen } from './wayper-harness-holdout.mjs';
import { scoreHoldout } from './wayper-harness-holdout-score.mjs';

const UNKNOWN = 'UNKNOWN';
const ORIGINAL = '/home/eduardo/.codex/packages/standalone/releases/0.155.1-x86_64-unknown-linux-musl/bin/codex';
const OUT = path.join(ROOT, '.wayper-context/benchmark-runs/exec-native-telemetry');
const PREFIX = 'WAYPER_EXEC_NATIVE_TELEMETRY ';
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const observerDir = (attemptRoot) => path.join(path.dirname(attemptRoot), `observer-${path.basename(attemptRoot)}`);
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : UNKNOWN;
const delta = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : UNKNOWN;
function visibleManifest(root) {
  const files = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else files[path.relative(root, file)] = sha(fs.readFileSync(file));
    }
  }
  visit(root); return files;
}

export function swapExecBinary(args, binary) {
  const index = args.findIndex((value, i) => value === '--ro-bind' && args[i + 2] === '/tmp/codex');
  assert.ok(index >= 0 && args[index + 1] === ORIGINAL, 'EXEC_BINARY_BOUNDARY_CHANGED');
  const next = [...args]; next[index + 1] = binary;
  return next;
}

// Same bwrap command, environment, stdio, timeout, and file writes as runProcess.
// The extra records are captured by the parent after pipe reads, outside the candidate.
export function observedRunProcess(binary, mode) {
  return (executable, args, { cwd, timeoutMs, stdoutPath, stderrPath, env = {}, signal, killGraceMs = 1_000 }) => new Promise((resolve) => {
    assert.equal(executable, 'bwrap');
    const invoked = mode === 'instrumented' ? swapExecBinary(args, binary) : args;
    const observerRoot = observerDir(path.dirname(stdoutPath));
    write(path.join(observerRoot, 'observer-contract.json'), {
      execArgs: args.slice(args.indexOf('--') + 1), envOverrides: env,
      inheritedEnvDigest: sha(JSON.stringify(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)))),
      sourceManifest: visibleManifest(cwd),
      outputSchemaHash: sha(fs.readFileSync(path.join(path.dirname(stdoutPath), 'output-schema.json'))),
      sandboxArgs: args.filter((value) => value.startsWith('--unshare') || value === '--die-with-parent'),
      toolSidecar: args.includes('/tmp/codex-code-mode-host'),
    });
    const started = process.hrtime.bigint();
    fs.writeFileSync(stdoutPath, ''); fs.writeFileSync(stderrPath, '');
    const timeline = []; const pending = { stdout: '', stderr: '' };
    const child = spawn(executable, invoked, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WAYPER_BENCHMARK: '1', ...env } });
    let stdout = ''; let stderr = ''; let timedOut = false; let interrupted = false; let settled = false; let killTimer;
    const terminate = (reason) => {
      if (settled) return;
      if (reason === 'timeout') timedOut = true; else interrupted = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, killGraceMs);
    };
    const timer = setTimeout(() => terminate('timeout'), timeoutMs);
    const abort = () => terminate('interrupt');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    function observe(stream, chunk) {
      pending[stream] += chunk.toString();
      let end; let visibleStderr = '';
      while ((end = pending[stream].indexOf('\n')) !== -1) {
        const line = pending[stream].slice(0, end); pending[stream] = pending[stream].slice(end + 1);
        if (stream === 'stderr' && line.startsWith(PREFIX)) {
          try {
            const data = JSON.parse(line.slice(PREFIX.length));
            timeline.push({ at: new Date().toISOString(), kind: data.kind === 'compaction' ? 'compaction' : 'response', data });
          }
          catch { timeline.push({ at: new Date().toISOString(), kind: 'malformed_response' }); }
        } else if (stream === 'stderr') {
          visibleStderr += line + '\n';
        } else if (stream === 'stdout') {
          try {
            const row = JSON.parse(line);
            if (row.type === 'item.started' || row.type === 'item.completed') {
              const item = row.item ?? {}; const body = item.aggregated_output;
              timeline.push({ at: new Date().toISOString(), kind: row.type, itemId: item.id ?? UNKNOWN,
                itemType: item.type ?? UNKNOWN, command: item.command ?? UNKNOWN,
                outputBytes: typeof body === 'string' ? Buffer.byteLength(body) : UNKNOWN });
            } else if (/compact/i.test(row.type ?? '') || /compact/i.test(row.item?.type ?? '')) {
              timeline.push({ at: new Date().toISOString(), kind: 'compaction', type: row.type, itemType: row.item?.type ?? UNKNOWN });
            }
          } catch { /* Raw stdout remains in stdout.log for audit. */ }
        }
      }
      return visibleStderr;
    }
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-16_384); fs.appendFileSync(stdoutPath, chunk); observe('stdout', chunk); });
    child.stderr.on('data', (chunk) => {
      const visible = observe('stderr', chunk); stderr = (stderr + visible).slice(-16_384); fs.appendFileSync(stderrPath, visible);
    });
    const finish = (data) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      if (pending.stderr && !pending.stderr.startsWith(PREFIX)) {
        fs.appendFileSync(stderrPath, pending.stderr); stderr = (stderr + pending.stderr).slice(-16_384);
      }
      write(path.join(observerRoot, 'observer-timeline.json'), timeline);
      resolve({ ...data, stdout, stderr, timedOut, interrupted, durationMs: Number(process.hrtime.bigint() - started) / 1e6 });
    };
    child.on('error', (error) => finish({ error: error.message, status: null, signal: null }));
    child.on('close', (status, closeSignal) => finish({ error: null, status, signal: closeSignal }));
  });
}

export function responseTrace(timeline, stdout, identity) {
  const responses = []; let previous = null; let previousIndex = -1;
  for (let i = 0; i < timeline.length; i++) {
    const event = timeline[i]; if (event.kind !== 'response') continue;
    const raw = event.data; const u = raw.usage ?? {};
    const inputTokens = count(u.input_tokens); const cachedInputTokens = count(u.cached_input_tokens);
    const freshInputTokens = delta(inputTokens, cachedInputTokens);
    const between = timeline.slice(previousIndex + 1, i);
    const tools = between.filter((row) => row.kind === 'item.completed' &&
      ['command_execution', 'mcp_tool_call', 'dynamic_tool_call', 'web_search'].includes(row.itemType));
    const bytes = tools.every((tool) => typeof tool.outputBytes === 'number') ?
      tools.reduce((sum, tool) => sum + tool.outputBytes, 0) : UNKNOWN;
    const current = { ...identity, threadId: raw.threadId ?? UNKNOWN, turnId: raw.turnId ?? UNKNOWN,
      responseId: raw.responseId ?? UNKNOWN, requestId: UNKNOWN, sequenceNumber: responses.length + 1,
      inputTokens, cachedInputTokens, freshInputTokens, outputTokens: count(u.output_tokens),
      reasoningTokens: count(u.reasoning_output_tokens), timestampStart: UNKNOWN,
      timestampEnd: raw.timestamp ?? event.at, localReceiptTime: event.at,
      toolCallsSincePreviousResponse: tools.length, toolOutputBytesSincePreviousResponse: bytes,
      toolsSincePreviousResponse: tools, toolOrderingConfidence: 'LOCAL_PIPE_RECEIPT',
      compactionEvent: between.find((row) => row.kind === 'compaction') ?? UNKNOWN,
      contextWindowInfo: count(raw.contextWindow), deltaInput: previous ? delta(inputTokens, previous.inputTokens) : UNKNOWN,
      deltaCached: previous ? delta(cachedInputTokens, previous.cachedInputTokens) : UNKNOWN,
      deltaFresh: previous ? delta(freshInputTokens, previous.freshInputTokens) : UNKNOWN,
      cachedRatio: typeof inputTokens === 'number' && inputTokens > 0 && typeof cachedInputTokens === 'number'
        ? cachedInputTokens / inputTokens : UNKNOWN };
    responses.push(current); previous = current; previousIndex = i;
  }
  const turn = usage(stdout); const fields = [['inputTokens', 'inputTokens'], ['cachedInputTokens', 'cachedInputTokens'],
    ['outputTokens', 'outputTokens'], ['reasoningTokens', 'reasoningOutputTokens']];
  const reconciliation = {};
  for (const [field, turnField] of fields) {
    const values = responses.map((r) => r[field]);
    const sum = values.every((v) => typeof v === 'number') && values.length ? values.reduce((a, b) => a + b, 0) : UNKNOWN;
    const total = turn[turnField];
    reconciliation[field] = { responseSum: sum, turnTotal: total,
      status: typeof sum !== 'number' || typeof total !== 'number' ? 'UNKNOWN' : sum === total ? 'EXACT_MATCH' : 'MISMATCH' };
  }
  return { responses, reconciliation, turnUsage: turn,
    unassignedTools: timeline.slice(previousIndex + 1).filter((row) => row.kind === 'item.completed'),
    observedCompactionEvents: timeline.filter((row) => row.kind === 'compaction') };
}

const fixture = { id: 'ET', risk: 'LOW',
  goal: 'Read benchmark-fixture/neutral.mjs, investigate its calculation with a shell tool, and report the computed value in the required structured result. Do not edit files.',
  fixture: { files: { 'neutral.mjs': 'export const twice = n => n * 2;\nexport const answer = twice(21);\n' } },
  failureClasses: [] };
const fixtureScorer = (_scenario, output) => ({ correct: output?.outcome === 'COMPLETE' && /42/.test(output.summary),
  falseCompletion: false, falseBlock: false, unauthorized: [], changed: [], fileFailures: [],
  validation: { status: 'NOT_APPLICABLE', hash: null }, necessaryHuman: false, unnecessaryHuman: false });

async function trial({ suite, scenario, candidate, number, mode, runRoot, binary }) {
  const result = await singleTrial(suite, scenario, candidate, number, { runRoot, kind: 'DIAGNOSTIC_EXEC_NATIVE_TELEMETRY',
    scorer: scenario.id === 'ET' ? fixtureScorer : scoreHoldout,
    adapters: { runProcess: observedRunProcess(binary, mode) } });
  const trialRoot = path.join(runRoot, `${scenario.id}-T${number}-${candidate}`);
  const attempts = fs.readdirSync(trialRoot).filter((name) => /^attempt-\d+$/.test(name)).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
  const traces = attempts.map((name) => {
    const root = path.join(trialRoot, name); const attempt = readJson(path.join(root, 'attempt.json'));
    const identity = { trialId: `${scenario.id}-T${number}-${candidate}`, attemptId: name,
      candidate, candidateSha: suite.candidates[candidate].sha, runKind: 'DIAGNOSTIC_EXEC_NATIVE_TELEMETRY' };
    const observerRoot = observerDir(root);
    const trace = responseTrace(readJson(path.join(observerRoot, 'observer-timeline.json')), fs.readFileSync(path.join(root, 'stdout.log'), 'utf8'), identity);
    write(path.join(observerRoot, 'response-trace.json'), trace);
    return { attemptId: name, classification: attempt.classification, ...trace };
  });
  return { scenarioId: scenario.id, candidate, number, mode, outcome: result.outcome, correct: result.correct,
    terminalClass: result.terminalClass, wallMs: result.timeMetrics.wallClockDurationMs,
    resultFile: path.relative(ROOT, path.join(trialRoot, 'result.json')), attempts: traces };
}

function gate(rows, capabilitiesEqual) {
  if (!capabilitiesEqual) return 'MATERIAL_DIFFERENCE';
  const all = rows.flatMap((r) => r.attempts);
  if (rows.length !== 6 || rows.some((r) => r.outcome !== 'COMPLETE' || !r.correct || r.attempts.length !== 1))
    return 'INCONCLUSIVE';
  if (all.filter((a) => a.responses.length > 0).length !== 3) return 'INCONCLUSIVE';
  if (all.some((a) => Object.values(a.reconciliation).some((r) => r.status === 'MISMATCH'))) return 'MATERIAL_DIFFERENCE';
  const signatures = rows.map((r) => {
    const root = path.join(ROOT, r.resultFile, '..', 'attempt-1');
    const events = fs.readFileSync(path.join(root, 'stdout.log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { output: readJson(path.join(root, 'final.json')).outcome, files: fs.readFileSync(path.join(root, 'worktree.diff'), 'utf8'),
      contract: readJson(path.join(observerDir(root), 'observer-contract.json')),
      commands: events.filter((event) => event.type === 'item.completed' && event.item?.type === 'command_execution')
        .map((event) => event.item.command) };
  });
  if (signatures.some((s) => s.output !== 'COMPLETE' || s.files !== '')) return 'MATERIAL_DIFFERENCE';
  if (new Set(signatures.map((s) => JSON.stringify(s.contract))).size !== 1) return 'MATERIAL_DIFFERENCE';
  const originals = signatures.filter((_, i) => rows[i].mode === 'original').map((s) => JSON.stringify(s.commands));
  const observed = signatures.filter((_, i) => rows[i].mode === 'instrumented').map((s) => JSON.stringify(s.commands));
  return new Set([...originals, ...observed]).size === 1 ? 'EXEC_EQUIVALENT' : 'INCONCLUSIVE';
}

async function main() {
  const binary = process.argv[2]; assert.ok(binary && fs.existsSync(binary), 'INSTRUMENTED_BINARY_REQUIRED');
  const { suite, freeze } = readFrozen(); assert.equal(spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim(), suite.model.runtime);
  const capabilityProbe = (command) => [ORIGINAL, binary].map((executable) => {
    const run = spawnSync(executable, command, { encoding: 'utf8' });
    return { status: run.status, stdoutSha: sha(run.stdout ?? ''), stderrSha: sha(run.stderr ?? '') };
  });
  const capabilities = { execHelp: capabilityProbe(['exec', '--help']), features: capabilityProbe(['features', 'list']) };
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const runRoot = path.join(OUT, runId); fs.mkdirSync(runRoot, { recursive: true });
  const runnerSha = sha(fs.readFileSync(fileURLToPath(import.meta.url)));
  const checkpoint = { runKind: 'DIAGNOSTIC_EXEC_NATIVE_TELEMETRY', runId, status: 'FIXTURE_RUNNING',
    runnerSha, originalSha: sha(fs.readFileSync(ORIGINAL)), instrumentedSha: sha(fs.readFileSync(binary)),
    sourceTag: 'rust-v0.155.1', sourceCommit: 'be2951ea34f0d295ed0becf97079f92fa5f6950e',
    patchSha: sha(fs.readFileSync(path.join(ROOT, 'scripts/wayper-codex-0.155.1-exec-response.patch'))),
    capabilities, freeze, order: [], completed: [] };
  const save = () => write(path.join(runRoot, 'checkpoint.json'), checkpoint);
  const checkFrozen = () => {
    assert.equal(sha(fs.readFileSync(fileURLToPath(import.meta.url))), runnerSha, 'RUNNER_CHANGED');
    assert.equal(sha(fs.readFileSync(binary)), checkpoint.instrumentedSha, 'INSTRUMENTED_BINARY_CHANGED');
  };
  save();
  for (let n = 1; n <= 3; n++) for (const mode of n % 2 ? ['original', 'instrumented'] : ['instrumented', 'original']) {
    checkFrozen();
    checkpoint.order.push({ scenarioId: 'ET', candidate: 'V1', number: n, mode }); save();
    const row = await trial({ suite, scenario: fixture, candidate: 'V1', number: n, mode,
      runRoot: path.join(runRoot, 'fixture', mode), binary });
    checkpoint.completed.push(row); save(); console.log(`${row.scenarioId}-T${n}-${mode} ${row.outcome}`);
    if (row.outcome !== 'COMPLETE') { checkpoint.status = 'FIXTURE_INCONCLUSIVE'; save(); return; }
  }
  checkpoint.equivalence = gate(checkpoint.completed,
    Object.values(capabilities).every(([a, b]) => JSON.stringify(a) === JSON.stringify(b)));
  checkpoint.status = 'FIXTURE_COMPLETE'; save();
  if (checkpoint.equivalence !== 'EXEC_EQUIVALENT') { checkpoint.status = 'TRANSPORT_NOT_EQUIVALENT'; save(); return; }
  checkpoint.status = 'DIAGNOSTIC_RUNNING'; save();
  for (let n = 1; n <= 3; n++) for (const id of ['H10', 'H11']) {
    const scenario = suite.scenarios.B.find((row) => row.id === id); assert.ok(scenario);
    for (const candidate of (n + (id === 'H11' ? 1 : 0)) % 2 ? ['V1', 'V2'] : ['V2', 'V1']) {
      checkFrozen();
      checkpoint.order.push({ scenarioId: id, candidate, number: n, mode: 'instrumented' }); save();
      const row = await trial({ suite, scenario, candidate, number: n, mode: 'instrumented',
        runRoot: path.join(runRoot, 'diagnostic'), binary });
      checkpoint.completed.push(row); save(); console.log(`${id}-T${n}-${candidate} ${row.outcome}`);
      if (row.attempts.some((a) => /CODEX_USAGE_LIMIT/.test(a.classification?.cause ?? ''))) {
        checkpoint.status = 'INFRASTRUCTURE_BLOCKED'; save(); return;
      }
    }
  }
  checkpoint.status = 'COMPLETE'; save();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => { console.error(error); process.exitCode = 1; });
