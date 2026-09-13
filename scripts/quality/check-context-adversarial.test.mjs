import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './context-economy-fixture.mjs';
import { graphFixture } from './graph-context-fixture.mjs';
import { contextOwner, buildResolvedPacket, contextEconomyAssessment } from '../wayper-context-economy.mjs';
import { feedbackDiscoveryContext } from '../wayper-feedback-context.mjs';
import { canonicalGraphQuery, boundedGraphOutput } from '../wayper-graph-query.mjs';
import { validateContextPacket } from '../wayper-context-packet.mjs';
import { validateContextArtifact, readContextArtifact } from '../wayper-context-artifacts.mjs';
import { proveWorkingContext, writeWorkingContext, refreshWorkingContext, contextDecision } from '../wayper-context.mjs';
import { proveFixture } from './evidence-fixture.mjs';
import { loadCapabilityFiles } from './check-capability-routing.mjs';
import { digest } from '../wayper-validation-policy.mjs';

test('CE9 CE10 Feedback SAME_ROOT fresh scope reuse; INDEPENDENT and UNKNOWN stay conservative', async (t) => {
  const f = fixture(t); const a = await f.resolve();
  const failure = { failureId: 'F2', relatedFindingIds: [], repository: 'wayper' };
  const session = { attempts: [{ failureId: 'F1', action: { paths: ['src/a.js'] }, lineage: [{ failureId: 'F2', relatedFailureId: 'F1', relation: 'SAME_ROOT' }] }] };
  assert.deepEqual(feedbackDiscoveryContext(session, contextOwner(f.options), failure).contextArtifactRefs, [a.artifactId]);
  session.attempts[0].lineage[0].relation = 'INDEPENDENT';
  assert.deepEqual(feedbackDiscoveryContext(session, contextOwner(f.options), failure).contextArtifactRefs, []);
  session.attempts[0].lineage[0].relation = 'UNKNOWN';
  assert.deepEqual(feedbackDiscoveryContext(session, contextOwner(f.options), failure).contextArtifactRefs, []);
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 7;');
  session.attempts[0].lineage[0].relation = 'SAME_ROOT';
  const stale = feedbackDiscoveryContext(session, contextOwner(f.options), failure);
  assert.deepEqual(stale.contextArtifactRefs, []); assert.deepEqual(stale.staleContextArtifactRefs, [a.artifactId]);
  assert.equal((await f.resolve()).readStrategy, 'DIFF_BEFORE_FILE');
});
test('CE13 actual STOP_WHEN_PROVEN blocks optional discovery; CE15 cache/Graphify is not Evidence', async (t) => {
  const f = fixture(t); const a = await f.resolve();
  let state = contextOwner(f.options).state;
  assert.throws(() => proveWorkingContext(state, { artifact: 'src/a.js', evidence: a.artifactId }, f.options), /Evidence Receipt/);
  state = refreshWorkingContext({ ...f.options, repositories: f.repositories, existing: state, specs: ['src/a.js'] });
  // A new explicit Goal definition is required to add success requirements.
  const { amendWorkingContext } = await import('../wayper-context.mjs');
  state = amendWorkingContext({ ...f.options, existing: state, repositories: f.repositories,
    changes: { requirements: { add: ['SUCCESS:context-proof'] } }, reason: 'Exercise evidence-gated stop' });
  const options = { root: f.root, repositories: f.repositories, identity: state.execution.identity };
  writeWorkingContext(state, options);
  state = proveFixture(state, { artifact: 'src/a.js' }, options);
  state = proveFixture(state, { requirement: 'SUCCESS:context-proof' }, options);
  writeWorkingContext(state, options);
  assert.equal(contextDecision(state, options), 'STOP_WHEN_PROVEN');
  const persisted = contextOwner({ ...f.options, identity: options.identity });
  assert.equal(contextDecision(persisted.state, persisted), 'STOP_WHEN_PROVEN');
  await assert.rejects(f.resolve({ kind: 'DOCUMENT_SLICE', repository: 'wayper', path: '.gitignore', range: null },
    { identity: options.identity }), /STOP_CONTEXT_EXPANSION/);
  assert.equal(contextEconomyAssessment(options).artifactsAcquired, 0);
});
test('QC canonical structured params, arbitrary prose not semantically collapsed; oversized output truncated', () => {
  assert.deepEqual(canonicalGraphQuery({ kind: 'query', text: 'a' }, { contexts: ['x', 'y'] }),
    canonicalGraphQuery({ text: 'a', kind: 'query' }, { contexts: ['y', 'x', 'x'], dfs: false }));
  assert.notDeepEqual(canonicalGraphQuery({ kind: 'query', text: 'find a' }), canonicalGraphQuery({ kind: 'query', text: 'locate a' }));
  assert.throws(() => canonicalGraphQuery({ kind: 'query', text: 'a' }, { shell: true }), /INVALID/);
  const bounded = boundedGraphOutput('x'.repeat(50_000));
  assert.ok(Buffer.byteLength(bounded) <= 4096); assert.equal(JSON.parse(bounded).truncated, true);
});
test('CE19 multi-repo same path never leaks into mobile Packet; stale Packet validation rejects', async (t) => {
  const f = fixture(t); const a = await f.resolve(); const other = graphFixture(t, 'wayper-site');
  await assert.rejects(f.resolve({ ...f.source, repository: 'wayper-site' }), /REPOSITORY/);
  const p = buildResolvedPacket({ ...f.options, target: { type: 'validationRole', id: 'followup-review', repositories: ['wayper'],
    paths: ['wayper:src/a.js'], objective: 'verify isolation' }, registry: loadCapabilityFiles().registry });
  const owner = contextOwner(f.options);
  const options = { contextMap: owner.state.contextMap, registry: loadCapabilityFiles().registry, repositoryDefinitions: f.repositories };
  assert.equal(validateContextPacket(p, options).status, 'VALID');
  const artifact = readContextArtifact(a.artifactId, f.options);
  artifact.repositoryReference.repository = 'wayper-site';
  assert.equal(validateContextArtifact(artifact), false);
  assert.notEqual(digest(other.spec.root), digest(f.root));
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'changed');
  assert.equal(validateContextPacket(p, options).status, 'INVALID');
});
test('CE17 cache symlink and excluded path rejected; wrong range/symbol cannot alias cache', async (t) => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'src/a.js'), 'one\ntwo\nthree\n');
  const first = await f.resolve({ ...f.source, range: 'L1' });
  const second = await f.resolve({ ...f.source, range: 'L2' }); assert.notEqual(first.artifactId, second.artifactId);
  await assert.rejects(f.resolve({ ...f.source, symbol: 'wrong' }), /INVALID_SOURCE/);
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'one\ntwo\nchanged\n');
  assert.equal((await f.resolve({ ...f.source, range: 'L1' })).artifactId, first.artifactId);
  fs.mkdirSync(path.join(f.root, 'backup')); fs.writeFileSync(path.join(f.root, 'backup/old.js'), 'old');
  await assert.rejects(f.resolve({ ...f.source, path: 'backup/old.js' }), /EXCLUDED/);
  const file = path.join(f.root, '.wayper-context/cache/artifacts', first.artifactId + '.json');
  fs.unlinkSync(file); fs.symlinkSync('/etc/passwd', file);
  await assert.rejects(f.resolve({ ...f.source, range: 'L1' }), /SYMLINK/);
});
test('Full circuit: Goal -> graph MISS -> Packet -> Feedback -> HIT -> stale -> refresh -> new artifact', async (t) => {
  const f = fixture(t); f.refresh();
  const request = { kind: 'GRAPH_QUERY', repository: 'wayper', scope: 'repository-code-only', query: { kind: 'query', text: 'a' },
    parameters: {}, paths: ['src/a.js'] };
  const first = await f.resolve(request); assert.equal(first.disposition, 'ACQUIRED');
  const packet = buildResolvedPacket({ ...f.options, target: { type: 'validationRole', id: 'followup-review', repositories: ['wayper'],
    paths: ['wayper:src/a.js'], objective: 'use graph discovery' }, registry: loadCapabilityFiles().registry });
  assert.deepEqual(packet.contextArtifactRefs, [first.artifactId]);
  const session = { attempts: [{ failureId: 'F1', action: { paths: ['src/a.js'] }, lineage: [] }] };
  assert.deepEqual(feedbackDiscoveryContext(session, contextOwner(f.options), { failureId: 'F1', relatedFindingIds: [], repository: 'wayper' }).contextArtifactRefs, [first.artifactId]);
  assert.equal((await f.resolve(request)).disposition, 'REUSED'); assert.equal(f.queryCount(), 1);
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 9;');
  await assert.rejects(f.resolve(request), /STALE_CONTENT/);
  f.refresh(); const next = await f.resolve(request); assert.notEqual(next.artifactId, first.artifactId); assert.equal(f.queryCount(), 2);
  const independent = await f.resolve({ kind: 'DOCUMENT_SLICE', repository: 'wayper', path: '.gitignore', range: null });
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 10;');
  assert.equal((await f.resolve({ kind: 'DOCUMENT_SLICE', repository: 'wayper', path: '.gitignore', range: null })).artifactId, independent.artifactId);
});
