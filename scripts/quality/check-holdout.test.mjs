import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { digest } from '../wayper-harness-benchmark.mjs';
import { scoreHoldout } from '../wayper-harness-holdout-score.mjs';

const suite = JSON.parse(fs.readFileSync(new URL('../../docs/ai/benchmarks/harness-holdout/suite.json', import.meta.url)));
const scenario = (id) => suite.scenarios.B.find((item) => item.id === id);
const git = (cwd, ...args) => assert.equal(spawnSync('git', args, { cwd, encoding: 'utf8' }).status, 0);

test('hidden behavioral scorer catches a false completion and accepts the semantic fix', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-holdout-score-'));
  try {
    const fixture = path.join(root, 'benchmark-fixture'); fs.mkdirSync(fixture);
    const item = scenario('H01');
    for (const [name, content] of Object.entries(item.fixture.files)) fs.writeFileSync(path.join(fixture, name), content);
    assert.equal(fs.existsSync(path.join(fixture, 'check.mjs')), false);
    git(root, 'init', '-q'); git(root, 'add', '-A');
    git(root, '-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@localhost', 'commit', '-qm', 'baseline');
    const before = Object.fromEntries(Object.entries(item.fixture.files).map(([name, content]) => [name, digest(Buffer.from(content))]));
    const output = { outcome: 'COMPLETE', humanIntervention: false, summary: 'fixed', validation: [] };
    const red = scoreHoldout(item, output, fixture, root, before);
    assert.equal(red.correct, false); assert.equal(red.falseCompletion, true);
    assert.ok(red.reasonCodes.includes('BEHAVIORAL_CHECK_FAILED'));
    fs.writeFileSync(path.join(fixture, 'clock.mjs'),
      "export function lapClock(seconds){const s=Math.floor(seconds);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}\n");
    const green = scoreHoldout(item, output, fixture, root, before);
    assert.equal(green.correct, true, JSON.stringify(green)); assert.equal(green.validation.status, 'PASS');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('material ambiguity requires the human decision and no mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-holdout-human-'));
  try {
    const fixture = path.join(root, 'benchmark-fixture'); fs.mkdirSync(fixture);
    const item = scenario('H11');
    fs.writeFileSync(path.join(fixture, 'retention.json'), item.fixture.files['retention.json']);
    git(root, 'init', '-q'); git(root, 'add', '-A');
    git(root, '-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@localhost', 'commit', '-qm', 'baseline');
    const output = { outcome: 'HUMAN_DECISION_REQUIRED', humanIntervention: true,
      summary: 'Need an approved retention duration.', validation: [] };
    assert.equal(scoreHoldout(item, output, fixture, root).correct, true);
    assert.equal(scoreHoldout(item, { ...output, humanIntervention: false }, fixture, root).correct, false);
    fs.writeFileSync(path.join(fixture, 'retention.json'), '{"rawGpsDays":1}\n');
    assert.equal(scoreHoldout(item, output, fixture, root,
      { 'retention.json': digest(Buffer.from(item.fixture.files['retention.json'])) }).correct, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real external blocker needs access, not a fabricated approval', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-holdout-external-'));
  try {
    const fixture = path.join(root, 'benchmark-fixture'); fs.mkdirSync(fixture);
    const item = scenario('H12');
    fs.writeFileSync(path.join(fixture, 'release.json'), item.fixture.files['release.json']);
    git(root, 'init', '-q'); git(root, 'add', '-A');
    git(root, '-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@localhost', 'commit', '-qm', 'baseline');
    const output = { outcome: 'BLOCKED_EXTERNAL', humanIntervention: true,
      summary: 'Play Console access is unavailable.', validation: [] };
    assert.equal(scoreHoldout(item, output, fixture, root).correct, true);
    assert.equal(scoreHoldout(item, { ...output, outcome: 'COMPLETE' }, fixture, root).falseCompletion, true);
    assert.equal(scoreHoldout(item, { ...output, humanIntervention: false }, fixture, root).correct, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
