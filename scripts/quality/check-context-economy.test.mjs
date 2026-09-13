import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { writeWorkingContext, readWorkingContext, amendWorkingContext } from '../wayper-context.mjs';
import { queryGraph, contextEconomyAssessment, buildResolvedPacket } from '../wayper-context-economy.mjs';
import { readContextArtifact } from '../wayper-context-artifacts.mjs';
import { boundedGraphOutput, GRAPH_QUERY_LIMITS } from '../wayper-graph-query.mjs';
import { loadCapabilityFiles } from './check-capability-routing.mjs';

import { fixture } from './context-economy-fixture.mjs';
test('CE1 CE2 CE11 CE16 CE20 reuse and deterministic observed metrics', async (t) => {
  const f = fixture(t); const first = await f.resolve(); const next = await f.resolve();
  assert.equal(first.disposition, 'ACQUIRED'); assert.equal(next.disposition, 'REUSED'); assert.equal(first.artifactId, next.artifactId);
  const m = contextEconomyAssessment(f.options);
  assert.equal(m.contextRequests, 2); assert.equal(m.cacheHits, 1); assert.equal(m.cacheMisses, 1);
  assert.equal(m.duplicateAcquisitionsAvoided, 1); assert.equal(m.unobservedHostReads, 'UNKNOWN'); assert.equal(m.tokenUsage, 'UNKNOWN');
});
test('CE3 CE4 relevant dependency invalidates, unrelated source preserves slice', async (t) => {
  const f = fixture(t); const a = await f.resolve();
  fs.writeFileSync(path.join(f.root, 'src/b.js'), 'export const b = 1;'); const b = await f.resolve({ ...f.source, path: 'src/b.js' });
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 2;');
  assert.notEqual((await f.resolve()).artifactId, a.artifactId);
  assert.equal((await f.resolve({ ...f.source, path: 'src/b.js' })).artifactId, b.artifactId);
  assert.equal(contextEconomyAssessment(f.options).artifactsInvalidated, 1);
});
test('CE5 parent changes invalidate summary; cache never repairs a stale summary by assertion', async (t) => {
  const f = fixture(t); const a = await f.resolve();
  const request = { kind: 'DERIVED_SUMMARY', repository: 'wayper', parents: [a.artifactId], summary: 'a exports a constant' };
  await f.resolve(request); fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const b = 3;');
  await assert.rejects(f.resolve(request), /STALE_PARENT/);
});
test('CE6 CE7 explicit revision revalidation and wrong Goal rejection', async (t) => {
  const f = fixture(t); const a = await f.resolve();
  const state = readWorkingContext(f.root, { 'thread-id': f.identity.threadId, 'goal-run-id': f.identity.goalRunId, revision: 1 });
  const amended = amendWorkingContext({ root: f.root, repositories: f.repositories, existing: state, identity: f.identity,
    changes: { objective: 'Revised context request' }, reason: 'Explicit revision test' });
  writeWorkingContext(amended, { root: f.root, identity: amended.execution.identity });
  await assert.rejects(f.resolve(), /revision|identity|Goal/i);
  const rebound = await f.resolve(f.source, { identity: amended.execution.identity });
  assert.equal(rebound.artifactId, a.artifactId); assert.equal(rebound.binding.revalidation, 'SHARED_REVALIDATED');
  assert.equal(rebound.binding.goalReference.revision, 2);
});
test('CE12 budget / CE13 stop prevent new acquisition', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.resolve(f.source, { limits: { artifactCount: 0 } }), /CONTEXT_BUDGET/);
  assert.equal(contextEconomyAssessment(f.options).artifactsAcquired, 0);
});
test('CE14 unavailable graph falls back to explicitly scoped source / CE17 escape', async (t) => {
  const f = fixture(t);
  const result = await f.resolve({ kind: 'GRAPH_QUERY', repository: 'wayper', scope: 'repository-code-only', query: { kind: 'query', text: 'a' },
    parameters: {}, fallback: f.source });
  assert.equal(result.kind, 'SOURCE_SLICE'); assert.equal(result.graphFallback, 'UNAVAILABLE');
  await assert.rejects(f.resolve({ ...f.source, path: '../escape.js' }), /PATH/);
  fs.symlinkSync('/etc/passwd', path.join(f.root, 'src/escape.js'));
  await assert.rejects(f.resolve({ ...f.source, path: 'src/escape.js' }), /SYMLINK/);
});
test('QC1 QC3 QC4 queries canonicalized, isolated and shared between Goals', async (t) => {
  const f = fixture(t); f.refresh();
  const request = { repository: 'wayper', scope: 'repository-code-only', query: { kind: 'query', text: 'a' }, parameters: {} };
  const a = await queryGraph({ ...f.options, ...request }); const b = await queryGraph({ ...f.options, ...request });
  assert.equal(a.artifactId, b.artifactId); assert.equal(f.queryCount(), 1);
  const state = readWorkingContext(f.root, { 'thread-id': f.identity.threadId, 'goal-run-id': f.identity.goalRunId, revision: 1 });
  const ref = state.contextMap.context.artifacts.find((item) => item.artifactId === a.artifactId);
  assert.equal(ref.receiptIds.length, 1); assert.equal(state.contextMap.evidenceReceipts.find((item) =>
    item.receiptId === ref.receiptIds[0]).verification, 'VERIFIED');
  const c = await queryGraph({ ...f.options, identity: f.start('other'), ...request });
  assert.equal(c.artifactId, a.artifactId); assert.equal(c.binding.revalidation, 'SHARED_REVALIDATED');
  await queryGraph({ ...f.options, ...request, query: { kind: 'query', text: 'b' } }); assert.equal(f.queryCount(), 2);
});
test('QC2 QC6 stale graph refuses cache; refresh makes new query identity', async (t) => {
  const f = fixture(t); f.refresh();
  const request = { kind: 'GRAPH_QUERY', repository: 'wayper', scope: 'repository-code-only', query: { kind: 'query', text: 'a' }, parameters: {} };
  const a = await f.resolve(request); fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 3;');
  await assert.rejects(f.resolve(request), /STALE_CONTENT/); assert.equal(f.queryCount(), 1);
  f.refresh(); const b = await f.resolve(request); assert.notEqual(a.artifactId, b.artifactId); assert.equal(f.queryCount(), 2);
});
test('QC5 QC7 QC8 altered entry rejected, bounded content, cross-repo denied', async (t) => {
  const f = fixture(t); const a = await f.resolve();
  const file = path.join(f.root, '.wayper-context/cache/artifacts', a.artifactId + '.json');
  const value = JSON.parse(fs.readFileSync(file)); value.boundedContent = 'forged'; fs.writeFileSync(file, JSON.stringify(value));
  assert.equal((await f.resolve()).disposition, 'ACQUIRED');
  assert.ok(Buffer.byteLength(readContextArtifact(a.artifactId, f.options).boundedContent) <= 4096);
  const bounded = JSON.parse(boundedGraphOutput({ text: 'x'.repeat(50_000), nodes: Array(50).fill('n'),
    edges: Array(50).fill('e'), paths: Array(30).fill('p'), references: Array(50).fill('r') }));
  assert.equal(bounded.nodes.length, GRAPH_QUERY_LIMITS.nodes); assert.equal(bounded.edges.length, GRAPH_QUERY_LIMITS.edges);
  assert.equal(bounded.paths.length, GRAPH_QUERY_LIMITS.paths); assert.equal(bounded.references.length, GRAPH_QUERY_LIMITS.references);
  assert.ok(Object.values(bounded.truncation).every(Boolean)); assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 4096);
  await assert.rejects(f.resolve({ ...f.source, repository: 'wayper-site' }), /REPOSITORY/);
});
test('CE8 CE18 packet references resolved artifact and rejects stale packet', async (t) => {
  const f = fixture(t); const a = await f.resolve();
  const target = { type: 'validationRole', id: 'followup-review', repositories: ['wayper'], objective: 'inspect a', paths: ['wayper:src/a.js'] };
  const p = buildResolvedPacket({ ...f.options, target, registry: loadCapabilityFiles().registry });
  assert.deepEqual(p.contextArtifactRefs, [a.artifactId]); assert.ok(p.metrics.packetBytes < 6000);
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 4;');
  assert.throws(() => buildResolvedPacket({ ...f.options, target, registry: loadCapabilityFiles().registry }), /STALE|stale|CONTEXT/);
});
