import { completionFixture } from './completion-fixture.mjs';
import { finalizeContextMap, integrateRouterOutput } from '../wayper-context-map.mjs';
import { routeTask } from '../wayper-agent-router.mjs';
import { planDispatch, issueGrant } from '../wayper-dispatch.mjs';
import { prepareDispatchPacket } from '../wayper-dispatch-adapters.mjs';
import { acquireLease } from '../wayper-ownership.mjs';
export function writer(t, extra = {}, cross = false) {
  const f = completionFixture(t, cross);
  f.state.contextMap.capabilities.required = ['quality-gates'];
  f.state.contextMap = finalizeContextMap(f.state.contextMap); f.save();
  f.input.repositories[0].capabilities = ['quality-gates'];
  f.options7 = { root: f.root, identity: f.identity, actorId: 'main' };
  f.task = { taskId: 'task-one', goalReference: f.identity, repository: 'wayper', operation: 'MUTATE',
    scopes: [{ kind: 'FILE', path: 'README.md' }], capabilities: ['quality-gates'], risks: ['CONCURRENCY'], taskClass: 'ARCHITECTURAL', ...extra };
  f.plan7 = () => planDispatch({ ...f.options7, task: f.task, actor: { actorId: 'main', kind: 'MAIN_OWNER' } });
  f.grant = () => issueGrant({ ...f.options7, plan: f.plan7() });
  f.authorize = async () => {
    const g = f.grant(); const lease = acquireLease({ ...f.options7, grantId: g.grantId });
    const envelope = await prepareDispatchPacket({ ...f.options7, grantId: g.grantId });
    return { ...f.options7, grantId: g.grantId, actorId: 'main', lease, envelope };
  };
  return f;
}
export function reader(t) {
  const f = writer(t, { operation: 'READ', taskClass: 'BOUNDED', capabilities: ['route-geometry'], risks: ['GPS_GEO'] });
  const router = routeTask({ schemaVersion: 1, goalId: f.state.goalId, operation: 'REVIEW_ROUTE_GEOMETRY',
    repositories: ['wayper'], changedFiles: [], candidatePaths: [], riskFlags: ['GPS_GEO'],
    knownCapabilities: ['route-geometry'], knownGoodCapabilities: [], capabilityAssessmentComplete: true,
    structuralUncertainty: false, taskClass: 'BOUNDED', orchestrationMode: 'S1', executionIntent: 'READ_ONLY_SPECIALIST', signals: [] }, f.registry);
  f.state.contextMap = integrateRouterOutput(f.state.contextMap, router, { registry: f.registry }); f.save();
  f.actor = { actorId: 'specialist-one', kind: 'READ_ONLY_SPECIALIST', profileId: router.selectionReceipt.profileIds[0] };
  f.plan7 = () => planDispatch({ ...f.options7, task: f.task, actor: f.actor, routerAssessment: router.selectionReceipt });
  f.grant = () => issueGrant({ ...f.options7, plan: f.plan7(), routerAssessment: router.selectionReceipt });
  f.readerOptions = async () => { const g = f.grant(); const options = { ...f.options7, grantId: g.grantId, actorId: f.actor.actorId };
    const parent = issueGrant({ ...f.options7, plan: planDispatch({ ...f.options7, task: f.task, actor: { actorId: 'main', kind: 'MAIN_OWNER' } }) });
    return { ...options, parentGrantId: parent.grantId, parentActorId: 'main', envelope: await prepareDispatchPacket(options) }; };
  return f;
}
