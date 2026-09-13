import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { digest, exact } from './wayper-validation-policy.mjs';
import { graphCorpus, safeContextPath, hashBytes, graphGit, GRAPH_SCOPE } from './wayper-graph-corpus.mjs';

const read = (spec, name) => JSON.parse(fs.readFileSync(safeContextPath(spec.root, `graphify-out/${name}`), 'utf8'));
const graphHash = (spec) => hashBytes(fs.readFileSync(safeContextPath(spec.root, 'graphify-out/graph.json')));
const currentMetadata = (spec) => ({ head: graphGit(spec.root, 'rev-parse', 'HEAD'), branch: graphGit(spec.root, 'branch', '--show-current') });
const comparable = (files) => files.map(({ path, fingerprint }) => ({ path, fingerprint }));
export const freshGraph = (status) => ['FRESH', 'METADATA_DRIFT'].includes(status);

export function graphSanity(graph, spec, files) {
  if (!Array.isArray(graph.nodes) || !graph.nodes.length || !Array.isArray(graph.edges ?? graph.links)) throw new Error('INVALID_GRAPH_STRUCTURE');
  const edges = graph.edges ?? graph.links; const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length || [...ids].some((id) => typeof id !== 'string' || !id)) throw new Error('INVALID_GRAPH_NODES');
  if (edges.some((e) => !ids.has(e.source) || !ids.has(e.target))) throw new Error('INVALID_GRAPH_EDGES');
  const paths = new Set(files.map((f) => f.path));
  let externalReferences = 0;
  for (const item of graph.nodes) if (item.source_file) {
    const stat = fs.lstatSync(path.resolve(spec.root, item.source_file), { throwIfNoEntry: false });
    const external = !stat && item._origin === 'ast' && item.file_type === 'code' && item.label === item.source_file &&
      !path.extname(item.source_file) && !item.source_file.split('/').some((part) => !part || part === '.' || part === '..');
    if (external) { externalReferences++; continue; }
    safeContextPath(spec.root, item.source_file);
    if (!paths.has(item.source_file)) throw new Error('INVALID_GRAPH_SOURCE_SCOPE');
  }
  for (const item of [...edges, ...(graph.hyperedges ?? [])]) if (item.source_file) {
    safeContextPath(spec.root, item.source_file);
    if (!paths.has(item.source_file)) throw new Error('INVALID_GRAPH_SOURCE_SCOPE');
  }
  for (const symbol of spec.querySymbols ?? []) if (!graph.nodes.some((n) =>
    [symbol, `${symbol}()`, `${symbol}.js`, `${symbol}.tsx`].includes(n.label))) throw new Error('INVALID_GRAPH_EXPECTED_SYMBOL');
  return { files: new Set(graph.nodes.map((n) => n.source_file).filter((source) => paths.has(source))).size,
    nodes: graph.nodes.length, edges: edges.length,
    communities: new Set(graph.nodes.map((node) => node.community).filter((value) => value !== undefined)).size,
    externalReferences };
}
function differences(indexed, corpus) {
  const old = new Map(indexed.map((f) => [f.path, f.fingerprint])); const now = new Map(corpus.files.map((f) => [f.path, f.fingerprint]));
  return { missingPaths: [...now.keys()].filter((p) => !old.has(p)), extraPaths: [...old.keys()].filter((p) => !now.has(p)),
    changedPaths: [...now.keys()].filter((p) => old.has(p) && old.get(p) !== now.get(p)) };
}
function registered(spec, corpus) {
  const manifest = read(spec, 'manifest.json');
  const stamped = Object.entries(manifest).filter(([, value]) => value?.ast_hash);
  return stamped.length === corpus.files.length && corpus.files.every((f) => manifest[f.path]?.ast_hash === f.md5);
}
export function inspectGraphFreshness(spec, options = {}) {
  let corpus;
  try { corpus = graphCorpus(spec, options.detector); }
  catch (e) { return { status: /UNAVAILABLE|ENOENT/.test(e.message) ? 'UNAVAILABLE' : 'INVALID', reason: e.message, repository: spec.repository }; }
  const base = { repository: spec.repository, scope: GRAPH_SCOPE, corpus, ...currentMetadata(spec) };
  if (!fs.existsSync(path.join(spec.root, 'graphify-out/graph.json'))) return { ...base, status: 'UNAVAILABLE', reason: 'GRAPH_MISSING' };
  try {
    const metadata = read(spec, 'scope.json'); const graphFingerprint = graphHash(spec);
    if (metadata.repository !== spec.repository || metadata.root !== spec.root || metadata.scope !== GRAPH_SCOPE ||
      metadata.graphSha256 !== graphFingerprint) throw new Error('INVALID_GRAPH_BINDING');
    if (metadata.schemaVersion !== 2) {
      const manifest = read(spec, 'manifest.json');
      const indexed = Object.entries(manifest).map(([p, value]) => ({ path: p,
        fingerprint: corpus.files.find((f) => f.path === p && f.md5 === value.ast_hash)?.fingerprint ?? null }));
      return { ...base, metadata, graphFingerprint, ...differences(indexed, corpus), status: 'STALE_SCOPE', reason: 'LEGACY_CORPUS_UNVERIFIED' };
    }
    const index = read(spec, 'corpus.json');
    const { fingerprint: indexFingerprint, ...indexContent } = index;
    if (!exact(index, 'schemaVersion repository scopeFingerprint corpusFingerprint files fingerprint') || index.schemaVersion !== 1 ||
      index.repository !== spec.repository || !Array.isArray(index.files) ||
      indexFingerprint !== digest(indexContent) || metadata.corpusManifestFingerprint !== index.fingerprint ||
      index.corpusFingerprint !== digest({ scope: index.scopeFingerprint, files: comparable(index.files) })) throw new Error('INVALID_CORPUS_MANIFEST');
    const diff = differences(index.files, corpus);
    const common = { ...base, metadata, graphFingerprint, ...diff };
    if (index.scopeFingerprint !== corpus.scopeFingerprint) return { ...common, status: 'STALE_SCOPE', reason: 'SCOPE_CHANGED' };
    if (index.corpusFingerprint !== corpus.corpusFingerprint) return { ...common, status: 'STALE_CONTENT', reason: 'CORPUS_CHANGED' };
    if (!registered(spec, corpus)) throw new Error('INVALID_REGISTERED_CORPUS');
    const metrics = graphSanity(read(spec, 'graph.json'), spec, corpus.files);
    return { ...common, metrics, status: metadata.head !== base.head || metadata.branch !== base.branch ? 'METADATA_DRIFT' : 'FRESH', reason: null };
  } catch (e) { return { ...base, status: 'INVALID', reason: e.message }; }
}
const atomic = (file, value) => {
  const temp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value) + '\n', { flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
};
function extractGraph({ spec, output, action }) {
  execFileSync(process.env.GRAPHIFY_BIN || 'graphify', ['extract', spec.root, '--out', output, '--code-only', '--no-cluster',
    '--max-workers', '2', ...(action === 'SCOPED_REBUILD' ? ['--force'] : [])],
  { cwd: output, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 180_000 });
}
export function ensureGraphFresh(spec, options = {}) {
  const before = inspectGraphFreshness(spec, options);
  if (before.status === 'FRESH') return { ...before, action: 'REUSE' };
  if (!before.corpus) return { ...before, action: 'SOURCE_FALLBACK' };
  const dirty = graphGit(spec.root, 'status', '--porcelain=v1', '--untracked-files=all');
  if (dirty && (!options.allowDirty || spec.repository === 'wayper-site')) return { ...before, action: 'BLOCKED_DIRTY_REPOSITORY' };
  const state = digest({ ...currentMetadata(spec), dirty, corpus: before.corpus.corpusFingerprint });
  const guard = () => {
    const corpus = graphCorpus(spec, options.detector);
    if (state !== digest({ ...currentMetadata(spec), dirty: graphGit(spec.root, 'status', '--porcelain=v1', '--untracked-files=all'),
      corpus: corpus.corpusFingerprint })) throw new Error('BLOCKED_CONCURRENT_CHANGE');
  };
  const outputDir = safeContextPath(spec.root, 'graphify-out', { missing: true });
  if (before.status === 'METADATA_DRIFT') {
    guard(); atomic(safeContextPath(spec.root, 'graphify-out/scope.json'), { ...before.metadata, ...currentMetadata(spec),
      dirtyCorpus: Boolean(dirty), metadataUpdatedAt: new Date().toISOString(), metadataUpdateReason: 'HEAD_OR_BRANCH_DRIFT' });
    return { ...inspectGraphFreshness(spec, options), action: 'METADATA_REPAIR' };
  }
  const action = before.status === 'STALE_CONTENT' && before.corpus.incremental ? 'INCREMENTAL_REFRESH' : 'SCOPED_REBUILD';
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-graph-refresh-'));
  try {
    fs.mkdirSync(path.join(temporary, 'graphify-out'));
    if (action === 'INCREMENTAL_REFRESH') for (const file of ['graph.json', 'manifest.json'])
      fs.copyFileSync(safeContextPath(spec.root, `graphify-out/${file}`), path.join(temporary, 'graphify-out', file));
    guard(); (options.extract ?? extractGraph)({ spec, output: temporary, action, corpus: before.corpus }); guard();
    const generated = { ...spec, root: temporary };
    if (!registered(generated, before.corpus)) throw new Error('GRAPH_POST_REFRESH_CORPUS_MISMATCH');
    const graph = read(generated, 'graph.json');
    // Graphify raw extraction has dangling external-call edges. Prune only those,
    // report the count, then verify every surviving node/edge and source path.
    const ids = new Set(graph.nodes?.map((n) => n.id)); const key = graph.edges ? 'edges' : 'links';
    const original = graph[key] ?? []; graph[key] = original.filter((e) => ids.has(e.source) && ids.has(e.target));
    const metrics = graphSanity(graph, spec, before.corpus.files);
    const index = { schemaVersion: 1, repository: spec.repository, scopeFingerprint: before.corpus.scopeFingerprint,
      corpusFingerprint: before.corpus.corpusFingerprint, files: comparable(before.corpus.files) };
    index.fingerprint = digest(index);
    const graphBytes = JSON.stringify(graph) + '\n';
    const metadata = { schemaVersion: 2, repository: spec.repository, root: spec.root, scope: GRAPH_SCOPE, ...currentMetadata(spec),
      dirtyCorpus: Boolean(dirty), sourceFingerprint: before.corpus.corpusFingerprint, graphSha256: hashBytes(graphBytes),
      corpusManifestFingerprint: index.fingerprint, graphifyVersion: before.corpus.version, builtAt: new Date().toISOString(),
      buildMode: action, reason: before.reason, corpusFiles: index.files.length, ...metrics,
      normalization: { prunedDanglingEdges: original.length - graph[key].length } };
    guard(); fs.mkdirSync(outputDir, { recursive: true });
    // Metadata publishes last: an interrupted generation is INVALID, never fresh.
    for (const [name, value] of Object.entries({ 'graph.json': graph, 'manifest.json': read(generated, 'manifest.json'), 'corpus.json': index, 'scope.json': metadata }))
      atomic(safeContextPath(spec.root, `graphify-out/${name}`, { missing: true }), value);
    const result = inspectGraphFreshness(spec, options);
    if (!freshGraph(result.status)) throw new Error(`GRAPH_POST_REFRESH_${result.status}`);
    return { ...result, action };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
