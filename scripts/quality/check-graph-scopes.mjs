import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const WORKSPACE_ROOT = path.resolve(ROOT, '..');
const GRAPHIFY = process.env.GRAPHIFY_BIN || 'graphify';
const REQUIRED_IGNORES = [
  'graphify-out/',
  'node_modules/',
  '.next/',
  '.expo/',
  'dist/',
  'build/',
  'coverage/',
  'tmp/',
  'temp/',
  'backups/',
  'backup/',
  'clones/',
  'debug-clones/',
];
const FORBIDDEN_DIRECTORIES = new Set(['backups', 'backup', 'clones', 'debug-clones']);
const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.cxx', '.go', '.h', '.hpp', '.java', '.js', '.jsx',
  '.json', '.kt', '.kts', '.mjs', '.cjs', '.php', '.py', '.rb', '.rs', '.sh',
  '.sql', '.svelte', '.swift', '.ts', '.tsx', '.vue',
]);

export const GRAPH_SPECS = {
  mobile: {
    repository: 'wayper',
    root: ROOT,
    peerDirectory: 'wayper-site',
    querySymbols: ['MapScreen'],
  },
  site: {
    repository: 'wayper-site',
    root: path.resolve(ROOT, '../wayper-site'),
    peerDirectory: 'wayper',
    querySymbols: ['WayperCanvas'],
  },
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const graphPath = (root) => path.join(root, 'graphify-out/graph.json');
const metadataPath = (root) => path.join(root, 'graphify-out/scope.json');
const manifestPath = (root) => path.join(root, 'graphify-out/manifest.json');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function normalizeSource(source, spec) {
  if (typeof source !== 'string' || !source || path.isAbsolute(source)) {
    throw new Error(`${spec.repository}: invalid graph source path: ${source}`);
  }
  const normalized = source.replaceAll('\\', '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    parts[0] === spec.peerDirectory ||
    parts.some((part) => FORBIDDEN_DIRECTORIES.has(part.toLowerCase()))
  ) {
    throw new Error(`${spec.repository}: contaminated graph source: ${source}`);
  }
  const resolved = path.resolve(spec.root, normalized);
  if (resolved !== spec.root && !resolved.startsWith(`${spec.root}${path.sep}`)) {
    throw new Error(`${spec.repository}: graph source escapes repository: ${source}`);
  }
  return normalized;
}

function graphSources(graph, spec) {
  const sources = new Set();
  for (const item of [
    ...(graph.nodes ?? []),
    ...(graph.links ?? graph.edges ?? []),
    ...(graph.hyperedges ?? []),
  ]) {
    if (!item.source_file) continue;
    const source = normalizeSource(item.source_file, spec);
    if (fs.statSync(path.resolve(spec.root, source), { throwIfNoEntry: false })?.isFile()) {
      if (!CODE_EXTENSIONS.has(path.extname(source).toLowerCase())) {
        throw new Error(`${spec.repository}: non-code source in code-only graph: ${source}`);
      }
      sources.add(source);
    }
  }
  return [...sources].sort();
}

function hashSources(spec, sources) {
  const hash = crypto.createHash('sha256');
  for (const source of sources) {
    const file = path.resolve(spec.root, source);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${spec.repository}: missing indexed source: ${source}`);
    }
    hash.update(source).update('\0').update(fs.readFileSync(file)).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function fingerprintCorpus(spec) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: spec.root, encoding: 'utf8' }
  ).split('\0').filter(Boolean).filter((source) => {
    const parts = source.replaceAll('\\', '/').split('/');
    return CODE_EXTENSIONS.has(path.extname(source).toLowerCase()) &&
      !parts.some((part) => FORBIDDEN_DIRECTORIES.has(part.toLowerCase()));
  }).sort();
  return { files, fingerprint: hashSources(spec, files) };
}

function graphMetrics(graph, spec) {
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new Error(`${spec.repository}: graph has no nodes`);
  }
  const links = graph.links ?? graph.edges;
  if (!Array.isArray(links) || links.length === 0) {
    throw new Error(`${spec.repository}: graph has no edges`);
  }
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node?.id || ids.has(node.id)) {
      throw new Error(`${spec.repository}: invalid or duplicate graph node: ${node?.id}`);
    }
    ids.add(node.id);
  }
  for (const link of links) {
    if (!ids.has(link?.source) || !ids.has(link?.target)) {
      throw new Error(`${spec.repository}: dangling graph edge: ${link?.source} -> ${link?.target}`);
    }
  }
  for (const symbol of spec.querySymbols) {
    const query = symbol.toLowerCase();
    if (!graph.nodes.some((node) => {
      const label = node.label?.toLowerCase();
      return label === query || label === `${query}()` || label === `${query}.js` ||
        label === `${query}.jsx` || label === `${query}.ts` || label === `${query}.tsx`;
    })) {
      throw new Error(`${spec.repository}: query symbol not found: ${symbol}`);
    }
  }
  const sources = graphSources(graph, spec);
  if (sources.length === 0) throw new Error(`${spec.repository}: graph has no source files`);
  const communities = new Set(
    graph.nodes.map((node) => node.community).filter((value) => value !== undefined)
  );
  return {
    files: sources.length,
    nodes: graph.nodes.length,
    edges: links.length,
    communities: communities.size,
    sources,
  };
}

function normalizeGeneratedGraph(spec) {
  const file = graphPath(spec.root);
  const graph = readJson(file);
  const ids = new Set((graph.nodes ?? []).map((node) => node.id));
  const key = Array.isArray(graph.links) ? 'links' : 'edges';
  const links = graph[key] ?? [];
  const validLinks = links.filter((link) => ids.has(link?.source) && ids.has(link?.target));
  const prunedDanglingEdges = links.length - validLinks.length;
  graph[key] = validLinks;
  if (prunedDanglingEdges > 0) fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
  return { graph, prunedDanglingEdges };
}

function manifestFiles(root) {
  const manifest = readJson(manifestPath(root));
  return Object.keys(manifest).length;
}

function ignoredPaths(root) {
  const file = path.join(root, '.graphifyignore');
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing Graphify ignore file: ${file}`);
  }
  const entries = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const required of REQUIRED_IGNORES) {
    if (!entries.includes(required)) throw new Error(`Missing Graphify ignore rule: ${required}`);
  }
  return entries;
}

export function validateGraphScope(graph, spec) {
  return graphMetrics(graph, spec);
}

function createMetadata(spec, graph, mode, prunedDanglingEdges) {
  const metrics = graphMetrics(graph, spec);
  const graphFile = graphPath(spec.root);
  const corpus = fingerprintCorpus(spec);
  return {
    schemaVersion: 1,
    repository: spec.repository,
    root: spec.root,
    branch: git(spec.root, 'branch', '--show-current'),
    head: git(spec.root, 'rev-parse', 'HEAD'),
    sourceFingerprint: corpus.fingerprint,
    graphSha256: sha256(fs.readFileSync(graphFile)),
    graphifyVersion: execFileSync(GRAPHIFY, ['--version'], { encoding: 'utf8' }).trim(),
    builtAt: new Date().toISOString(),
    buildMode: mode,
    scope: 'repository-code-only',
    ignoredPaths: ignoredPaths(spec.root),
    corpusFiles: corpus.files.length,
    manifestFiles: manifestFiles(spec.root),
    files: metrics.files,
    nodes: metrics.nodes,
    edges: metrics.edges,
    communities: metrics.communities,
    normalization: { prunedDanglingEdges },
  };
}

export function validateScope(spec) {
  const graphFile = graphPath(spec.root);
  const metaFile = metadataPath(spec.root);
  const graph = readJson(graphFile);
  const metadata = readJson(metaFile);
  const metrics = graphMetrics(graph, spec);
  const corpus = fingerprintCorpus(spec);
  const expected = {
    repository: spec.repository,
    root: spec.root,
    branch: git(spec.root, 'branch', '--show-current'),
    head: git(spec.root, 'rev-parse', 'HEAD'),
    sourceFingerprint: corpus.fingerprint,
    graphSha256: sha256(fs.readFileSync(graphFile)),
    graphifyVersion: execFileSync(GRAPHIFY, ['--version'], { encoding: 'utf8' }).trim(),
    ignoredPaths: ignoredPaths(spec.root),
    corpusFiles: corpus.files.length,
    manifestFiles: manifestFiles(spec.root),
  };
  if (metadata.schemaVersion !== 1 || metadata.scope !== 'repository-code-only') {
    throw new Error(`${spec.repository}: unsupported graph scope metadata`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(metadata[key]) !== JSON.stringify(value)) {
      throw new Error(`${spec.repository}: stale graph metadata: ${key}`);
    }
  }
  if (!/^graphify \d+\.\d+\.\d+$/.test(metadata.graphifyVersion)) {
    throw new Error(`${spec.repository}: invalid Graphify version metadata`);
  }
  if (!Number.isFinite(Date.parse(metadata.builtAt))) {
    throw new Error(`${spec.repository}: invalid graph build timestamp`);
  }
  if (!Number.isInteger(metadata.normalization?.prunedDanglingEdges) ||
    metadata.normalization.prunedDanglingEdges < 0) {
    throw new Error(`${spec.repository}: invalid graph normalization metadata`);
  }
  for (const key of ['files', 'nodes', 'edges', 'communities']) {
    if (metadata[key] !== metrics[key]) throw new Error(`${spec.repository}: stale graph metric: ${key}`);
  }
  return { ...metrics, ...metadata };
}

function graphify(spec, mode) {
  const args = mode === 'build'
    ? ['extract', spec.root, '--out', spec.root, '--code-only', '--no-cluster', '--force']
    : ['extract', spec.root, '--out', spec.root, '--code-only', '--no-cluster'];
  const result = spawnSync(GRAPHIFY, args, { cwd: spec.root, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${spec.repository}: Graphify ${mode} failed`);
  const { graph, prunedDanglingEdges } = normalizeGeneratedGraph(spec);
  const metadata = createMetadata(spec, graph, mode, prunedDanglingEdges);
  fs.writeFileSync(metadataPath(spec.root), `${JSON.stringify(metadata, null, 2)}\n`);
  return validateScope(spec);
}

function selectedSpecs(target = 'all') {
  if (target === 'all') return Object.values(GRAPH_SPECS);
  if (!GRAPH_SPECS[target]) throw new Error('Target must be mobile, site, or all');
  return [GRAPH_SPECS[target]];
}

function validateNoMixedFallback() {
  const mixedGraph = path.join(WORKSPACE_ROOT, 'graphify-out/graph.json');
  if (fs.existsSync(mixedGraph)) {
    throw new Error(`Mixed workspace graph remains an active fallback: ${mixedGraph}`);
  }
}

async function main() {
  const [command = 'validate', target = 'all', ...rest] = process.argv.slice(2);
  if (rest.length || !['build', 'update', 'validate', 'metrics'].includes(command)) {
    throw new Error('Usage: check-graph-scopes.mjs <build|update|validate|metrics> [mobile|site|all]');
  }
  for (const spec of selectedSpecs(target)) {
    const result = command === 'build' || command === 'update'
      ? graphify(spec, command)
      : validateScope(spec);
    console.log(
      `GRAPH SCOPE ${spec.repository} PASS / ${result.files} files / ` +
      `${result.nodes} nodes / ${result.edges} edges / ${result.communities} communities`
    );
  }
  validateNoMixedFallback();
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    await main();
  } catch (error) {
    console.error(`GRAPH SCOPE TOOLING_ERROR\n${error.message}`);
    process.exitCode = 2;
  }
}
