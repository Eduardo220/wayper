import { graphFixture } from './graph-context-fixture.mjs';
import { startWorkingContext, writeWorkingContext } from '../wayper-context.mjs';
import { resolveContext } from '../wayper-context-economy.mjs';
import { loadCapabilityFiles } from './check-capability-routing.mjs';
import { refreshContextMap, finalizeContextMap } from '../wayper-context-map.mjs';
import crypto from 'node:crypto';
import { digest } from '../wayper-validation-policy.mjs';

export function fixture(t) {
  const f = graphFixture(t); const repositories = [{ id: 'wayper', root: f.root, logicalRoot: '.' }];
  const start = (threadId = 'economy') => {
    const state = startWorkingContext({ root: f.root, threadId, objective: 'Context economy', taskClass: 'ARCHITECTURAL', repositories });
    state.contextMap = refreshContextMap(null, { goalId: state.goalId, execution: state.execution, repositories,
      taskClass: state.taskClass, tokenCeiling: state.budget.contextTokenCeiling, registry: loadCapabilityFiles().registry });
    state.contextMap.capabilities.required = ['context-efficiency'];
    state.contextMap = finalizeContextMap(state.contextMap);
    writeWorkingContext(state, { root: f.root, identity: state.execution.identity }); return state.execution.identity;
  };
  const identity = start();
  const options = { root: f.root, identity, graphOptions: f.options };
  const source = { kind: 'SOURCE_SLICE', repository: 'wayper', path: 'src/a.js', range: null };
  let queries = 0;
  const graphOptions = { ...f.options, executeQuery: ({ request }) => {
    queries++; const startedAt = new Date().toISOString(); const text = 'a depends on source';
    return { text, execution: { executionId: crypto.randomUUID(), startedAt, finishedAt: new Date().toISOString(), exitCode: 0,
      queryFingerprint: digest(request), resultFingerprint: digest(text), stdoutBytes: Buffer.byteLength(text),
      stderrFingerprint: digest(''), stderrBytes: 0, outputPolicy: 'BOUNDED_CACHE' } };
  } };
  return { ...f, repositories, start, identity, options: { ...options, graphOptions }, source,
    resolve: (request = source, extra = {}) => resolveContext({ ...options, graphOptions, ...extra, request }),
    queryCount: () => queries };
}
