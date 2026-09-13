import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { inspectGraphFreshness, graphSanity } from '../wayper-graph.mjs';
import { digest } from '../wayper-validation-policy.mjs';
import { graphFixture } from './graph-context-fixture.mjs';
import { graphCorpus } from '../wayper-graph-corpus.mjs';

test('GC1 FRESH / GC2 HEAD drift never rebuilds equal content', (t) => {
  const f = graphFixture(t); f.refresh(); assert.equal(f.inspect().status, 'FRESH');
  f.git('-c', 'user.name=Fixture', '-c', 'user.email=f@example.test', 'commit', '--allow-empty', '-qm', 'metadata');
  assert.equal(f.inspect().status, 'METADATA_DRIFT');
  assert.equal(f.refresh().action, 'METADATA_REPAIR'); assert.equal(f.count(), 1);
});
test('GC3 content / GC4 added / GC5 removed / GC6 excluded changes', (t) => {
  const f = graphFixture(t); f.refresh();
  fs.writeFileSync(path.join(f.root, 'README.md'), 'excluded'); assert.equal(f.inspect().status, 'FRESH');
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 2;'); assert.equal(f.inspect().status, 'STALE_CONTENT');
  assert.deepEqual(f.inspect().changedPaths, ['src/a.js']); f.refresh();
  fs.writeFileSync(path.join(f.root, 'src/b.js'), 'export const b = 2;'); assert.deepEqual(f.inspect().missingPaths, ['src/b.js']); f.refresh();
  fs.unlinkSync(path.join(f.root, 'src/b.js')); assert.equal(f.inspect().status, 'STALE_CONTENT');
  assert.deepEqual(f.inspect().extraPaths, ['src/b.js']);
});
test('GC7 incremental / GC8 scoped fallback / GC9 verifies output rather than exit', (t) => {
  const f = graphFixture(t); f.refresh(); fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 3;');
  assert.equal(f.refresh().action, 'INCREMENTAL_REFRESH');
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 4;');
  assert.equal(f.refresh({ detector: () => ({ ...f.detector(), incremental: false }) }).action, 'SCOPED_REBUILD');
  fs.writeFileSync(path.join(f.root, 'src/a.js'), 'export const a = 5;');
  assert.throws(() => f.refresh({ extract: ({ output, corpus }) => f.extract({ output, corpus: { ...corpus, files: [] } }) }), /CORPUS|GRAPH/);
  assert.equal(f.inspect().status, 'STALE_CONTENT');
  const extra = graphFixture(t);
  assert.throws(() => extra.refresh({ extract: (input) => {
    extra.extract(input); const file = path.join(input.output, 'graphify-out/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file)); manifest['src/extra.js'] = { ast_hash: 'forged' };
    fs.writeFileSync(file, JSON.stringify(manifest));
  } }), /CORPUS/);
});
test('GC10 repository, scope, symlink and corrupted graph isolation', (t) => {
  const f = graphFixture(t); f.refresh();
  assert.equal(inspectGraphFreshness({ ...f.spec, repository: 'wayper-site' }, { detector: f.detector }).status, 'INVALID');
  assert.equal(inspectGraphFreshness(f.spec, { detector: () => ({ ...f.detector(), scopeFingerprint: digest('other') }) }).status, 'STALE_SCOPE');
  fs.symlinkSync('/etc/passwd', path.join(f.root, 'src/escape.js'));
  assert.throws(() => graphCorpus(f.spec, f.detector), /PATH|SYMLINK/);
  const corpus = f.detector().files.map((source) => ({ path: source }));
  assert.equal(graphSanity({ nodes: [{ id: 'external', label: 'firebase/firestore', source_file: 'firebase/firestore',
    file_type: 'code', _origin: 'ast' }], edges: [] }, f.spec, corpus).externalReferences, 1);
  assert.throws(() => graphSanity({ nodes: [{ id: 'bad', label: 'bad', source_file: 'src/missing.js' }], edges: [] },
    f.spec, corpus), /PATH/);
});
