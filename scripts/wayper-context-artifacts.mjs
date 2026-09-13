import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest, exact } from './wayper-validation-policy.mjs';
import { stable, assertSameIdentity } from './wayper-context-identity.mjs';
import { sourceFingerprint, canonicalEvidenceRange } from './wayper-evidence-receipts.mjs';
import { safeContextPath, hashBytes } from './wayper-graph-corpus.mjs';
import { inspectGraphFreshness, freshGraph } from './wayper-graph.mjs';

export const ARTIFACT_ID = /^CA-[a-f0-9]{64}$/;
export const CONTEXT_LIMITS = Object.freeze({ artifactCount: 64, artifactBytes: 4096, dependencies: 16, packetArtifacts: 16 });
export const CONTEXT_COUNTERS = ['contextRequests', 'cacheHits', 'cacheMisses', 'artifactsReused', 'artifactsAcquired',
  'artifactsInvalidated', 'duplicateAcquisitionsAvoided', 'graphQueriesRequested', 'graphQueryHits', 'graphQueryMisses',
  'graphRefreshes', 'graphStaleDetections', 'packetArtifactCount', 'packetBoundedBytes', 'feedbackContextReuses', 'feedbackContextReacquisitions'];
export function newContextIndex(execution) {
  return { schemaVersion: 1, goalReference: execution.identity, baselineReference: execution.baseline.fingerprint,
    artifacts: [], invalidations: [], graphFreshness: {}, expansionState: 'OPEN',
    metrics: Object.fromEntries(CONTEXT_COUNTERS.map((key) => [key, 0])) };
}
export const artifactIdentity = (request, dependencies) => `CA-${digest({ request, dependencies }).slice(7)}`;
export function contextArtifactPath(id, { root }) {
  if (!ARTIFACT_ID.test(id)) throw new Error('INVALID_CONTEXT_ARTIFACT_ID');
  return safeContextPath(root, `.wayper-context/cache/artifacts/${id}.json`, { missing: true });
}
export function validateContextArtifact(a) {
  try {
    const { fingerprint, ...content } = a;
    return exact(a, 'schemaVersion artifactId kind repositoryReference request dependencies boundedContent contentFingerprint createdAt producer fingerprint') &&
      a.schemaVersion === 1 && ARTIFACT_ID.test(a.artifactId) &&
      ['SOURCE_SLICE', 'DOCUMENT_SLICE', 'GRAPH_QUERY', 'DERIVED_SUMMARY'].includes(a.kind) && a.kind === a.request.kind &&
      exact(a.repositoryReference, 'repository checkoutFingerprint') && ['wayper', 'wayper-site'].includes(a.repositoryReference.repository) &&
      a.request.repository === a.repositoryReference.repository && /^sha256:[a-f0-9]{64}$/.test(a.repositoryReference.checkoutFingerprint) &&
      Array.isArray(a.dependencies) && a.dependencies.length > 0 && a.dependencies.length <= CONTEXT_LIMITS.dependencies &&
      a.dependencies.every((d) => (d.kind === 'SOURCE' && exact(d, 'kind path range fingerprint') &&
        (d.range === null || /^L[1-9]\d*(?:-L[1-9]\d*)?$/.test(d.range)) ||
        d.kind === 'PARENT' && exact(d, 'kind artifactId fingerprint') && ARTIFACT_ID.test(d.artifactId) ||
        d.kind === 'GRAPH' && exact(d, 'kind corpusFingerprint graphFingerprint scopeFingerprint fingerprint')) && /^sha256:[a-f0-9]{64}$/.test(d.fingerprint)) &&
      typeof a.boundedContent === 'string' && Buffer.byteLength(a.boundedContent) <= CONTEXT_LIMITS.artifactBytes &&
      a.contentFingerprint === hashBytes(a.boundedContent) && a.artifactId === artifactIdentity(a.request, a.dependencies) &&
      Number.isFinite(Date.parse(a.createdAt)) && a.producer === 'wayper-context-v1' && fingerprint === digest(content);
  } catch { return false; }
}
export function readContextArtifact(id, options) {
  const file = contextArtifactPath(id, options);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 24_576) throw new Error('INVALID_CONTEXT_CACHE_FILE');
  const a = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (a.artifactId !== id || !validateContextArtifact(a)) throw new Error('INVALID_CONTEXT_CACHE_INTEGRITY');
  return a;
}
export function persistContextArtifact(a, options) {
  if (!validateContextArtifact(a)) throw new Error('INVALID_CONTEXT_ARTIFACT');
  const file = contextArtifactPath(a.artifactId, options); fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try { const old = readContextArtifact(a.artifactId, options); return old; }
    catch {
      // Invalid cache is disposable. Keep no unbounded quarantine of poisoned bytes.
      fs.unlinkSync(file);
    }
  }
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(a), { flag: 'wx', mode: 0o600 }); fs.linkSync(temporary, file); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  finally { fs.unlinkSync(temporary); }
  return readContextArtifact(a.artifactId, options);
}
export function repositoryForArtifact(repository, options) {
  const definition = options.repositories?.find((r) => r.id === repository);
  if (!definition) throw new Error('CONTEXT_REPOSITORY_NOT_AUTHORIZED');
  return definition;
}
export function graphSpecFor(repository, options) {
  const definition = repositoryForArtifact(repository, options);
  return { root: definition.root, repository, querySymbols: [], peerDirectory: repository === 'wayper' ? 'wayper-site' : 'wayper' };
}
export function artifactFreshness(a, options, seen = new Set()) {
  if (!validateContextArtifact(a)) return 'INVALID';
  if (seen.has(a.artifactId) || seen.size >= 32) return 'INVALID';
  const next = new Set(seen).add(a.artifactId);
  try {
    const repo = repositoryForArtifact(a.repositoryReference.repository, options);
    if (a.repositoryReference.checkoutFingerprint !== hashBytes(fs.realpathSync(repo.root))) return 'INVALID';
    for (const d of a.dependencies) {
      if (d.kind === 'SOURCE') {
        safeContextPath(repo.root, d.path);
        if (sourceFingerprint(repo.root, d.path, d.range)?.hash !== d.fingerprint) return 'SOURCE_CHANGED';
      } else if (d.kind === 'PARENT') {
        const parent = readContextArtifact(d.artifactId, options);
        if (!parent || parent.repositoryReference.repository !== repo.id || parent.fingerprint !== d.fingerprint ||
          artifactFreshness(parent, options, next) !== 'CURRENT') return 'PARENT_CHANGED';
      } else {
        const graph = inspectGraphFreshness(graphSpecFor(repo.id, options), options.graphOptions);
        if (!freshGraph(graph.status) || graph.corpus.corpusFingerprint !== d.corpusFingerprint || graph.graphFingerprint !== d.graphFingerprint ||
          graph.corpus.scopeFingerprint !== d.scopeFingerprint) return 'GRAPH_CORPUS_CHANGED';
      }
    }
    return 'CURRENT';
  } catch { return 'INVALID'; }
}
export function refreshContextArtifacts(index, options) {
  if (!index) return;
  for (const ref of index.artifacts.filter((r) => r.status === 'CURRENT')) {
    let status;
    try { const a = readContextArtifact(ref.artifactId, options); status = a ? artifactFreshness(a, options) : 'INVALID'; }
    catch { status = 'INVALID'; }
    if (status !== 'CURRENT') {
      ref.status = 'STALE'; index.metrics.artifactsInvalidated++;
      index.invalidations = [...index.invalidations, { artifactId: ref.artifactId, reason: status }].slice(-32);
    }
  }
}
export function validateContextIndex(index, execution) {
  try {
    assertSameIdentity(index.goalReference, execution.identity);
    return exact(index, 'schemaVersion goalReference baselineReference artifacts invalidations graphFreshness expansionState metrics') &&
      index.schemaVersion === 1 && index.baselineReference === execution.baseline.fingerprint &&
      Array.isArray(index.artifacts) && index.artifacts.length <= CONTEXT_LIMITS.artifactCount &&
      new Set(index.artifacts.map((r) => r.artifactId)).size === index.artifacts.length && index.artifacts.every((r) =>
        exact(r, 'artifactId requestFingerprint repository paths kind status binding boundedBytes receiptIds') && ARTIFACT_ID.test(r.artifactId) &&
        ['CURRENT', 'STALE'].includes(r.status) && ['wayper', 'wayper-site'].includes(r.repository) &&
        Array.isArray(r.paths) && r.paths.length <= 24 && r.paths.every((p) => typeof p === 'string' && p.length < 400) &&
        Number.isSafeInteger(r.boundedBytes) && r.boundedBytes >= 0 && r.boundedBytes <= CONTEXT_LIMITS.artifactBytes &&
        Array.isArray(r.receiptIds) && r.receiptIds.length <= 8 && new Set(r.receiptIds).size === r.receiptIds.length &&
        r.receiptIds.every((id) => /^ER-[a-f0-9]{64}$/.test(id)) &&
        exact(r.binding, 'goalReference baselineReference revalidatedAgainst revalidation') &&
        stable(r.binding.goalReference) === stable(execution.identity) && r.binding.baselineReference === execution.baseline.fingerprint &&
        /^sha256:[a-f0-9]{64}$/.test(r.binding.revalidatedAgainst) && ['ACQUIRED', 'CURRENT_REVALIDATED', 'SHARED_REVALIDATED'].includes(r.binding.revalidation)) &&
      Array.isArray(index.invalidations) && index.invalidations.length <= 32 && index.invalidations.every((i) =>
        exact(i, 'artifactId reason') && ARTIFACT_ID.test(i.artifactId) && ['SOURCE_CHANGED', 'PARENT_CHANGED', 'GRAPH_CORPUS_CHANGED', 'INVALID'].includes(i.reason)) &&
      Object.entries(index.graphFreshness).every(([r, s]) => ['wayper', 'wayper-site'].includes(r) &&
        ['FRESH', 'METADATA_DRIFT', 'STALE_CONTENT', 'STALE_SCOPE', 'UNAVAILABLE', 'INVALID'].includes(s)) &&
      ['OPEN', 'STOP_WHEN_PROVEN', 'BUDGET_LIMIT'].includes(index.expansionState) && exact(index.metrics, CONTEXT_COUNTERS.join(' ')) &&
      Object.values(index.metrics).every((n) => Number.isSafeInteger(n) && n >= 0);
  } catch { return false; }
}
export function packetContextArtifacts(map, repositories, paths) {
  return (map.context?.artifacts ?? []).filter((r) => r.status === 'CURRENT' && repositories.includes(r.repository) &&
    r.paths.some((p) => paths.some((q) => q === `${r.repository}:${p}` || q === p && repositories.length === 1)))
    .slice(0, CONTEXT_LIMITS.packetArtifacts).map((r) => r.artifactId).sort();
}
export function validateArtifactRefs(map, ids, options) {
  return ids.every((id) => {
    const ref = map.context?.artifacts.find((r) => r.artifactId === id && r.status === 'CURRENT');
    if (!ref) return false;
    try { const a = readContextArtifact(id, options); return a && a.repositoryReference.repository === ref.repository &&
      digest(a.request) === ref.requestFingerprint && artifactFreshness(a, options) === 'CURRENT'; }
    catch { return false; }
  });
}
export const normalizedRange = (range) => canonicalEvidenceRange(range ?? null);
