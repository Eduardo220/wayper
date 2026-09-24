import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { readFrozen } from '../wayper-harness-holdout.mjs';
import { diagnosticWorklist, validateDiagnosticCheckpoint } from '../wayper-harness-diagnostic.mjs';
import { makeTrace, ORIGINS, UNKNOWN, validateTrace } from '../wayper-harness-telemetry.mjs';
import { blindInvocation, prepareBlindWorkspace, singleTrial, usage } from '../wayper-harness-benchmark-agentic.mjs';
import { addWorktree, removeWorktree, ROOT } from '../wayper-harness-benchmark.mjs';

const { suite, freeze } = readFrozen();
const scenario = suite.scenarios.B.find((item) => item.id === 'H10');
const prompt = [
  'You are executing a blind Wayper Harness benchmark trial in an isolated temporary worktree.',
  "Follow this candidate checkout's own AGENTS.md and intrinsic Harness. Do not inspect benchmark suite/results or identify the candidate.",
  'Only benchmark-fixture/ may receive product-like changes. Never edit Harness files, .git, sibling repositories, or anything outside this worktree.',
  'No physical device or real external service is available. Do not invent validation.',
  `Goal H10: ${scenario.goal}`,
  'Return the required structured result. COMPLETE is allowed only when the Goal is actually proved; use HUMAN_DECISION_REQUIRED or BLOCKED_EXTERNAL when that is the honest terminal outcome.',
].join('\n\n');
const sha = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
assert.equal(sha(prompt), 'sha256:ba47e081bfd6ed29878a3de4978ed34f95129f13d41779370a990df58c5c5737');
const events = [
  { type: 'thread.started', thread_id: 'thread-fixture' },
  { type: 'turn.started' },
  { type: 'item.started', item: { id: 'tool-1', type: 'command_execution', command: 'cat source' } },
  { type: 'item.completed', item: { id: 'tool-1', type: 'command_execution', aggregated_output: 'same output\n' } },
  { type: 'item.started', item: { id: 'tool-2', type: 'command_execution', command: 'cat source' } },
  { type: 'item.completed', item: { id: 'tool-2', type: 'command_execution', aggregated_output: 'same output\n' } },
  { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 5, reasoning_output_tokens: 2 } },
].map(JSON.stringify).join('\n');
const input = { runId: 'diagnostic-1', trialId: 'H10-T1', attemptId: 'H10-T1-V1-attempt-1', candidate: 'V1',
  candidateSha: freeze.candidates.V1, goalId: 'H10', risk: 'CRITICAL', model: 'gpt-6-sol', reasoningEffort: 'high',
  cliVersion: 'codex-cli 0.155.1', prompt, jsonl: events, complete: true,
  sourceProjection: [{ origin: 'AGENTS', source: 'AGENTS.md', content: 'policy' },
    { origin: 'SOURCE', source: 'benchmark-fixture/session.mjs', content: 'source' }] };

test('OT1 OT2 OT3 OT14: UNKNOWN survives and usage belongs to its own attempt', () => {
  const a = makeTrace(input); const b = makeTrace({ ...input, attemptId: 'H10-T1-V1-attempt-2', jsonl: '' , complete: false });
  assert.equal(a.modelCallCount, UNKNOWN); assert.equal(a.modelCallTokens, UNKNOWN);
  assert.equal(a.context.totalBytes, UNKNOWN); assert.equal(a.compaction, UNKNOWN);
  assert.equal(a.agent.projectOwnedSpecialistSpawns, UNKNOWN);
  assert.equal(a.usage[0].inputTokens, 100); assert.equal(a.usage[0].cachedInputTokens, 40);
  assert.equal(b.usage.length, 0); assert.equal(b.status, 'INCOMPLETE');
  assert.notEqual(a.attemptId, b.attemptId);
  assert.equal(makeTrace({ ...input, jsonl: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) }).usage[0].cachedInputTokens, UNKNOWN);
  assert.equal(usage(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })).cachedInputTokens, UNKNOWN);
});

test('OT4 OT5 OT6 OT15: hashes, origins, tool output and schema are deterministic', () => {
  const a = makeTrace(input); const b = makeTrace(input);
  assert.deepEqual(a, b); assert.equal(validateTrace(a), true);
  assert.deepEqual(a.context.sourceProjection.map((item) => item.origin), ['AGENTS', 'SOURCE']);
  assert.equal(a.context.components[4].origin, 'GOAL');
  assert.equal(a.tools.observedCalls, 2); assert.equal(a.tools.outputs[0].outputBytes, Buffer.byteLength('same output\n'));
  assert.equal(a.tools.outputs[0].outputHash, sha('same output\n'));
  assert.equal(a.tools.outputs[1].reused, true);
  assert.equal(a.tools.outputs[1].firstOccurrence, a.tools.outputs[0].eventId);
  assert.equal(a.tools.outputs[0].nextModelCall, UNKNOWN);
  assert.deepEqual(ORIGINS.includes('INTERNAL_UNKNOWN'), true);
  assert.throws(() => validateTrace({ ...a, schemaVersion: 2 }), /INVALID_TRACE_SCHEMA/);
  assert.throws(() => validateTrace({ ...a, context: { ...a.context, components: [{ ...a.context.components[0], origin: 'NOPE' }] } }),
    /INVALID_TRACE_COMPONENT/);
});

test('OT7 OT8: telemetry and GroundTruth remain outside the blind candidate workspace', () => {
  for (const candidate of Object.values(freeze.candidates)) {
    assert.notEqual(spawnSync('git', ['cat-file', '-e', `${candidate}:scripts/wayper-harness-telemetry.mjs`], { cwd: ROOT }).status, 0);
  }
  const item = addWorktree(freeze.candidates.V2, 'ot-blind');
  try {
    const workspace = prepareBlindWorkspace(item);
    for (const name of ['scripts/wayper-harness-telemetry.mjs', 'scripts/wayper-harness-diagnostic.mjs',
      'docs/ai/benchmarks/harness-holdout/suite.json', 'docs/ai/benchmarks/harness-holdout/freeze.json']) {
      assert.equal(fs.existsSync(path.join(workspace, name)), false, name);
    }
    const runtime = path.join(item.parent, 'trace-runtime'); fs.mkdirSync(runtime);
    fs.writeFileSync(path.join(runtime, 'trace.json'), 'internal telemetry');
    const args = blindInvocation(workspace, runtime, '/bin/sh', ['-c', 'test ! -e /tmp/workspace/scripts/wayper-harness-telemetry.mjs && test ! -e /home/eduardo/Wayper/wayper/docs/ai/benchmarks/harness-holdout/suite.json']);
    const run = spawnSync('bwrap', args, { cwd: workspace, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  } finally { removeWorktree(item); }
});

test('OT9 OT10: runner passes the frozen holdout prompt and candidate SHA', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-ot-invocation-'));
  let invocation;
  try {
    const row = await singleTrial(suite, scenario, 'V1', 1, { runRoot: root,
      adapters: { runProcess: async (_command, args, options) => {
        invocation = args;
        fs.writeFileSync(options.stdoutPath, `${JSON.stringify({ type: 'turn.completed',
          usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } })}\n`);
        fs.writeFileSync(path.join(path.dirname(options.stdoutPath), 'final.json'), JSON.stringify({
          outcome: 'FAILED', summary: 'fixture', humanIntervention: false, validation: [],
        }));
        return { status: 0, signal: null, error: null, stdout: '', stderr: '', durationMs: 1 };
      } } });
    assert.equal(row.candidateSha, freeze.candidates.V1);
    assert.equal(invocation.at(-1), prompt);
    const record = JSON.parse(fs.readFileSync(path.join(root, 'H10-T1-V1/attempt-1/attempt.json')));
    assert.equal(record.invocation.promptHash, sha(prompt));
    assert.equal(record.invocation.checkoutSha, freeze.candidates.V1);
    assert.equal(record.telemetryTrace.hash, sha(fs.readFileSync(record.telemetryTrace.path)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('OT11 OT12: checkpoint and quota keep distinct partial telemetry lineage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-ot-retry-'));
  const isolated = structuredClone(suite); isolated.budgets.maxInfrastructureRetries = 0;
  try {
    const blocked = await singleTrial(isolated, scenario, 'V1', 1, { runRoot: root,
      adapters: { addWorktree: () => { throw new Error('synthetic quota setup'); } } });
    const ref = blocked.telemetry.attempts[0]; const trace = JSON.parse(fs.readFileSync(ref.path));
    assert.equal(trace.status, 'INCOMPLETE'); assert.equal(trace.modelCallCount, UNKNOWN);
    assert.equal(ref.hash, sha(fs.readFileSync(ref.path)));
    const checkpoint = { kind: 'DIAGNOSTIC_REPLAY', runId: 'synthetic', status: 'INFRASTRUCTURE_BLOCKED', freeze,
      runnerSha: 'same', telemetryHash: 'same', repetitions: 3, completed: [] };
    assert.equal(validateDiagnosticCheckpoint(checkpoint, { runId: 'synthetic', freeze, runnerSha: 'same', telemetryHash: 'same', repetitions: 3 }), true);
    assert.throws(() => validateDiagnosticCheckpoint(checkpoint, { runId: 'synthetic', freeze, runnerSha: 'changed', telemetryHash: 'same', repetitions: 3 }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('OT12: quota interruption persists a partial trace with observed events', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-ot-quota-'));
  const isolated = structuredClone(suite); isolated.budgets.maxInfrastructureRetries = 0;
  try {
    const blocked = await singleTrial(isolated, scenario, 'V1', 1, { runRoot: root, kind: 'DIAGNOSTIC_REPLAY',
      adapters: { runProcess: async (_command, _args, options) => {
        fs.writeFileSync(options.stdoutPath, `${JSON.stringify({ type: 'thread.started', thread_id: 'quota-thread' })}\n${JSON.stringify({
          type: 'error', message: "You've hit your usage limit. Try again later." })}\n`);
        fs.writeFileSync(options.stderrPath, '');
        return { status: 1, signal: null, error: null, stdout: `${JSON.stringify({ type: 'error',
          message: "You've hit your usage limit. Try again later." })}\n`, stderr: '', durationMs: 1 };
      } } });
    assert.match(blocked.infrastructureDiagnostic.cause, /^CODEX_USAGE_LIMIT:/);
    const ref = blocked.telemetry.attempts[0]; const trace = JSON.parse(fs.readFileSync(ref.path));
    assert.equal(trace.runKind, 'DIAGNOSTIC_REPLAY'); assert.equal(trace.status, 'INCOMPLETE');
    assert.equal(trace.threadId, 'quota-thread'); assert.equal(trace.usage.length, 0);
    assert.equal(trace.modelCallCount, UNKNOWN);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('OT13: trusted project-owned specialist spawn is counted; absent source remains UNKNOWN', () => {
  const trace = makeTrace({ ...input, projectEvents: [{ type: 'specialist_spawn', agentId: 'reviewer-1', role: 'reviewer',
    parent: 'main', depth: 1, timestamp: '2026-09-24T00:00:00Z' },
  { type: 'mechanism_activation', mechanism: 'Dispatch', reasonCode: 'ROUTER_SELECTED' }] });
  assert.equal(trace.agent.projectOwnedSpecialistSpawns, 1);
  assert.equal(trace.events.find((event) => event.eventType === 'specialist_spawn').agent.role, 'reviewer');
  assert.equal(trace.mechanisms.Dispatch.status, 'ACTIVATED');
  assert.equal(makeTrace(input).mechanisms.Dispatch.status, 'UNKNOWN');
});

test('diagnostic worklist alternates V1/V2 and stays separate from holdout', () => {
  const tasks = diagnosticWorklist(suite);
  assert.equal(tasks.length, 12);
  assert.deepEqual(tasks.slice(0, 2).map((task) => task.candidate), ['V1', 'V2']);
  assert.deepEqual(tasks.slice(2, 4).map((task) => task.candidate), ['V2', 'V1']);
  assert.equal(suite.scenarios.B.find((item) => item.id === 'H10').repetitions, 3);
  assert.equal(freeze.candidates.V1, '2db95d40567564cf3bb6727096b81d448b1dd765');
  assert.equal(freeze.candidates.V2, '7adb4f1e7970ff79a0848c763207109416c6db1d');
});

test('controlled overhead: trace processing adds no candidate input or tool calls', () => {
  const before = process.hrtime.bigint(); const old = usage(events); const oldMs = Number(process.hrtime.bigint() - before) / 1e6;
  const start = process.hrtime.bigint(); const trace = makeTrace(input); const traceMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(old.inputTokens, 100); assert.equal(trace.usage[0].inputTokens, 100);
  assert.equal(trace.tools.observedCalls, 2);
  assert.equal(trace.context.components.filter((item) => item.visibility === 'EXPLICIT_PROMPT').map((item) => item.bytes).reduce((a, b) => a + b, 0),
    prompt.split('\n\n').reduce((a, b) => a + Buffer.byteLength(b), 0));
  assert.ok(traceMs < 1000, `trace processing ${traceMs}ms; baseline ${oldMs}ms`);
  assert.ok(Buffer.byteLength(JSON.stringify(trace)) > 0);
});
