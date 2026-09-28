import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addWorktree, removeWorktree, ROOT } from './wayper-harness-benchmark.mjs';
import { blindInvocation, prepareBlindWorkspace, OUTPUT_SCHEMA, parseCandidateOutput, runProcess, usage } from './wayper-harness-benchmark-agentic.mjs';
import { readFrozen } from './wayper-harness-holdout.mjs';

const UNKNOWN = 'UNKNOWN';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_OUT = path.join(ROOT, '.wayper-context/benchmark-runs/provider-telemetry');
const BINARY = '/home/eduardo/.codex/packages/standalone/releases/0.155.1-x86_64-unknown-linux-musl/bin/codex';
const CW = '/tmp/workspace';
const CR = '/tmp/runtime';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
function visibleFiles(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(root, full)] = sha(fs.readFileSync(full));
    }
  };
  walk(root); return files;
}
const fixture = { id: 'PTEL', risk: 'LOW', goal: 'Read benchmark-fixture/neutral.mjs, investigate its calculation with one shell tool, and report the computed value in the required structured result. Do not edit files.',
  fixture: { files: { 'neutral.mjs': 'export const twice = n => n * 2;\nexport const answer = twice(21);\n' } } };

export function candidatePrompt(scenario) {
  return [
    'You are executing a blind Wayper Harness benchmark trial in an isolated temporary worktree.',
    "Follow this candidate checkout's own AGENTS.md and intrinsic Harness. Do not inspect benchmark suite/results or identify the candidate.",
    'Only benchmark-fixture/ may receive product-like changes. Never edit Harness files, .git, sibling repositories, or anything outside this worktree.',
    'No physical device or real external service is available. Do not invent validation.',
    `Goal ${scenario.id}: ${scenario.goal}`,
    'Return the required structured result. COMPLETE is allowed only when the Goal is actually proved; use HUMAN_DECISION_REQUIRED or BLOCKED_EXTERNAL when that is the honest terminal outcome.',
  ].join('\n\n');
}

export function summarizeEvents(events, identity) {
  const responses = []; let tools = []; let last = null; let contextWindowInfo = UNKNOWN;
  let compactionEvent = UNKNOWN; let threadId = UNKNOWN; let turnId = UNKNOWN; let terminal = UNKNOWN;
  for (const row of events) {
    const { method, params = {}, at } = row;
    if (params.threadId) threadId = params.threadId;
    if (params.turnId) turnId = params.turnId;
    if (method === 'turn/started') turnId = params.turn?.id ?? turnId;
    if (method === 'thread/tokenUsage/updated') contextWindowInfo = params.tokenUsage?.modelContextWindow ?? UNKNOWN;
    if (method === 'thread/compacted' || params.item?.type === 'contextCompaction') compactionEvent = { method, at };
    if (method === 'item/completed' && ['commandExecution', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'fileChange'].includes(params.item?.type)) {
      const item = params.item;
      const body = item.aggregatedOutput ?? item.result ?? item.content ?? UNKNOWN;
      const command = item.command ?? item.name ?? UNKNOWN;
      tools.push({ type: item.type, command, outputBytes: body === UNKNOWN ? UNKNOWN : Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)),
        fileRead: /\b(cat|sed|head|tail)\b/.test(String(command)), search: /\brg\b/.test(String(command)),
        test: /\b(node --test|npm test|jest)\b/.test(String(command)) });
    }
    if (method === 'rawResponse/completed') {
      const u = params.usage ?? {};
      const get = (key) => Number.isSafeInteger(u[key]) ? u[key] : UNKNOWN;
      const inputTokens = get('inputTokens'); const cachedInputTokens = get('cachedInputTokens');
      const freshInputTokens = typeof inputTokens === 'number' && typeof cachedInputTokens === 'number' ? inputTokens - cachedInputTokens : UNKNOWN;
      const totalToolBytes = tools.every((t) => typeof t.outputBytes === 'number') ? tools.reduce((n, t) => n + t.outputBytes, 0) : UNKNOWN;
      const delta = (key) => last && typeof last[key] === 'number' && typeof ({ inputTokens, cachedInputTokens, freshInputTokens })[key] === 'number'
        ? ({ inputTokens, cachedInputTokens, freshInputTokens })[key] - last[key] : UNKNOWN;
      const current = { ...identity, threadId, turnId, responseId: params.responseId ?? UNKNOWN, requestId: UNKNOWN,
        sequenceNumber: responses.length + 1, inputTokens, cachedInputTokens, freshInputTokens,
        outputTokens: get('outputTokens'), reasoningTokens: get('reasoningOutputTokens'),
        timestampStart: UNKNOWN, timestampEnd: at, toolCallsSincePreviousResponse: tools.length,
        toolOutputBytesSincePreviousResponse: totalToolBytes, toolsSincePreviousResponse: tools,
        compactionEvent, contextWindowInfo, deltaInput: delta('inputTokens'),
        deltaCached: delta('cachedInputTokens'), deltaFresh: delta('freshInputTokens'),
        cachedRatio: typeof inputTokens === 'number' && inputTokens > 0 && typeof cachedInputTokens === 'number' ? cachedInputTokens / inputTokens : UNKNOWN };
      responses.push(current); last = current; tools = []; compactionEvent = UNKNOWN;
    }
    if (method === 'turn/completed') terminal = params.turn?.status ?? UNKNOWN;
  }
  return { responses, remainingTools: tools, terminal, threadId, turnId };
}

function appRun(args, { cwd, env, prompt, timeoutMs, logPath }) {
  return new Promise((resolve) => {
    const started = Date.now(); const events = []; let finalText = null; let threadId = null; let turnId = null;
    let error = null; let timedOut = false; let settled = false;
    const child = spawn('bwrap', args, { cwd, env: { ...process.env, WAYPER_BENCHMARK: '1', ...env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const send = (id, method, params) => child.stdin.write(`${JSON.stringify({ ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) })}\n`);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }, timeoutMs);
    let buffer = ''; let stderr = '';
    child.stderr.on('data', (part) => { stderr += part.toString(); });
    child.stdout.on('data', (part) => {
      buffer += part.toString(); let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let row; try { row = JSON.parse(line); } catch { error = 'INVALID_APP_JSON'; continue; }
        if (row.id === 1) { if (row.error) error = row.error.message; else {
          send(null, 'initialized'); send(2, 'thread/start', { cwd: CW, model: 'gpt-6-sol', sandbox: 'workspace-write',
            ephemeral: true, experimentalRawEvents: true }); } }
        else if (row.id === 2) { if (row.error) error = row.error.message; else {
          threadId = row.result?.thread?.id; send(3, 'turn/start', { threadId, input: [{ type: 'text', text: prompt }],
            cwd: CW, model: 'gpt-6-sol', effort: 'high', approvalPolicy: 'never',
            sandboxPolicy: { type: 'workspaceWrite', writableRoots: [CW], networkAccess: false }, outputSchema: OUTPUT_SCHEMA }); } }
        else if (row.id === 3 && row.error) error = row.error.message;
        if (!row.method) continue;
        if (row.method === 'turn/started') turnId = row.params?.turn?.id;
        if (row.method === 'item/completed' && row.params?.item?.type === 'agentMessage' && row.params.item.phase === 'final_answer') finalText = row.params.item.text;
        if (['rawResponse/completed', 'rawResponseItem/completed', 'thread/tokenUsage/updated', 'thread/compacted', 'turn/started', 'turn/completed', 'turn/failed',
          'item/completed', 'account/rateLimits/updated', 'model/rerouted'].includes(row.method)) {
          const p = row.params ?? {};
          const safe = row.method === 'rawResponseItem/completed' ? { threadId: p.threadId, turnId: p.turnId,
            item: { type: p.item?.type ?? UNKNOWN, role: p.item?.role ?? UNKNOWN,
              contentBytes: Buffer.byteLength(JSON.stringify(p.item?.content ?? '')) } }
            : row.method === 'rawResponse/completed' ? { threadId: p.threadId, turnId: p.turnId,
              responseId: p.responseId ?? UNKNOWN, usage: p.usage ?? null }
            : row.method === 'item/completed' ? { threadId: p.threadId, turnId: p.turnId, item: p.item?.type === 'agentMessage'
            ? { type: p.item.type, phase: p.item.phase, text: p.item.phase === 'final_answer' ? p.item.text : UNKNOWN }
            : p.item?.type === 'contextCompaction' ? { type: 'contextCompaction' }
              : { type: p.item?.type, command: p.item?.command ?? p.item?.name ?? UNKNOWN,
                aggregatedOutput: p.item?.aggregatedOutput ?? p.item?.result ?? UNKNOWN } }
            : row.method === 'account/rateLimits/updated' ? { rateLimitReachedType: p.rateLimits?.rateLimitReachedType ?? UNKNOWN } : p;
          events.push({ method: row.method, params: safe, at: new Date().toISOString() });
        }
        if (row.method === 'turn/completed' || row.method === 'turn/failed') child.kill('SIGTERM');
      }
    });
    child.on('error', (e) => { error = e.message; });
    child.on('close', (status, signal) => {
      if (settled) return; settled = true; clearTimeout(timer);
      write(logPath, events); resolve({ status, signal, error, timedOut, durationMs: Date.now() - started,
        events, finalText, threadId, turnId, stderr: stderr.slice(-8000) });
    });
    send(1, 'initialize', { clientInfo: { name: 'wayper_provider_telemetry', title: 'Wayper provider telemetry', version: '0.1.0' },
      capabilities: { experimentalApi: true } });
  });
}

export async function runOne({ runRoot, scenario, candidate = 'V1', trial = 1, transport = 'app' }) {
  const { suite, freeze } = readFrozen();
  assert.equal(sha(fs.readFileSync(HERE + '/wayper-harness-provider-telemetry-experiment.mjs')), globalThis.PTEL_RUNNER_SHA ?? sha(fs.readFileSync(HERE + '/wayper-harness-provider-telemetry-experiment.mjs')), 'RUNNER_CHANGED');
  assert.equal(spawnSync(BINARY, ['--version'], { encoding: 'utf8' }).stdout.trim(), suite.model.runtime);
  const trialId = `${scenario.id}-T${trial}-${candidate}-${transport}`; const out = path.join(runRoot, trialId);
  assert.equal(fs.existsSync(out), false, 'TRIAL_ALREADY_EXISTS'); fs.mkdirSync(out, { recursive: true });
  const item = addWorktree(suite.candidates[candidate].sha, trialId.toLowerCase());
  try {
    assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: item.directory, encoding: 'utf8' }).stdout.trim(), freeze.candidates[candidate]);
    const workspace = prepareBlindWorkspace(item); const fixtureRoot = path.join(workspace, 'benchmark-fixture'); fs.mkdirSync(fixtureRoot);
    for (const [name, content] of Object.entries(scenario.fixture.files)) {
      const dest = path.resolve(fixtureRoot, name); assert.ok(dest.startsWith(`${fixtureRoot}/`));
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, content);
    }
    const source = visibleFiles(workspace);
    const prompt = candidatePrompt(scenario); const attempt = path.join(out, 'attempt-1'); fs.mkdirSync(attempt);
    fs.mkdirSync(path.join(attempt, 'tmp')); fs.mkdirSync(path.join(attempt, 'cache'));
    write(path.join(attempt, 'output-schema.json'), OUTPUT_SCHEMA);
    const env = { HOME: '/home/eduardo', CODEX_HOME: '/home/eduardo/.codex', TMPDIR: `${CR}/tmp`,
      XDG_CACHE_HOME: `${CR}/cache`, WAYPER_BENCHMARK_RUNTIME: CR };
    const base = { trialId, attemptId: `${trialId}-attempt-1`, candidate, candidateSha: freeze.candidates[candidate],
      goal: scenario.goal, model: suite.model.name, effort: suite.model.effort, cliVersion: suite.model.runtime,
      promptBytes: Buffer.byteLength(prompt), promptSha256: sha(prompt), sourceProjection: source,
      outputSchemaSha256: sha(JSON.stringify(OUTPUT_SCHEMA)), transport, runKind: 'DIAGNOSTIC_PROVIDER_TELEMETRY' };
    let run; let final;
    if (transport === 'exec') {
      const args = ['exec', '--ignore-user-config', '--ephemeral', '--json', '--model', suite.model.name,
        '-c', `model_reasoning_effort=${JSON.stringify(suite.model.effort)}`, '--sandbox', 'workspace-write',
        '--output-schema', `${CR}/output-schema.json`, '--output-last-message', `${CR}/final.json`, '--cd', CW, prompt];
      run = await runProcess('bwrap', blindInvocation(workspace, attempt, BINARY, args), { cwd: workspace,
        timeoutMs: suite.budgets.maxRuntimeSeconds * 1000, stdoutPath: path.join(attempt, 'stdout.log'),
        stderrPath: path.join(attempt, 'stderr.log'), env });
      final = parseCandidateOutput(path.join(attempt, 'final.json'));
      run.tokenMetrics = usage(fs.readFileSync(path.join(attempt, 'stdout.log'), 'utf8'));
    } else {
      assert.equal(transport, 'app');
      const args = ['app-server', '-c', 'model_reasoning_effort="high"'];
      run = await appRun(blindInvocation(workspace, attempt, BINARY, args), { cwd: workspace, env, prompt,
        timeoutMs: suite.budgets.maxRuntimeSeconds * 1000, logPath: path.join(attempt, 'events.json') });
      fs.writeFileSync(path.join(attempt, 'final.json'), run.finalText ?? '');
      final = parseCandidateOutput(path.join(attempt, 'final.json'));
      run.trace = summarizeEvents(run.events, { ...base, attemptId: base.attemptId });
      write(path.join(attempt, 'response-trace.json'), run.trace);
    }
    const diff = spawnSync('git', ['diff', '--binary'], { cwd: workspace, encoding: 'utf8' }).stdout;
    fs.writeFileSync(path.join(attempt, 'worktree.diff'), diff);
    const status = run.timedOut ? 'TIMEOUT' : run.error || transport === 'app' && run.trace.terminal !== 'completed'
      ? 'INFRA_FAILURE' : final.error ? 'OUTPUT_FAILURE' : 'COMPLETE';
    const result = { ...base, status, error: run.error ?? final.error ?? null, durationMs: run.durationMs,
      output: final.output, diffSha256: sha(diff), diffBytes: Buffer.byteLength(diff),
      responseCount: run.trace?.responses.length ?? UNKNOWN, tokenMetrics: run.tokenMetrics ?? UNKNOWN,
      threadId: run.threadId ?? UNKNOWN, turnId: run.turnId ?? UNKNOWN,
      observerEffectRisk: transport === 'app' ? ['app-server client identity', 'experimentalRawEvents', 'different session boot path', 'no --ignore-user-config flag'] : [] };
    write(path.join(out, 'result.json'), result); return result;
  } finally { removeWorktree(item); }
}

async function main() {
  const { suite, freeze } = readFrozen();
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const runRoot = path.join(ROOT_OUT, runId); fs.mkdirSync(runRoot, { recursive: true });
  const runnerSha = sha(fs.readFileSync(fileURLToPath(import.meta.url))); globalThis.PTEL_RUNNER_SHA = runnerSha;
  const checkpoint = { runKind: 'DIAGNOSTIC_PROVIDER_TELEMETRY', runId, runnerSha, freeze, status: 'FIXTURE_RUNNING', completed: [] };
  write(path.join(runRoot, 'checkpoint.json'), checkpoint);
  for (let n = 1; n <= 3; n++) for (const transport of n % 2 ? ['exec', 'app'] : ['app', 'exec']) {
    assert.equal(sha(fs.readFileSync(fileURLToPath(import.meta.url))), runnerSha, 'RUNNER_CHANGED');
    const result = await runOne({ runRoot, scenario: fixture, trial: n, transport }); checkpoint.completed.push(result);
    write(path.join(runRoot, 'checkpoint.json'), checkpoint); console.log(`${result.trialId} ${result.status}`);
    if (result.status !== 'COMPLETE') { checkpoint.status = 'FIXTURE_INCONCLUSIVE'; write(path.join(runRoot, 'checkpoint.json'), checkpoint); return; }
  }
  const execRows = checkpoint.completed.filter((r) => r.transport === 'exec');
  const appRows = checkpoint.completed.filter((r) => r.transport === 'app');
  const sameInputs = checkpoint.completed.every((r) => r.candidateSha === execRows[0].candidateSha && r.goal === execRows[0].goal &&
    r.promptSha256 === execRows[0].promptSha256 && JSON.stringify(r.sourceProjection) === JSON.stringify(execRows[0].sourceProjection) &&
    r.model === execRows[0].model && r.effort === execRows[0].effort && r.outputSchemaSha256 === execRows[0].outputSchemaSha256);
  const semantic = checkpoint.completed.every((r) => r.output?.outcome === 'COMPLETE' && /42/.test(r.output.summary) && r.diffBytes === 0);
  checkpoint.transport = !sameInputs || !semantic ? 'MATERIAL_DIFFERENCE' : 'INCONCLUSIVE';
  checkpoint.observerEffectRisk = true; checkpoint.status = 'FIXTURE_COMPLETE'; write(path.join(runRoot, 'checkpoint.json'), checkpoint);
  if (checkpoint.transport !== 'EQUIVALENT') { checkpoint.status = 'TRANSPORT_NOT_EQUIVALENT'; write(path.join(runRoot, 'checkpoint.json'), checkpoint); return; }
  checkpoint.status = 'DIAGNOSTIC_RUNNING'; write(path.join(runRoot, 'checkpoint.json'), checkpoint);
  for (let n = 1; n <= 3; n++) for (const id of ['H10', 'H11']) {
    const scenario = suite.scenarios.B.find((row) => row.id === id); assert.ok(scenario);
    for (const candidate of (n + (id === 'H11' ? 1 : 0)) % 2 ? ['V1', 'V2'] : ['V2', 'V1']) {
      assert.equal(sha(fs.readFileSync(fileURLToPath(import.meta.url))), runnerSha, 'RUNNER_CHANGED');
      const result = await runOne({ runRoot, scenario, candidate, trial: n, transport: 'app' });
      checkpoint.completed.push(result); write(path.join(runRoot, 'checkpoint.json'), checkpoint);
      console.log(`${result.trialId} ${result.status}`);
      if (result.status !== 'COMPLETE') { checkpoint.status = result.error && /usage limit/i.test(result.error) ? 'INFRASTRUCTURE_BLOCKED' : 'DIAGNOSTIC_INCOMPLETE';
        write(path.join(runRoot, 'checkpoint.json'), checkpoint); return; }
    }
  }
  checkpoint.status = 'COMPLETE'; write(path.join(runRoot, 'checkpoint.json'), checkpoint);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 1; });
