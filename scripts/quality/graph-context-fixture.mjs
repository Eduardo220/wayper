import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectGraphFreshness, ensureGraphFresh } from '../wayper-graph.mjs';
import { digest } from '../wayper-validation-policy.mjs';

export function graphFixture(t, repository = 'wayper') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'graphify-out/\n.wayper-context/\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=f@example.test', 'commit', '-qm', 'initial');
  const spec = { repository, root, peerDirectory: repository === 'wayper' ? 'wayper-site' : 'wayper', querySymbols: [] };
  const detector = () => ({ files: fs.readdirSync(path.join(root, 'src')).filter((p) => p.endsWith('.js')).map((p) => `src/${p}`),
    scopeFingerprint: digest('fixture-code'), version: 'graphify fixture', incremental: true, ignored: [] });
  let executions = 0;
  const extract = ({ output, corpus }) => {
    executions++;
    fs.mkdirSync(path.join(output, 'graphify-out'), { recursive: true });
    fs.writeFileSync(path.join(output, 'graphify-out/graph.json'), JSON.stringify({ nodes: corpus.files.map((f) =>
      ({ id: f.path, label: f.path, source_file: f.path })), edges: [] }));
    fs.writeFileSync(path.join(output, 'graphify-out/manifest.json'), JSON.stringify(Object.fromEntries(corpus.files.map((f) => [f.path, { ast_hash: f.md5 }]))));
  };
  const options = { detector, extract, allowDirty: true };
  return { root, spec, git, detector, extract, options, count: () => executions,
    refresh: (extra = {}) => ensureGraphFresh(spec, { ...options, ...extra }),
    inspect: () => inspectGraphFreshness(spec, { detector }) };
}
