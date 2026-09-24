import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { addWorktree, readSuite, removeWorktree } from '../wayper-harness-benchmark.mjs';
import { blindInvocation, prepareBlindWorkspace, score } from '../wayper-harness-benchmark-agentic.mjs';

test('blind candidate boundary', async (t) => {
  const item = addWorktree(readSuite().candidates.V2.sha, 'blindness');
  try {
    const workspace = prepareBlindWorkspace(item);
    const ownRuntime = path.join(item.parent, 'own-runtime');
    fs.mkdirSync(ownRuntime);
    fs.writeFileSync(path.join(ownRuntime, 'own.txt'), 'OWN_RUNTIME_VISIBLE');
    fs.writeFileSync(path.join(item.parent, 'other-trial.log'), 'OTHER_TRIAL_SECRET');
    const hidden = [
      'docs/ai/benchmarks/harness-v1-v2/suite.json',
      'docs/ai/benchmarks/harness-v1-v2/report.md',
      'docs/ai/benchmarks/harness-v1-v2/results/operational/tier-b.json',
      'docs/ai/benchmarks/harness-holdout/suite.json',
      'docs/ai/benchmarks/harness-holdout/freeze.json',
      'scripts/wayper-harness-benchmark-agentic.mjs',
      'scripts/wayper-harness-holdout-score.mjs',
    ];
    for (const relative of hidden) assert.equal(fs.existsSync(path.join(workspace, relative)), false);
    assert.equal(fs.existsSync(path.join(workspace, 'src')), true); // BI6
    assert.equal(fs.existsSync(path.join(workspace, 'AGENTS.md')), true);
    const check = (script) => {
      const run = spawnSync('bwrap', blindInvocation(workspace, ownRuntime, '/bin/sh', ['-c', script]),
        { cwd: workspace, encoding: 'utf8', timeout: 10_000 });
      assert.equal(run.status, 0, run.stderr || run.stdout);
    };
    await t.test('BI1 GroundTruth hidden', () => check('test ! -e /home/eduardo/Wayper/wayper/docs/ai/benchmarks/harness-v1-v2/suite.json'));
    await t.test('BI2 reports hidden', () => check('test ! -e /tmp/workspace/docs/ai/benchmarks/harness-v1-v2/report.md'));
    await t.test('BI3 prior results hidden', () => check('test ! -e /tmp/workspace/docs/ai/benchmarks/harness-v1-v2/results/operational/tier-b.json'));
    await t.test('BI4 other raw logs hidden', () => check('test ! -e /tmp/other-trial.log && test ! -e /home/eduardo/Wayper/wayper/.wayper-context/benchmark-runs'));
    await t.test('BI5 scorer internals and Git history hidden', () => check('test ! -e /tmp/workspace/scripts/wayper-harness-benchmark-agentic.mjs && ! git show HEAD:docs/ai/benchmarks/harness-v1-v2/suite.json >/dev/null 2>&1'));
    await t.test('BI6 product source accessible', () => check('test -f /tmp/workspace/AGENTS.md && test -d /tmp/workspace/src'));
    await t.test('BI7 own runtime accessible', () => check('test "$(cat /tmp/runtime/own.txt)" = OWN_RUNTIME_VISIBLE'));
    const scenario = readSuite().scenarios.B.find((item) => item.id === 'B7');
    const fixture = path.join(workspace, 'benchmark-fixture'); fs.mkdirSync(fixture);
    for (const [name, content] of Object.entries(scenario.fixture.files)) fs.writeFileSync(path.join(fixture, name), content);
    fs.writeFileSync(path.join(fixture, 'auth.mjs'),
      'export const canRead=(resource,user)=>resource.public===true||Boolean(user&&resource.ownerId===user.id);\n');
    await t.test('BI8 controller scores after trial', () => {
      assert.equal(score(scenario, { outcome: 'COMPLETE' }, fixture, workspace).correct, true);
    });
    await t.test('BI9 broad search misses evaluation files', () => check('! rg --files /tmp/workspace /home/eduardo /tmp | rg "suite.json|tier-b.json|other-trial.log|benchmark-agentic"'));
    await t.test('BI10 symlink and traversal cannot escape', () => {
      check('ln -s /home/eduardo/Wayper/wayper/docs/ai/benchmarks/harness-v1-v2/suite.json /tmp/workspace/probe && test ! -e /tmp/workspace/probe && test ! -e /tmp/workspace/../../home/eduardo/Wayper/wayper/docs/ai/benchmarks/harness-v1-v2/suite.json');
      fs.unlinkSync(path.join(workspace, 'probe'));
    });
    await t.test('BI11 holdout suite, scorer, report, results and raw trials hidden', () => check('test ! -e /tmp/workspace/docs/ai/benchmarks/harness-holdout/suite.json && test ! -e /tmp/workspace/scripts/wayper-harness-holdout-score.mjs && test ! -e /home/eduardo/Wayper/wayper/docs/ai/benchmarks/harness-holdout/report.md && test ! -e /home/eduardo/Wayper/wayper/docs/ai/benchmarks/harness-holdout/results.json && test ! -e /home/eduardo/Wayper/wayper/.wayper-context/benchmark-runs/holdout'));
    assert.equal(fs.readFileSync(path.join(item.parent, 'other-trial.log'), 'utf8'), 'OTHER_TRIAL_SECRET');
  } finally { removeWorktree(item); }
});
