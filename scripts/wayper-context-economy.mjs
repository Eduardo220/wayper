import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readWorkingContext, writeWorkingContext, refreshWorkingContext, contextDecision } from './wayper-context.mjs';
import { finalizeContextMap, recordContextEntry } from './wayper-context-map.mjs';
import { buildContextPacket } from './wayper-context-packet.mjs';
import { digest, exact } from './wayper-validation-policy.mjs';
import { captureRepositories } from './wayper-context-identity.mjs';
import { sourceFingerprint, redactEvidenceText } from './wayper-evidence-receipts.mjs';
import { safeContextPath, hashBytes } from './wayper-graph-corpus.mjs';
import { freshGraph, inspectGraphFreshness, ensureGraphFresh } from './wayper-graph.mjs';
import { graphQueryRequest, executeGraphQuery, boundedGraphOutput } from './wayper-graph-query.mjs';
import { recordGraphQueryExecution } from './wayper-evidence-observer.mjs';
import { newContextIndex, CONTEXT_LIMITS, artifactIdentity, persistContextArtifact, readContextArtifact, normalizedRange,
  graphSpecFor, repositoryForArtifact, refreshContextArtifacts, artifactFreshness, validateContextIndex, validateArtifactRefs } from './wayper-context-artifacts.mjs';

export function contextOwner(options) {
  const { identity, root } = options;
  const state = readWorkingContext(root, { 'thread-id': identity.threadId, 'goal-run-id': identity.goalRunId, revision: identity.revision });
  const repositories = Object.values(state.contextMap.repositoryState).map((r) => ({ id: r.repository, logicalRoot: r.logicalRoot,
    root: path.resolve(root, r.logicalRoot) }));
  return { ...options, state, repositories };
}
function save(owner) {
  owner.state.contextMap = finalizeContextMap(owner.state.contextMap);
  writeWorkingContext(owner.state, owner);
}
function sourceRequest(input, repo) {
  if (!exact(input, 'kind repository path range') || !['SOURCE_SLICE', 'DOCUMENT_SLICE'].includes(input.kind)) throw new Error('INVALID_SOURCE_REQUEST');
  const file = safeContextPath(repo.root, input.path);
  if (input.path.split('/').some((p) => /^(\.git|\.wayper-context|graphify-out|node_modules|backup|backups|clones|debug-clones)$/.test(p)) ||
    /(^|\/)(\.env($|\.)|credentials|secrets)/i.test(input.path)) throw new Error('EXCLUDED_CONTEXT_PATH');
  try { execFileSync('git', ['check-ignore', '--no-index', '-q', '--', input.path], { cwd: repo.root, stdio: 'pipe' }); throw new Error('EXCLUDED_CONTEXT_PATH'); }
  catch (e) { if (e.status !== 1) throw e; }
  if (!fs.statSync(file).isFile()) throw new Error('INVALID_SOURCE_PATH');
  return { ...input, range: normalizedRange(input.range) };
}
function sourceSlice(repo, request) {
  const value = fs.readFileSync(safeContextPath(repo.root, request.path), 'utf8');
  if (!request.range) return value;
  const [start, end = start] = request.range.match(/\d+/g).map(Number);
  return value.split(/\r?\n/).slice(start - 1, end).join('\n');
}
function canonicalRequest(input, repo) {
  if (input.kind === 'GRAPH_QUERY') return graphQueryRequest(input);
  if (input.kind !== 'DERIVED_SUMMARY') return sourceRequest({ range: null, ...input }, repo);
  if (!exact(input, 'kind repository parents summary') || !Array.isArray(input.parents) || !input.parents.length || input.parents.length > 16 ||
    new Set(input.parents).size !== input.parents.length || typeof input.summary !== 'string' || !input.summary.trim() ||
    Buffer.byteLength(input.summary) > 3500) throw new Error('INVALID_SUMMARY_REQUEST');
  return { ...input, parents: [...input.parents].sort() };
}
export async function resolveContext(options) {
  const owner = contextOwner(options); const { state } = owner;
  const repo = repositoryForArtifact(options.request.repository, owner);
  const request = canonicalRequest(options.request, repo);
  if (state.contextMap.context && !validateContextIndex(state.contextMap.context, state.execution)) throw new Error('INVALID_CONTEXT_GOAL_BINDING');
  const stop = contextDecision(state, owner) === 'STOP_WHEN_PROVEN';
  const index = state.contextMap.context ??= newContextIndex(state.execution);
  const metrics = index.metrics; metrics.contextRequests++;
  index.expansionState = stop ? 'STOP_WHEN_PROVEN' : 'OPEN';
  refreshContextArtifacts(index, owner);
  let graph; let dependencies; let paths; let acquiredReceiptIds = [];
  if (request.kind === 'GRAPH_QUERY') {
    metrics.graphQueriesRequested++;
    const spec = graphSpecFor(request.repository, owner);
    graph = inspectGraphFreshness(spec, options.graphOptions);
    if (['STALE_CONTENT', 'STALE_SCOPE'].includes(graph.status)) metrics.graphStaleDetections++;
    if (!freshGraph(graph.status) && options.refreshGraph && !stop) {
      graph = ensureGraphFresh(spec, options.graphOptions);
      if (['INCREMENTAL_REFRESH', 'SCOPED_REBUILD'].includes(graph.action)) metrics.graphRefreshes++;
    }
    index.graphFreshness[request.repository] = graph.status;
    if (!freshGraph(graph.status)) {
      save(owner);
      if (['UNAVAILABLE', 'INVALID'].includes(graph.status) && options.request.fallback && !options.graphRequired) {
        if (options.request.fallback.repository !== request.repository || !['SOURCE_SLICE', 'DOCUMENT_SLICE'].includes(options.request.fallback.kind)) throw new Error('INVALID_GRAPH_FALLBACK_SCOPE');
        return { ...await resolveContext({ ...options, request: options.request.fallback }), graphFallback: graph.status };
      }
      throw new Error(`GRAPH_${graph.status}`);
    }
    dependencies = [{ kind: 'GRAPH', corpusFingerprint: graph.corpus.corpusFingerprint, graphFingerprint: graph.graphFingerprint,
      scopeFingerprint: graph.corpus.scopeFingerprint, fingerprint: digest([graph.corpus.corpusFingerprint, graph.graphFingerprint]) }];
    // Source refs are selected explicitly, never the whole graph corpus.
    paths = (options.request.paths ?? []).slice(0, 24);
    if (paths.some((p) => !graph.corpus.files.some((f) => f.path === p))) throw new Error('INVALID_GRAPH_QUERY_PATH_SCOPE');
  } else if (request.kind === 'DERIVED_SUMMARY') {
    const parents = request.parents.map((id) => readContextArtifact(id, owner));
    if (parents.some((p) => !p || p.repositoryReference.repository !== repo.id || artifactFreshness(p, owner) !== 'CURRENT')) { save(owner); throw new Error('STALE_PARENT'); }
    dependencies = parents.map((p) => ({ kind: 'PARENT', artifactId: p.artifactId, fingerprint: p.fingerprint }));
    paths = [...new Set(parents.flatMap((p) => p.dependencies.filter((d) => d.kind === 'SOURCE').map((d) => d.path)))];
  } else {
    const source = sourceFingerprint(repo.root, request.path, request.range);
    if (!source) throw new Error('SOURCE_UNAVAILABLE');
    dependencies = [{ kind: 'SOURCE', path: request.path, range: request.range, fingerprint: source.hash }]; paths = [request.path];
  }
  const id = artifactIdentity(request, dependencies); const requestFingerprint = digest(request);
  const previous = index.artifacts.find((r) => r.artifactId === id && r.status === 'CURRENT');
  const changedSource = request.kind.endsWith('_SLICE') && index.artifacts.some((r) => r.requestFingerprint === requestFingerprint && r.status === 'STALE');
  let changeSummary = null;
  let artifact;
  try { artifact = readContextArtifact(id, owner); if (artifact && artifactFreshness(artifact, owner) !== 'CURRENT') artifact = null; }
  catch { artifact = null; }
  const maxArtifacts = Math.min(options.limits?.artifactCount ?? CONTEXT_LIMITS.artifactCount, CONTEXT_LIMITS.artifactCount);
  const boundedBudget = state.budget.contextTokenCeiling * 4; // Existing byte proxy ceiling, never actual token accounting.
  if (!previous && (stop || index.artifacts.filter((r) => r.status === 'CURRENT').length >= maxArtifacts ||
    index.artifacts.filter((r) => r.status === 'CURRENT').reduce((n, r) => n + r.boundedBytes, 0) + CONTEXT_LIMITS.artifactBytes > boundedBudget)) {
    index.expansionState = stop ? 'STOP_WHEN_PROVEN' : 'BUDGET_LIMIT'; save(owner); throw new Error(stop ? 'STOP_CONTEXT_EXPANSION' : 'CONTEXT_BUDGET_LIMIT');
  }
  const reused = Boolean(artifact);
  if (reused) {
    metrics.cacheHits++; metrics.artifactsReused++; if (previous) metrics.duplicateAcquisitionsAvoided++;
    if (request.kind === 'GRAPH_QUERY') metrics.graphQueryHits++;
  } else {
    if (stop) { save(owner); throw new Error('STOP_CONTEXT_EXPANSION'); }
    metrics.cacheMisses++; let content;
    if (request.kind === 'GRAPH_QUERY') {
      metrics.graphQueryMisses++;
      const output = await (options.graphOptions?.executeQuery ?? executeGraphQuery)({ request, spec: graphSpecFor(repo.id, owner), owner });
      content = boundedGraphOutput(output);
      const after = inspectGraphFreshness(graphSpecFor(repo.id, owner), options.graphOptions);
      if (!freshGraph(after.status) || after.graphFingerprint !== graph.graphFingerprint || after.corpus.corpusFingerprint !== graph.corpus.corpusFingerprint) throw new Error('GRAPH_CHANGED_DURING_QUERY');
      if (output.execution) {
        const receipt = recordGraphQueryExecution({ ...owner, execution: state.execution, repository: repo.id,
          target: `graph-query:${request.query.kind}`, corpusFingerprint: graph.corpus.corpusFingerprint,
          graphFingerprint: graph.graphFingerprint, scopeFingerprint: graph.corpus.scopeFingerprint,
          executionObservation: output.execution });
        acquiredReceiptIds = [receipt.receiptId];
      }
    } else {
      if (changedSource) {
        const diff = execFileSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', 'HEAD', '--', request.path],
          { cwd: repo.root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
        changeSummary = { fingerprint: hashBytes(diff), bytes: Buffer.byteLength(diff) };
      }
      content = request.kind === 'DERIVED_SUMMARY' ? request.summary : sourceSlice(repo, request);
    }
    content = redactEvidenceText(content);
    if (Buffer.byteLength(content) > CONTEXT_LIMITS.artifactBytes) {
      save(owner); throw new Error('CONTEXT_SLICE_TOO_LARGE: narrow the range');
    }
    const value = { schemaVersion: 1, artifactId: id, kind: request.kind, repositoryReference: { repository: repo.id,
      checkoutFingerprint: hashBytes(fs.realpathSync(repo.root)) }, request, dependencies, boundedContent: content,
    contentFingerprint: hashBytes(content), createdAt: new Date().toISOString(), producer: 'wayper-context-v1' };
    artifact = { ...value, fingerprint: digest(value) };
    if (artifactFreshness(artifact, owner) !== 'CURRENT') throw new Error('CONTEXT_CHANGED_DURING_ACQUISITION');
    artifact = persistContextArtifact(artifact, owner); metrics.artifactsAcquired++;
  }
  const binding = { goalReference: state.execution.identity, baselineReference: state.execution.baseline.fingerprint,
    revalidatedAgainst: digest(captureRepositories(owner.repositories)), revalidation: reused ? previous ? 'CURRENT_REVALIDATED' : 'SHARED_REVALIDATED' : 'ACQUIRED' };
  const ref = { artifactId: id, requestFingerprint, repository: repo.id, paths, kind: request.kind, status: 'CURRENT', binding,
    receiptIds: reused ? previous?.receiptIds ?? [] : acquiredReceiptIds,
    boundedBytes: Buffer.byteLength(artifact.boundedContent) };
  index.artifacts = [...index.artifacts.filter((r) => r.artifactId !== id && (r.status === 'CURRENT' || r.requestFingerprint !== requestFingerprint)), ref].slice(-64);
  for (const receiptId of acquiredReceiptIds) state.contextMap = recordContextEntry(state.contextMap, 'receipt', { receiptId }, owner.repositories, owner);
  // Reuse cannot turn a discovery artifact into an evidence ref or proof.
  save(owner);
  return { artifactId: id, kind: request.kind, disposition: reused ? 'REUSED' : 'ACQUIRED', binding, boundedContent: artifact.boundedContent,
    readStrategy: reused ? 'REUSE_BEFORE_READ' : changedSource ? 'DIFF_BEFORE_FILE' : 'TARGETED_ACQUISITION', changeSummary };
}
export const queryGraph = ({ repository, scope, query, parameters = {}, paths = [], ...options }) =>
  resolveContext({ ...options, request: { kind: 'GRAPH_QUERY', repository, scope, query, parameters, paths } });
export function contextEconomyAssessment(options) {
  const { state } = contextOwner(options);
  const index = state.contextMap.context ?? newContextIndex(state.execution);
  return { ...index.metrics, invalidations: index.invalidations, graphFreshness: index.graphFreshness,
    expansionState: index.expansionState, tokenUsage: 'UNKNOWN', unobservedHostReads: 'UNKNOWN', bytesRead: 'UNKNOWN',
    accountingScope: 'PROJECT_OWNED_CONTEXT_ONLY' };
}
export function buildResolvedPacket(options) {
  const owner = contextOwner(options);
  const state = refreshWorkingContext({ ...owner, existing: owner.state, identity: owner.state.execution.identity });
  // A stale requested slice requires the resolver; packet construction never rereads it silently.
  const selected = state.contextMap.context?.artifacts.filter((r) => options.target.paths?.some((p) =>
    r.paths.some((q) => p === `${r.repository}:${q}` || p === q))) ?? [];
  if (selected.some((r) => r.status !== 'CURRENT') || !validateArtifactRefs(state.contextMap, selected.map((r) => r.artifactId), owner)) throw new Error('CONTEXT_ARTIFACT_STALE');
  const packet = buildContextPacket(state.contextMap, options.target, { registry: options.registry, repositoryDefinitions: owner.repositories, graphOptions: options.graphOptions });
  if (state.contextMap.context) {
    state.contextMap.context.metrics.packetArtifactCount += packet.contextArtifactRefs?.length ?? 0;
    state.contextMap.context.metrics.packetBoundedBytes += packet.metrics.packetBytes;
    state.contextMap = finalizeContextMap(state.contextMap);
  }
  writeWorkingContext(state, owner);
  return buildContextPacket(state.contextMap, options.target, { registry: options.registry, repositoryDefinitions: owner.repositories, graphOptions: options.graphOptions });
}
