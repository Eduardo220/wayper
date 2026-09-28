import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { responseTrace, swapExecBinary } from '../wayper-harness-exec-native-telemetry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const run = process.argv.find((arg) => arg.startsWith('--run='))?.slice(6);
assert.ok(run && fs.existsSync(run), 'PASS --run=<fixture run directory>');
const checkpoint = JSON.parse(fs.readFileSync(path.join(run, 'checkpoint.json'), 'utf8'));
const rows = checkpoint.completed.filter((row) => row.scenarioId === 'ET');
assert.equal(rows.length, 6, '3 original and 3 instrumented fixture trials');
const original = '/home/eduardo/.codex/packages/standalone/releases/0.155.1-x86_64-unknown-linux-musl/bin/codex';
const args = ['--ro-bind', original, '/tmp/codex', '--', '/tmp/codex', 'exec', '--json', 'PROMPT'];
const replaced = swapExecBinary(args, '/outside/instrumented');
const checks = [];
function check(name, fn) { fn(); checks.push(name); console.log(`${name} PASS`); }
function attempt(row) {
  const dir = path.join(root, row.resultFile, '..', 'attempt-1');
  const observer = path.join(path.dirname(dir), 'observer-attempt-1');
  return { dir, observer, contract: JSON.parse(fs.readFileSync(path.join(observer, 'observer-contract.json'), 'utf8')),
    trace: JSON.parse(fs.readFileSync(path.join(observer, 'response-trace.json'), 'utf8')),
    output: JSON.parse(fs.readFileSync(path.join(dir, 'final.json'), 'utf8')),
    stdout: fs.readFileSync(path.join(dir, 'stdout.log'), 'utf8'),
    stderr: fs.readFileSync(path.join(dir, 'stderr.log'), 'utf8') };
}
const samples = rows.map(attempt);
const c0 = JSON.stringify(samples[0].contract);

check('ET1 observer does not alter prompt', () => {
  assert.deepEqual(replaced.slice(4), args.slice(4));
  assert.ok(samples.every((sample) => sample.contract.execArgs.at(-1) === samples[0].contract.execArgs.at(-1)));
});
check('ET2 observer does not alter tools or sandbox arguments', () => {
  assert.equal(replaced.filter((x, i) => x !== args[i]).length, 1);
  assert.ok(samples.every((s) => JSON.stringify(s.contract.sandboxArgs) === JSON.stringify(samples[0].contract.sandboxArgs)
    && s.contract.toolSidecar === samples[0].contract.toolSidecar));
});
check('ET3 source projection and visible source match', () => {
  assert.ok(samples.every((s) => JSON.stringify(s.contract.sourceManifest) === JSON.stringify(samples[0].contract.sourceManifest)));
  assert.ok(Object.keys(samples[0].contract.sourceManifest).length > 100);
});
check('ET4 frozen candidate SHA', () => {
  assert.ok(rows.every((row) => row.candidate === 'V1' && row.attempts[0].responses.every((r) => r.candidateSha === checkpoint.freeze.candidates.V1)));
});
const timeline = [
  { kind: 'response', at: '2026-01-01T00:00:00Z', data: { threadId: 't', turnId: 'u', responseId: 'r1',
    usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 1 } } },
  { kind: 'item.completed', itemId: 'tool-1', itemType: 'command_execution', command: 'cat file', outputBytes: 7 },
  { kind: 'response', at: '2026-01-01T00:00:01Z', data: { threadId: 't', turnId: 'u', responseId: 'r2',
    usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 3, reasoning_output_tokens: 1 } } },
];
const stdout = JSON.stringify({ type: 'turn.completed', usage: {
  input_tokens: 30, cached_input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 2 } }) + '\n';
const synthetic = responseTrace(timeline, stdout, { attemptId: 'attempt-1', candidate: 'V1' });
check('ET5 events belong to one attempt', () => {
  assert.ok(synthetic.responses.every((r) => r.attemptId === 'attempt-1'));
  assert.ok(rows.every((row) => row.attempts.every((a) => a.responses.every((r) => r.attemptId === a.attemptId))));
});
check('ET6 response ordering', () => assert.deepEqual(synthetic.responses.map((r) => [r.sequenceNumber, r.responseId]), [[1, 'r1'], [2, 'r2']]));
check('ET7 UNKNOWN never becomes zero', () => {
  const unknown = responseTrace([{ kind: 'response', data: { responseId: 'none', usage: null } }], '', {}).responses[0];
  assert.equal(unknown.inputTokens, 'UNKNOWN'); assert.equal(unknown.cachedInputTokens, 'UNKNOWN');
  assert.equal(unknown.freshInputTokens, 'UNKNOWN'); assert.equal(unknown.requestId, 'UNKNOWN');
});
check('ET8 retry responses remain separate', () => {
  const a = responseTrace(timeline.slice(0, 1), '', { attemptId: 'attempt-1' });
  const b = responseTrace(timeline.slice(2), '', { attemptId: 'attempt-2' });
  assert.equal(a.responses[0].attemptId, 'attempt-1'); assert.equal(b.responses[0].attemptId, 'attempt-2');
  assert.equal(b.responses[0].sequenceNumber, 1);
});
check('ET9 quota/failure retains partial trace', () => {
  const partial = responseTrace(timeline.slice(0, 1), '', { attemptId: 'attempt-quota' });
  assert.equal(partial.responses.length, 1); assert.equal(partial.reconciliation.inputTokens.status, 'UNKNOWN');
});
check('ET10 observer data is outside candidate', () => {
  assert.ok(samples.every((s) => s.observer.includes('/.wayper-context/benchmark-runs/exec-native-telemetry/')
    && !s.observer.startsWith(s.dir + '/')));
  assert.ok(samples.every((s) => !s.stderr.includes('WAYPER_EXEC_NATIVE_TELEMETRY')));
  assert.ok(!Object.keys(samples[0].contract.sourceManifest).some((name) => /observer|response-trace|groundtruth/i.test(name)));
});
check('ET11 fixture result is semantically equal', () => {
  assert.ok(rows.every((row) => row.outcome === 'COMPLETE' && row.correct && row.attempts.length === 1));
  assert.ok(samples.every((s) => s.output.outcome === 'COMPLETE' && /42/.test(s.output.summary)
    && fs.readFileSync(path.join(s.dir, 'worktree.diff'), 'utf8') === ''));
});
check('ET12 usage reconciliation', () => {
  assert.ok(Object.values(synthetic.reconciliation).every((r) => r.status === 'EXACT_MATCH'));
  assert.ok(rows.filter((r) => r.mode === 'instrumented').every((r) =>
    Object.values(r.attempts[0].reconciliation).every((v) => v.status === 'EXACT_MATCH')));
});
check('ET13 instrumentation can be disabled', () => {
  assert.ok(rows.filter((r) => r.mode === 'original').every((r) => r.attempts[0].responses.length === 0));
  assert.ok(samples.filter((_, i) => rows[i].mode === 'original').every((s) => !s.stderr.includes('WAYPER_EXEC_NATIVE_TELEMETRY')));
});
check('ET14 GroundTruth remains invisible', () => {
  assert.ok(samples.every((s) => !Object.keys(s.contract.sourceManifest).some((name) => /groundtruth|suite\.json|freeze\.json/i.test(name))));
});
check('ET15 telemetry stays out of model context', () => {
  assert.ok(samples.every((s) => !s.contract.execArgs.at(-1).includes('WAYPER_EXEC_NATIVE_TELEMETRY')));
  assert.ok(samples.every((s) => JSON.stringify(s.contract) === c0));
});
console.log(`${checks.length}/15 checks passed`);
