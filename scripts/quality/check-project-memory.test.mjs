import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertMemoryAuthority, buildLearningCandidate, emptyMemoryIndex, evaluateMemoryPromotion, loadMemoryIndex,
  markMemoryConflicts, memoryTelemetry, promoteLearningCandidate, renderMemoryProjection, retrieveProjectMemory,
  revalidateMemoryEntry, supersedeMemory, validateMemoryIndex, writeMemoryStore,
} from '../wayper-project-memory.mjs';
import { sourceFingerprint } from '../wayper-evidence-receipts.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const identity = (goalRunId = 'gr-11111111-1111-4111-8111-111111111111') => ({ schemaVersion: 1, threadId: 'memory-fixture', goalRunId, revision: 1 });
const ref = (kind, id, repository = null, file = null, fingerprint = null) => ({ kind, id, repository, path: file, fingerprint });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-memory-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mobile = path.join(root, 'wayper'); const site = path.join(root, 'wayper-site'); fs.mkdirSync(mobile); fs.mkdirSync(site);
  fs.writeFileSync(path.join(mobile, 'owner.js'), 'export const authority = "source";\n');
  fs.writeFileSync(path.join(mobile, 'architecture.md'), '# Authority\n');
  fs.writeFileSync(path.join(site, 'site.js'), 'export const site = true;\n');
  return { root, repositories: [{ id: 'wayper', root: mobile }, { id: 'wayper-site', root: site }], mobile, site };
}
function candidateInput(f, extra = {}) {
  const dependency = { repository: 'wayper', path: 'owner.js', fingerprint: sourceFingerprint(f.mobile, 'owner.js').hash };
  return { goalReference: identity(), subject: 'Canonical completion authority', proposedKind: 'ARCHITECTURAL_INVARIANT',
    proposedStatement: 'Only the current admissible completion assessment permits a project completion request.',
    scope: { project: 'Wayper', repository: 'wayper', paths: ['owner.js'], capabilities: ['harness-completion'], domains: ['harness'] },
    supportingRefs: [ref('SOURCE', 'owner-source', 'wayper', 'owner.js', dependency.fingerprint),
      ref('DOCUMENT', 'architecture-doc', 'wayper', 'architecture.md', sourceFingerprint(f.mobile, 'architecture.md').hash),
      ref('VALIDATION', 'quality-completion')], contradictingRefs: [], dependencies: [dependency],
    durabilityReason: 'Prevents false completion across future Goals.', ...extra };
}
const candidate = (f, extra = {}) => buildLearningCandidate(candidateInput(f, extra));
const promoted = (f, extra = {}) => promoteLearningCandidate(candidate(f, extra), emptyMemoryIndex(), {
  now: '2026-09-14T12:00:00.000Z', repositories: f.repositories,
});

test('MR1 supported durable candidate promotes to CURRENT', (t) => {
  const result = promoted(fixture(t)); assert.equal(result.status, 'PROMOTED'); assert.equal(result.entry.status, 'CURRENT');
  assert.equal(result.entry.confidence, 'VERIFIED');
});

test('MR2 ephemeral lease candidate is rejected', (t) => {
  const f = fixture(t); const value = candidate(f, { subject: 'Current ownership lease',
    proposedStatement: 'The current lease should remain valid for future Goals.' });
  assert.equal(evaluateMemoryPromotion(value).decision, 'REJECTED');
});

test('MR3 raw cache artifact is not automatically memory', (t) => {
  const f = fixture(t); const value = candidate(f, { subject: 'Graph cache artifact', proposedStatement: 'Cache artifact should become durable memory.' });
  assert.equal(evaluateMemoryPromotion(value).decision, 'REJECTED');
});

test('MR4 unsupported model assertion remains candidate-only', (t) => {
  const f = fixture(t); const value = candidate(f, { supportingRefs: [ref('MODEL_ASSERTION', 'model-opinion')], dependencies: [] });
  assert.equal(evaluateMemoryPromotion(value).decision, 'CANDIDATE_ONLY');
});

test('promotion refuses provenance that is not current', (t) => {
  const f = fixture(t); const value = candidate(f); fs.appendFileSync(path.join(f.mobile, 'owner.js'), '// changed before promotion\n');
  assert.equal(promoteLearningCandidate(value, emptyMemoryIndex(), { repositories: f.repositories }).status, 'CANDIDATE_ONLY');
});

test('MR5 unchanged current dependency keeps memory CURRENT', (t) => {
  const f = fixture(t); const entry = promoted(f).entry;
  assert.equal(revalidateMemoryEntry(entry, { repositories: f.repositories, now: '2026-09-15T12:00:00.000Z' }).status, 'CURRENT');
});

test('MR6 changed dependency requires revalidation', (t) => {
  const f = fixture(t); const entry = promoted(f).entry; fs.appendFileSync(path.join(f.mobile, 'owner.js'), '// refactor\n');
  const checked = revalidateMemoryEntry(entry, { repositories: f.repositories });
  assert.equal(checked.status, 'STALE'); assert.equal(checked.validity.status, 'NEEDS_REVALIDATION');
});

test('MR7 current source contradiction wins over memory', (t) => {
  const f = fixture(t); const entry = promoted(f).entry;
  const checked = revalidateMemoryEntry(entry, { repositories: f.repositories, contradictionRefs: ['current-source'] });
  assert.equal(checked.status, 'CONFLICTED'); assert.equal(checked.validity.status, 'CONTRADICTED');
});

test('MR8 supersession preserves the old entry and lineage', (t) => {
  const f = fixture(t); const first = promoted(f); const second = promoteLearningCandidate(candidate(f, {
    proposedStatement: 'Only a fresh ADMISSIBLE assessment permits requesting host completion.',
  }), first.index, { now: '2026-09-15T12:00:00.000Z', repositories: f.repositories });
  const index = supersedeMemory(second.index, second.entry, [first.entry.memoryId]);
  assert.equal(index.entries.find((item) => item.memoryId === first.entry.memoryId).status, 'SUPERSEDED');
  assert.deepEqual(index.entries.find((item) => item.memoryId === second.entry.memoryId).supersedes, [first.entry.memoryId]);
});

test('MR9 conflicting CURRENT entries become CONFLICTED', (t) => {
  const f = fixture(t); const first = promoted(f); const second = promoteLearningCandidate(candidate(f, {
    proposedStatement: 'A validation plan alone permits completion.',
  }), first.index, { now: '2026-09-15T12:00:00.000Z', repositories: f.repositories });
  const index = markMemoryConflicts(second.index);
  assert.ok(index.entries.every((item) => item.status === 'CONFLICTED'));
});

test('MR10 wrong repository scope is not retrieved', (t) => {
  const f = fixture(t); const index = promoted(f).index;
  assert.equal(retrieveProjectMemory({ index, repository: 'wayper-site', repositories: f.repositories }).results.length, 0);
});

test('MR11 project-level memory is retrievable across repositories', (t) => {
  const f = fixture(t); const result = promoted(f, { scope: { project: 'Wayper', repository: null, paths: [], capabilities: ['harness-completion'], domains: ['harness'] } });
  assert.equal(retrieveProjectMemory({ index: result.index, repository: 'wayper-site', domains: ['harness'], repositories: f.repositories }).results.length, 1);
});

test('MR12 stale memory is historical context, never current authority', (t) => {
  const f = fixture(t); const result = promoted(f); fs.appendFileSync(path.join(f.mobile, 'owner.js'), '// changed\n');
  const found = retrieveProjectMemory({ index: result.index, repository: 'wayper', includeHistorical: true, repositories: f.repositories });
  assert.equal(found.results[0].status, 'STALE'); assert.equal(found.results[0].authority, 'CONTEXT_ONLY');
});

test('MR13 memory cannot satisfy an Evidence requirement', () => {
  assert.throws(() => assertMemoryAuthority('EVIDENCE'), /MEMORY_CANNOT_SATISFY_EVIDENCE/);
});

test('MR14 memory cannot grant write authorization', () => {
  assert.throws(() => assertMemoryAuthority('AUTHORIZATION'), /MEMORY_CANNOT_SATISFY_AUTHORIZATION/);
});

test('MR15 memory cannot satisfy Completion alone', () => {
  assert.throws(() => assertMemoryAuthority('COMPLETION'), /MEMORY_CANNOT_SATISFY_COMPLETION/);
});

test('MR16 exact duplicate candidate creates no duplicate entry', (t) => {
  const f = fixture(t); const first = promoted(f); const second = promoteLearningCandidate(candidate(f), first.index, { repositories: f.repositories });
  assert.equal(second.status, 'DUPLICATE'); assert.equal(second.index.entries.length, 1);
});

test('MR17 sensitive candidates are rejected without persistence', (t) => {
  const f = fixture(t); const sensitive = ['password=top-secret', 'token=secret-value', 'api_key=secret-value',
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', 'postgres://admin:secret@db.example.test/app'];
  for (const value of sensitive) assert.deepEqual(evaluateMemoryPromotion(candidate(f, {
    proposedStatement: `${value} should be remembered.`,
  })).reasons, ['SENSITIVE_MATERIAL']);
});

test('sensitive supporting metadata is rejected too', (t) => {
  const f = fixture(t); const input = candidateInput(f);
  input.supportingRefs[0].id = 'token=not-a-real-secret';
  assert.equal(evaluateMemoryPromotion(buildLearningCandidate(input)).decision, 'REJECTED');
});

test('memory adversarial Graphify-only claim and important Packet remain unpromoted', (t) => {
  const f = fixture(t);
  assert.equal(evaluateMemoryPromotion(candidate(f, { supportingRefs: [ref('GRAPHIFY', 'graph-query')], dependencies: [] })).decision, 'CANDIDATE_ONLY');
  assert.equal(evaluateMemoryPromotion(candidate(f, { subject: 'Important Context Packet' })).decision, 'REJECTED');
});

test('MR18 Markdown projection reflects canonical memory', (t) => {
  const entry = promoted(fixture(t)).entry; const markdown = renderMemoryProjection(entry);
  assert.match(markdown, /## Statement/); assert.match(markdown, new RegExp(entry.memoryId)); assert.match(markdown, /Confidence: `VERIFIED`/);
});

test('MR19 manual projection drift does not mutate canonical JSON', (t) => {
  const f = fixture(t); const result = promoted(f); writeMemoryStore(f.root, result.index);
  fs.writeFileSync(path.join(f.root, 'docs/ai/memory/topics', `${result.entry.memoryId}.md`), '# manual drift\n');
  const loaded = loadMemoryIndex(f.root); assert.equal(loaded.status, 'CURRENT'); assert.equal(loaded.index.entries[0].statement, result.entry.statement);
});

test('MR20 retrieval is bounded', (t) => {
  const f = fixture(t); let index = emptyMemoryIndex();
  for (let n = 0; n < 12; n++) {
    const result = promoteLearningCandidate(candidate(f, { subject: `Invariant ${n}`, proposedStatement: `Validated durable statement ${n}.` }), index,
      { now: '2026-09-14T12:00:00.000Z', repositories: f.repositories }); index = result.index;
  }
  assert.equal(retrieveProjectMemory({ index, repository: 'wayper', domains: ['harness'], limit: 3, repositories: f.repositories }).results.length, 3);
  assert.throws(() => retrieveProjectMemory({ index, limit: 11 }), /INVALID_MEMORY_QUERY/);
});

test('full memory circuit promotes, retrieves, stales, and supersedes without losing history', (t) => {
  const f = fixture(t); const goalA = promoted(f); assert.equal(validateMemoryIndex(goalA.index).status, 'VALID');
  const goalB = retrieveProjectMemory({ index: goalA.index, repository: 'wayper', capabilities: ['harness-completion'], repositories: f.repositories });
  assert.equal(goalB.results[0].status, 'CURRENT');
  fs.appendFileSync(path.join(f.mobile, 'owner.js'), '// owner moved\n');
  assert.equal(retrieveProjectMemory({ index: goalA.index, repository: 'wayper', includeHistorical: true, repositories: f.repositories }).results[0].status, 'STALE');
  const newDependency = { repository: 'wayper', path: 'owner.js', fingerprint: sourceFingerprint(f.mobile, 'owner.js').hash };
  const next = promoteLearningCandidate(candidate(f, { goalReference: identity('gr-33333333-3333-4333-8333-333333333333'), dependencies: [newDependency],
    supportingRefs: [ref('SOURCE', 'owner-source-v2', 'wayper', 'owner.js', newDependency.fingerprint),
      ref('DOCUMENT', 'architecture-doc', 'wayper', 'architecture.md', sourceFingerprint(f.mobile, 'architecture.md').hash), ref('VALIDATION', 'quality-completion-v2')],
    proposedStatement: 'Only the fresh connected ADMISSIBLE assessment can request host completion.' }), goalA.index,
  { now: '2026-09-16T12:00:00.000Z', repositories: f.repositories });
  assert.equal(supersedeMemory(next.index, next.entry, [goalA.entry.memoryId]).entries.length, 2);
});

test('memory observability names measured lifecycle events without intelligence claims', (t) => {
  const f = fixture(t); const first = promoted(f); const duplicate = promoteLearningCandidate(candidate(f), first.index, { repositories: f.repositories });
  const telemetry = memoryTelemetry({ candidates: [candidate(f)], promotions: [first, duplicate], entries: first.index.entries,
    retrievals: [retrieveProjectMemory({ index: first.index, repository: 'wayper', repositories: f.repositories })] });
  assert.equal(telemetry.learningCandidatesGenerated, 1); assert.equal(telemetry.duplicateCandidatesAvoided, 1);
  assert.equal(Object.keys(telemetry).some((key) => /intelligence/i.test(key)), false);
});

test('canonical project memory and one-way projections validate against current dependencies', () => {
  const loaded = loadMemoryIndex(PROJECT_ROOT); assert.equal(loaded.status, 'CURRENT');
  assert.equal(validateMemoryIndex(loaded.index).status, 'VALID');
  for (const entry of loaded.index.entries) {
    assert.equal(revalidateMemoryEntry(entry, { repositories: [{ id: 'wayper', root: PROJECT_ROOT }] }).status, 'CURRENT');
    assert.equal(fs.readFileSync(path.join(PROJECT_ROOT, 'docs/ai/memory/topics', `${entry.memoryId}.md`), 'utf8'), renderMemoryProjection(entry));
  }
});
