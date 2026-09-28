import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { candidatePrompt, summarizeEvents } from '../wayper-harness-provider-telemetry-experiment.mjs';
import { readFrozen } from '../wayper-harness-holdout.mjs';

const runRoot = process.argv.find((arg) => arg.startsWith('--run='))?.slice(6);
const read = (name) => JSON.parse(fs.readFileSync(path.join(runRoot, name), 'utf8'));
const rows = runRoot && fs.existsSync(path.join(runRoot, 'checkpoint.json')) ? read('checkpoint.json').completed : [];
const fixture = rows.filter((row) => row.trialId.startsWith('PTEL-'));
const execRows = fixture.filter((row) => row.transport === 'exec');
const appRows = fixture.filter((row) => row.transport === 'app');
const pair = (n) => [execRows.find((row) => row.trialId.includes(`-T${n}-`)), appRows.find((row) => row.trialId.includes(`-T${n}-`))];
const requireFixture = () => { assert.equal(execRows.length, 3); assert.equal(appRows.length, 3); };

test('PTEL1 same Goal and prompt', () => { requireFixture(); for (let n = 1; n <= 3; n++) {
  const [a, b] = pair(n); assert.equal(a.goal, b.goal); assert.equal(a.promptSha256, b.promptSha256);
  assert.equal(a.promptBytes, b.promptBytes); assert.equal(candidatePrompt({ id: 'PTEL', goal: a.goal }).includes(a.goal), true);
} });
test('PTEL2 same frozen candidate SHA', () => { requireFixture(); const { freeze } = readFrozen();
  for (const row of fixture) assert.equal(row.candidateSha, freeze.candidates.V1);
});
test('PTEL3 same source projection', () => { requireFixture(); for (let n = 1; n <= 3; n++)
  assert.deepEqual(pair(n)[0].sourceProjection, pair(n)[1].sourceProjection); });
test('PTEL4 same model', () => { requireFixture(); for (const row of fixture) assert.equal(row.model, 'gpt-6-sol'); });
test('PTEL5 same reasoning', () => { requireFixture(); for (const row of fixture) assert.equal(row.effort, 'high'); });
test('PTEL6 permissions declared on both transports', () => { const code = fs.readFileSync(fileURLToPath(new URL('../wayper-harness-provider-telemetry-experiment.mjs', import.meta.url)), 'utf8');
  assert.match(code, /'--sandbox', 'workspace-write'/); assert.match(code, /sandboxPolicy: \{ type: 'workspaceWrite'/);
  assert.match(code, /approvalPolicy: 'never'/);
});
test('PTEL7 GroundTruth invisible', () => { requireFixture(); for (const row of fixture) {
  assert.ok(Object.keys(row.sourceProjection).every((name) => !name.includes('benchmarks/') && !name.includes('holdout-score')));
  assert.ok(!row.goal.includes('groundTruth'));
} });
test('PTEL8 telemetry outside candidate workspace', () => { requireFixture(); assert.ok(!runRoot.includes('/blind-workspace/'));
  for (const row of fixture) assert.ok(!Object.keys(row.sourceProjection).some((name) => name.includes('provider-telemetry')));
});

const t = (method, params) => ({ method, params, at: '2026-09-25T00:00:00.000Z' });
const identity = { trialId: 'PTEL-T1-V1-app', attemptId: 'PTEL-T1-V1-app-attempt-1', candidate: 'V1', candidateSha: 'sha' };
const events = [
  t('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1' } }),
  t('rawResponse/completed', { threadId: 'thread-1', turnId: 'turn-1', responseId: 'r1', usage: null }),
  t('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'commandExecution', command: 'rg answer benchmark-fixture', aggregatedOutput: 'answer 42\n' } }),
  t('rawResponse/completed', { threadId: 'thread-1', turnId: 'turn-1', responseId: 'r2', usage: { inputTokens: 200, cachedInputTokens: 90, outputTokens: 12, reasoningOutputTokens: 2 } }),
  t('rawResponse/completed', { threadId: 'thread-1', turnId: 'turn-1', responseId: 'r3', usage: { inputTokens: 300, cachedInputTokens: 180, outputTokens: 10, reasoningOutputTokens: 1 } }),
];
test('PTEL9 UNKNOWN is not zero', () => { const r = summarizeEvents(events, identity).responses[0];
  assert.equal(r.inputTokens, 'UNKNOWN'); assert.equal(r.cachedInputTokens, 'UNKNOWN'); assert.equal(r.freshInputTokens, 'UNKNOWN');
});
test('PTEL10 response ordering', () => assert.deepEqual(summarizeEvents(events, identity).responses.map((r) => r.responseId), ['r1', 'r2', 'r3']));
test('PTEL11 usage belongs to response', () => { const r = summarizeEvents(events, identity).responses;
  assert.equal(r[1].inputTokens, 200); assert.equal(r[2].cachedInputTokens, 180); assert.equal(r[2].freshInputTokens, 120);
});
test('PTEL12 attempt lineage', () => assert.ok(summarizeEvents(events, identity).responses.every((r) => r.attemptId === identity.attemptId)));
test('PTEL13 failed attempts do not mix', () => { const next = { ...identity, attemptId: 'PTEL-T1-V1-app-attempt-2' };
  const a = summarizeEvents(events, identity).responses; const b = summarizeEvents(events.slice(0, 2), next).responses;
  assert.equal(a.length, 3); assert.equal(b.length, 1); assert.notEqual(a[0].attemptId, b[0].attemptId);
});
test('PTEL14 tool interval correlation', () => { const r = summarizeEvents(events, identity).responses;
  assert.equal(r[0].toolCallsSincePreviousResponse, 0); assert.equal(r[1].toolCallsSincePreviousResponse, 1);
  assert.equal(r[1].toolOutputBytesSincePreviousResponse, 10); assert.equal(r[1].toolsSincePreviousResponse[0].search, true);
  assert.equal(r[2].toolCallsSincePreviousResponse, 0);
});
test('PTEL15 transport metadata absent from candidate prompt', () => { requireFixture();
  for (const row of fixture) assert.ok(!/app-server|experimentalRawEvents|responseId|DIAGNOSTIC_PROVIDER_TELEMETRY/.test(row.goal));
});
