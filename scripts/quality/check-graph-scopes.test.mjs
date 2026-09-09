import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fingerprintCorpus, validateGraphScope } from './check-graph-scopes.mjs';

function fixture(repository = 'wayper', peerDirectory = 'wayper-site') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-graph-scope-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/entry.js'), 'export function MapScreen() {}\n');
  fs.writeFileSync(path.join(root, 'src/helper.js'), 'export function helper() {}\n');
  return {
    root,
    spec: { repository, root, peerDirectory, querySymbols: ['MapScreen'] },
    graph: {
      nodes: [
        { id: 'entry', label: 'MapScreen', source_file: 'src/entry.js' },
        { id: 'helper', label: 'helper', source_file: 'src/helper.js' },
      ],
      links: [{ source: 'entry', target: 'helper', source_file: 'src/entry.js' }],
    },
  };
}

test('GS1 accepts a repository-scoped graph with valid nodes and edges', (t) => {
  const { root, spec, graph } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(validateGraphScope(graph, spec), {
    files: 2,
    nodes: 2,
    edges: 1,
    communities: 0,
    sources: ['src/entry.js', 'src/helper.js'],
  });
});

test('GS2 rejects cross-repository and backup sources', (t) => {
  const { root, spec, graph } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  graph.nodes[0].source_file = 'wayper-site/src/page.tsx';
  assert.throws(() => validateGraphScope(graph, spec), /contaminated graph source/);
  graph.nodes[0].source_file = 'backups/old/src/entry.js';
  assert.throws(() => validateGraphScope(graph, spec), /contaminated graph source/);
});

test('GS3 rejects source escapes and dangling edges', (t) => {
  const { root, spec, graph } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  graph.nodes[0].source_file = '../wayper-site/src/page.tsx';
  assert.throws(() => validateGraphScope(graph, spec), /contaminated graph source/);
  graph.nodes[0].source_file = 'src/entry.js';
  graph.links[0].target = 'missing';
  assert.throws(() => validateGraphScope(graph, spec), /dangling graph edge/);
});

test('GS4 corpus fingerprint detects new code but ignores docs and backup copies', (t) => {
  const { root, spec } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const before = fingerprintCorpus(spec);
  fs.writeFileSync(path.join(root, 'docs.md'), '# docs\n');
  fs.mkdirSync(path.join(root, 'backup'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backup/old.js'), 'export const stale = true;\n');
  assert.deepEqual(fingerprintCorpus(spec), before);
  fs.writeFileSync(path.join(root, 'src/new.js'), 'export const current = true;\n');
  assert.notEqual(fingerprintCorpus(spec).fingerprint, before.fingerprint);
});
