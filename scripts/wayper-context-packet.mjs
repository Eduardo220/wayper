import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readWorkingContext, repositoryDefinitions, ROOT } from './wayper-context.mjs';
import { assertGoalExecution } from './wayper-context-identity.mjs';
import { CONTEXT_MAP_SCHEMA_VERSION, capabilityRegistryFingerprint, validateContextMap } from './wayper-context-map.mjs';
import { loadCapabilityFiles, NATIVE_ROLES, validateRegistry } from './quality/check-capability-routing.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const CONTEXT_PACKET_SCHEMA_VERSION = 1;
export const CONTEXT_PACKET_EVALS_PATH = 'docs/ai/context-packet-evals.json';
export const REVIEW_POLICIES = new Set(['INDEPENDENT_REVIEW_PACKET', 'FOLLOWUP_REVIEW_PACKET']);
const TARGET_TYPES = new Set(['agentProfile', 'nativeRole', 'capabilitySet', 'validationRole']);
const REVIEW_ROLES = new Set(['independent-review', 'followup-review']);
const TASK_CEILINGS = Object.freeze({
  TRIVIAL: 1_500, BOUNDED: 4_000, BUG: 8_000, INVESTIGATION: 10_000,
  ARCHITECTURAL: 16_000, CRITICAL_RUNTIME: 24_000,
});
const TARGET_DIVISORS = Object.freeze({ agentProfile: 4, nativeRole: 3, capabilitySet: 5, validationRole: 3 });
const REUSABLE_EVIDENCE = new Set(['PROVEN', 'HIGH_CONFIDENCE']);
const HASH = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEY = /source.?blob|transcript|chain.?of.?thought|raw.?diff|raw.?graph|inline.?content/i;

const sortedUnique = (items = []) => [...new Set(items)].sort();
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const overlap = (left = [], right) => left.some((item) => right.has(item));
const qualify = (repository, ref) => `${repository}:${String(ref).split('#', 1)[0]}`;
export const isReviewConclusionEvidence = (item) => item?.reviewDisposition === 'PRIOR_ANALYSIS_CONCLUSION';

function packetIdentity(packet) {
  const copy = structuredClone(packet);
  delete copy.packetId;
  delete copy.metrics;
  delete copy.contextBudget.status;
  return copy;
}

function normalizedPath(value, repositories) {
  let repository; let relativePath;
  if (typeof value === 'string') {
    const separator = value.indexOf(':');
    if (separator > 0 && repositories.includes(value.slice(0, separator))) {
      repository = value.slice(0, separator); relativePath = value.slice(separator + 1);
    } else if (repositories.length === 1) [repository, relativePath] = [repositories[0], value];
  } else if (value && typeof value === 'object') ({ repository, path: relativePath } = value);
  relativePath = relativePath?.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!repositories.includes(repository) || !relativePath || relativePath.startsWith('/') ||
    relativePath.split('/').includes('..')) throw new Error(`Invalid packet target path: ${JSON.stringify(value)}`);
  return { repository, path: relativePath };
}

function normalizeTarget(map, target, registry, routerOutput) {
  if (!target || !TARGET_TYPES.has(target.type) || typeof target.id !== 'string' || !target.id) {
    throw new Error('Invalid Context Packet target');
  }
  const state = validateRegistry(registry);
  let profile; let capabilities; let repositories = target.repositories ?? map.repositories;
  if (target.type === 'agentProfile') {
    profile = state.agentProfiles.get(target.id);
    if (!profile) throw new Error(`Unknown agent profile target: ${target.id}`);
    capabilities = profile.capabilities.filter((id) =>
      [...map.capabilities.required, ...map.capabilities.optional].includes(id));
    repositories = repositories.filter((id) => (profile.repositories ?? ['wayper']).includes(id));
  } else if (target.type === 'nativeRole') {
    if (!NATIVE_ROLES.has(target.id)) throw new Error(`Unknown native role target: ${target.id}`);
    capabilities = target.capabilities ?? [...map.capabilities.required, ...map.capabilities.optional];
  } else if (target.type === 'capabilitySet') {
    capabilities = target.capabilities;
  } else {
    if (!REVIEW_ROLES.has(target.id)) throw new Error(`Unknown validation role target: ${target.id}`);
    capabilities = target.capabilities ?? [...map.capabilities.required, ...map.capabilities.optional];
  }
  repositories = sortedUnique(repositories);
  capabilities = sortedUnique(capabilities ?? []);
  if (!repositories.length || repositories.some((id) => !map.repositories.includes(id))) {
    throw new Error('Packet target has no valid repository boundary');
  }
  if (!capabilities.length || capabilities.some((id) => !state.capabilities.has(id)) ||
    capabilities.some((id) => ![...map.capabilities.required, ...map.capabilities.optional].includes(id))) {
    throw new Error('Packet target capabilities must exist in the Goal-scoped Context Map and Registry V2');
  }
  const selectedRouterProfile = routerOutput?.selectedProfiles?.find((item) => item.id === target.id);
  const expectedReviewPolicy = target.id === 'independent-review'
    ? 'INDEPENDENT_REVIEW_PACKET' : 'FOLLOWUP_REVIEW_PACKET';
  const reviewPolicy = target.type === 'validationRole' ? (target.reviewPolicy ?? expectedReviewPolicy) : null;
  if (reviewPolicy && (!REVIEW_POLICIES.has(reviewPolicy) || reviewPolicy !== expectedReviewPolicy)) {
    throw new Error('Invalid review packet policy');
  }
  return { profile, capabilities, repositories, selectedRouterProfile, reviewPolicy };
}

function packetBudget(taskClass, target) {
  const contextCeiling = TASK_CEILINGS[taskClass];
  if (!contextCeiling) throw new Error(`Unsupported packet task class: ${taskClass}`);
  if (target.tokenProxyCeiling !== undefined && (!Number.isInteger(target.tokenProxyCeiling) || target.tokenProxyCeiling < 1)) {
    throw new Error('Invalid target packet budget');
  }
  return target.tokenProxyCeiling ?? Math.max(256, Math.ceil(contextCeiling / TARGET_DIVISORS[target.type]));
}

function finalizePacket(packet, budgetReason) {
  const next = structuredClone(packet);
  next.packetId = 'CP-000000000000';
  let metrics = { ...next.metrics };
  for (let index = 0; index < 8; index += 1) {
    next.metrics = metrics;
    const packetBytes = Buffer.byteLength(JSON.stringify(next));
    const packetTokenProxy = Math.ceil(packetBytes / 4);
    const overBudget = packetTokenProxy > next.contextBudget.tokenProxyCeiling;
    next.contextBudget.status = overBudget ? 'OVER_BUDGET' : 'WITHIN_BUDGET';
    if (overBudget && budgetReason) next.contextBudget.reason = budgetReason;
    else delete next.contextBudget.reason;
    metrics = { ...metrics, packetBytes, packetTokenProxy };
  }
  next.metrics = metrics;
  next.packetId = `CP-${sha256(stable(packetIdentity(next))).slice(7, 19)}`;
  return next;
}

function buildContextPacketCandidate(contextMap, target, { registry, routerOutput } = {}, requiredOnly = false) {
  if (contextMap?.schemaVersion !== CONTEXT_MAP_SCHEMA_VERSION || contextMap.validation?.structural !== 'VALID' ||
    !HASH.test(contextMap.validation?.fingerprint ?? '') || !registry ||
    contextMap.registryFingerprint !== capabilityRegistryFingerprint(registry)) {
    throw new Error('Validated Context Map with current Registry V2 is required');
  }
  const normalized = normalizeTarget(contextMap, target, registry, routerOutput);
  if (requiredOnly) normalized.capabilities = normalized.capabilities
    .filter((id) => contextMap.capabilities.required.includes(id));
  const capabilitySet = new Set(normalized.capabilities);
  const repositorySet = new Set(normalized.repositories);
  if (!Array.isArray(target.paths ?? []) || (target.paths ?? []).length > 256) {
    throw new Error('Packet target paths exceed the authority limit');
  }
  const authoritativePaths = new Set([
    ...contextMap.evidence.map((item) => qualify(item.repository, item.path)),
    ...contextMap.dependencies.flatMap((item) => [qualify(item.from.repository, item.from.ref),
      qualify(item.to.repository, item.to.ref)]),
    ...Object.values(contextMap.repositoryState).flatMap((item) =>
      item.relevantRefs.map((ref) => qualify(item.repository, ref))),
  ]);
  const paths = new Set((target.paths ?? []).map((item) => {
    const parsed = normalizedPath(item, normalized.repositories);
    const qualified = qualify(parsed.repository, parsed.path);
    if (!authoritativePaths.has(qualified)) throw new Error(`Packet target path is absent from Context Map: ${qualified}`);
    return qualified;
  }));
  const independent = normalized.reviewPolicy === 'INDEPENDENT_REVIEW_PACKET';
  const allowedEvidence = (item) => repositorySet.has(item.repository) && REUSABLE_EVIDENCE.has(item.status) &&
    !(independent && isReviewConclusionEvidence(item));
  const selectedEvidence = new Set();
  for (const item of contextMap.evidence) {
    const relevant = overlap(item.capabilityRefs ?? [], capabilitySet) || paths.has(qualify(item.repository, item.path)) ||
      (target.type === 'validationRole' && repositorySet.has(item.repository));
    if (relevant && allowedEvidence(item)) selectedEvidence.add(item.id);
  }
  const evidenceById = new Map(contextMap.evidence.map((item) => [item.id, item]));
  const dependencyRefs = new Map();
  const closureAmbiguities = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of contextMap.dependencies) {
      if (!repositorySet.has(dependency.from.repository) || !repositorySet.has(dependency.to.repository)) continue;
      const endpoints = [qualify(dependency.from.repository, dependency.from.ref), qualify(dependency.to.repository, dependency.to.ref)];
      if (!dependency.evidenceIds.some((id) => selectedEvidence.has(id)) && !endpoints.some((item) => paths.has(item))) continue;
      const allowedDependencyEvidence = dependency.evidenceIds.filter((id) => allowedEvidence(evidenceById.get(id)));
      if (!allowedDependencyEvidence.length) {
        closureAmbiguities.push(`DEPENDENCY_PROOF_EXCLUDED:${dependency.id}`);
        continue;
      }
      if (!dependencyRefs.has(dependency.id)) { dependencyRefs.set(dependency.id, 'DEPENDENCY_CLOSURE'); changed = true; }
      for (const endpoint of endpoints) if (!paths.has(endpoint)) { paths.add(endpoint); changed = true; }
      for (const id of allowedDependencyEvidence) {
        if (!selectedEvidence.has(id)) { selectedEvidence.add(id); changed = true; }
      }
    }
  }
  for (const id of selectedEvidence) {
    const item = evidenceById.get(id);
    paths.add(qualify(item.repository, item.path));
  }
  const required = contextMap.capabilities.required.filter((id) => capabilitySet.has(id));
  const optional = contextMap.capabilities.optional.filter((id) => capabilitySet.has(id));
  const ambiguities = [...(contextMap.ambiguities ?? []).filter((item) =>
    !item.capabilities || overlap(item.capabilities, capabilitySet)).map((item) => item.code), ...closureAmbiguities];
  if (requiredOnly) ambiguities.push('OPTIONAL_CONTEXT_OMITTED_FOR_BUDGET');
  for (const capability of required) {
    if (!contextMap.evidence.some((item) => selectedEvidence.has(item.id) && (item.capabilityRefs ?? []).includes(capability))) {
      ambiguities.push(`MISSING_REQUIRED_EVIDENCE:${capability}`);
    }
  }
  const knownGoodRefs = [];
  for (const item of contextMap.knownGood) {
    if (independent) continue;
    const relevant = repositorySet.has(item.repository) && (item.capability ? capabilitySet.has(item.capability) :
      paths.has(qualify(item.repository, item.artifact)));
    if (!relevant) continue;
    if (item.status === 'KNOWN_GOOD_UNCHANGED') knownGoodRefs.push(item.id);
    else ambiguities.push(`KNOWN_GOOD_${item.status}:${item.id}`);
  }
  const proofGapRefs = contextMap.proofGaps.filter((item) => item.status === 'OPEN' &&
    !(independent && isReviewConclusionEvidence(item)) &&
    (overlap(item.capabilityRefs ?? [], capabilitySet) || item.evidenceIds.some((id) => selectedEvidence.has(id)) ||
      target.type === 'validationRole')).map((item) => item.id);
  const graphifyRefs = [];
  for (const repository of normalized.repositories) {
    const graph = contextMap.graphify[repository];
    for (const query of graph?.status === 'CURRENT' ? graph.queries : []) {
      if (overlap(query.capabilityRefs ?? [], capabilitySet) || target.type === 'validationRole') {
        graphifyRefs.push(`${repository}:${query.queryFingerprint}`);
      }
    }
    if (graph?.decision === 'REQUIRED_BY_STRUCTURAL_UNCERTAINTY' && !graphifyRefs.some((ref) => ref.startsWith(`${repository}:`))) {
      ambiguities.push(`MISSING_STRUCTURAL_EVIDENCE:${repository}`);
    }
  }
  const risks = sortedUnique(contextMap.risks ?? []);
  const invariants = sortedUnique(contextMap.invariants ?? []);
  const explicitValidations = new Set([...(target.validationRefs ?? []), ...(normalized.profile?.validators ?? []),
    ...risks.map((id) => `risk:${id}`), ...invariants.map((id) => `invariant:${id}`)]);
  const validationRefs = contextMap.validation.checks.filter((item) =>
    !(independent && isReviewConclusionEvidence(item)) && (target.type === 'validationRole' || explicitValidations.has(item.id) ||
    ['FAIL', 'BLOCKED'].includes(item.status))).map((item) => item.id);
  const selectedSourceBytes = [...selectedEvidence].reduce((total, id) => total + (evidenceById.get(id).sourceBytes ?? 0), 0);
  const duplicateRefsAvoided = contextMap.dependencies.filter((item) => dependencyRefs.has(item.id))
    .reduce((total, item) => total + item.evidenceIds.filter((id) => selectedEvidence.has(id)).length, 0);
  const packet = {
    schemaVersion: CONTEXT_PACKET_SCHEMA_VERSION,
    goalId: contextMap.goalId,
    packetId: '',
    contextMapFingerprint: contextMap.validation.fingerprint,
    target: { type: target.type, id: target.id, ...(normalized.reviewPolicy ? { reviewPolicy: normalized.reviewPolicy } : {}) },
    objective: String(target.objective ?? '').trim(),
    repositories: normalized.repositories,
    capabilities: { required, optional },
    scope: { paths: [...paths].sort(), symbols: sortedUnique([...selectedEvidence]
      .map((id) => evidenceById.get(id).symbol).filter(Boolean)) },
    riskFlags: risks,
    invariants,
    evidenceRefs: [...selectedEvidence].sort(),
    dependencyRefs: [...dependencyRefs].map(([id, reason]) => ({ id, reason })).sort((a, b) => a.id.localeCompare(b.id)),
    knownGoodRefs: sortedUnique(knownGoodRefs),
    proofGapRefs: sortedUnique(proofGapRefs),
    graphifyRefs: sortedUnique(graphifyRefs),
    validationRefs: sortedUnique(validationRefs),
    exclusions: sortedUnique([...(normalized.profile?.exclusions ?? []), ...(independent ? ['PRIOR_REVIEW_CONCLUSIONS'] : [])]),
    ambiguities: sortedUnique(ambiguities),
    contextBudget: { taskClass: contextMap.taskClass, targetType: target.type,
      tokenProxyCeiling: packetBudget(contextMap.taskClass, target), status: 'WITHIN_BUDGET' },
    metrics: { packetBytes: 0, packetTokenProxy: 0, evidenceCount: selectedEvidence.size,
      dependencyCount: dependencyRefs.size, pathCount: paths.size, inlineBytes: 0,
      sourceBytesReferenced: selectedSourceBytes, sourceBytesMaterialized: 0,
      knownGoodRefCount: knownGoodRefs.length, duplicateRefsAvoided },
  };
  return finalizePacket(packet, target.budgetReason);
}

export function buildContextPacket(contextMap, target, options = {}) {
  assertGoalExecution(contextMap.execution, contextMap.goalId);
  let packet = buildContextPacketCandidate(contextMap, target, options);
  if (packet.contextBudget.status === 'OVER_BUDGET' && packet.capabilities.required.length &&
    packet.capabilities.optional.length) packet = buildContextPacketCandidate(contextMap, target, options, true);
  if (packet.contextBudget.status === 'OVER_BUDGET' && !packet.contextBudget.reason) {
    throw new Error('BUDGET_ESCALATION_REASON is required when required Context Packet evidence exceeds its budget');
  }
  return packet;
}

const PACKET_KEYS = new Set(['schemaVersion', 'goalId', 'packetId', 'contextMapFingerprint', 'target', 'objective',
  'repositories', 'capabilities', 'scope', 'riskFlags', 'invariants', 'evidenceRefs', 'dependencyRefs',
  'knownGoodRefs', 'proofGapRefs', 'graphifyRefs', 'validationRefs', 'exclusions', 'ambiguities', 'contextBudget', 'metrics']);
const METRIC_KEYS = new Set(['packetBytes', 'packetTokenProxy', 'evidenceCount', 'dependencyCount', 'pathCount',
  'inlineBytes', 'sourceBytesReferenced', 'sourceBytesMaterialized', 'knownGoodRefCount', 'duplicateRefsAvoided']);
const BUDGET_KEYS = new Set(['taskClass', 'targetType', 'tokenProxyCeiling', 'status', 'reason']);
const rejectKeys = (value, allowed, label, errors) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return errors.push(`invalid ${label}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`unknown ${label} field: ${key}`);
};
const uniqueArray = (value) => Array.isArray(value) && new Set(value).size === value.length;

function validateContextPacketUnsafe(packet, { contextMap, registry } = {}) {
  const errors = [];
  if (packet?.schemaVersion !== CONTEXT_PACKET_SCHEMA_VERSION || !contextMap || !registry) {
    return { status: 'INVALID', errors: ['unsupported Context Packet schema or missing authority'] };
  }
  assertGoalExecution(contextMap.execution, contextMap.goalId);
  rejectKeys(packet, PACKET_KEYS, 'packet', errors);
  rejectKeys(packet.target, new Set(['type', 'id', 'reviewPolicy']), 'target', errors);
  rejectKeys(packet.capabilities, new Set(['required', 'optional']), 'capabilities', errors);
  rejectKeys(packet.scope, new Set(['paths', 'symbols']), 'scope', errors);
  rejectKeys(packet.contextBudget, BUDGET_KEYS, 'contextBudget', errors);
  rejectKeys(packet.metrics, METRIC_KEYS, 'metrics', errors);
  if (packet.contextMapFingerprint !== contextMap.validation?.fingerprint) errors.push('PACKET_STALE');
  if (contextMap.registryFingerprint !== capabilityRegistryFingerprint(registry)) errors.push('REGISTRY_STALE');
  if (!TARGET_TYPES.has(packet.target?.type) || !packet.target?.id || packet.goalId !== contextMap.goalId ||
    packet.packetId !== `CP-${sha256(stable(packetIdentity(packet))).slice(7, 19)}`) errors.push('invalid packet identity');
  const state = validateRegistry(registry);
  const capabilities = new Set(state.capabilities.keys());
  if (!uniqueArray(packet.repositories) || packet.repositories.some((id) => !contextMap.repositories.includes(id)) ||
    !uniqueArray(packet.capabilities.required) || !uniqueArray(packet.capabilities.optional) ||
    packet.capabilities.required.some((id) => !contextMap.capabilities.required.includes(id)) ||
    packet.capabilities.optional.some((id) => !contextMap.capabilities.optional.includes(id)) ||
    packet.capabilities.required.some((id) => packet.capabilities.optional.includes(id)) ||
    [...packet.capabilities.required, ...packet.capabilities.optional].some((id) => !capabilities.has(id))) {
    errors.push('invalid packet repository/capability refs');
  }
  if ((packet.target.type === 'agentProfile' && !state.agentProfiles.has(packet.target.id)) ||
    (packet.target.type === 'nativeRole' && !NATIVE_ROLES.has(packet.target.id)) ||
    (packet.target.type === 'validationRole' && !REVIEW_ROLES.has(packet.target.id)) ||
    (packet.target.type !== 'validationRole' && packet.target.reviewPolicy) ||
    (packet.target.id === 'independent-review' && packet.target.reviewPolicy !== 'INDEPENDENT_REVIEW_PACKET') ||
    (packet.target.id === 'followup-review' && packet.target.reviewPolicy !== 'FOLLOWUP_REVIEW_PACKET') ||
    (packet.target.reviewPolicy && !REVIEW_POLICIES.has(packet.target.reviewPolicy))) errors.push('unknown packet target');
  const profileRepositories = state.agentProfiles.get(packet.target.id)?.repositories ?? ['wayper'];
  if (packet.target.type === 'agentProfile' && packet.repositories.some((id) => !profileRepositories.includes(id))) {
    errors.push('agent profile repository leakage');
  }
  const arrays = ['riskFlags', 'invariants', 'evidenceRefs', 'knownGoodRefs', 'proofGapRefs', 'graphifyRefs',
    'validationRefs', 'exclusions', 'ambiguities'];
  if (arrays.some((field) => !uniqueArray(packet[field])) || !uniqueArray(packet.scope?.paths) ||
    !uniqueArray(packet.scope?.symbols) || !Array.isArray(packet.dependencyRefs) ||
    new Set(packet.dependencyRefs.map((item) => item.id)).size !== packet.dependencyRefs.length) {
    errors.push('duplicate or invalid packet refs');
  }
  const limits = { repositories: 2, riskFlags: 64, invariants: 64, evidenceRefs: 256, dependencyRefs: 256,
    knownGoodRefs: 128, proofGapRefs: 128, graphifyRefs: 256, validationRefs: 128, exclusions: 128,
    ambiguities: 128 };
  if (Object.entries(limits).some(([field, limit]) => packet[field].length > limit) ||
    packet.scope.paths.length > 256 || packet.scope.symbols.length > 256) errors.push('packet collection limit exceeded');
  if (stable(sortedUnique(packet.riskFlags)) !== stable(sortedUnique(contextMap.risks)) ||
    stable(sortedUnique(packet.invariants)) !== stable(sortedUnique(contextMap.invariants ?? []))) {
    errors.push('packet risk/invariant mismatch');
  }
  if (packet.scope.paths.some((value) => {
    const separator = value.indexOf(':');
    const repository = value.slice(0, separator); const relativePath = value.slice(separator + 1);
    return separator < 1 || !packet.repositories.includes(repository) || !relativePath || relativePath.startsWith('/') ||
      relativePath.split('/').includes('..');
  })) errors.push('packet scope repository leakage');
  const authorityPaths = new Set([
    ...contextMap.evidence.map((item) => qualify(item.repository, item.path)),
    ...contextMap.dependencies.flatMap((item) => [qualify(item.from.repository, item.from.ref),
      qualify(item.to.repository, item.to.ref)]),
    ...Object.values(contextMap.repositoryState).flatMap((item) =>
      item.relevantRefs.map((ref) => qualify(item.repository, ref))),
  ]);
  if (packet.scope.paths.some((value) => !authorityPaths.has(value))) errors.push('packet scope path lacks Context Map authority');
  const evidence = new Map(contextMap.evidence.map((item) => [item.id, item]));
  const dependencies = new Map(contextMap.dependencies.map((item) => [item.id, item]));
  const knownGood = new Map(contextMap.knownGood.map((item) => [item.id, item]));
  const proofGaps = new Map(contextMap.proofGaps.map((item) => [item.id, item]));
  const validations = new Map(contextMap.validation.checks.map((item) => [item.id, item]));
  const graphify = new Set(Object.entries(contextMap.graphify).flatMap(([repository, graph]) =>
    graph.status === 'CURRENT' ? graph.queries.map((query) => `${repository}:${query.queryFingerprint}`) : []));
  if (packet.evidenceRefs.some((id) => !evidence.has(id) || !REUSABLE_EVIDENCE.has(evidence.get(id).status) ||
      !packet.repositories.includes(evidence.get(id).repository)) ||
    packet.dependencyRefs.some((item) => !dependencies.has(item.id) || item.reason !== 'DEPENDENCY_CLOSURE' ||
      [dependencies.get(item.id)?.from.repository, dependencies.get(item.id)?.to.repository]
        .some((repository) => !packet.repositories.includes(repository)) ||
      !dependencies.get(item.id)?.evidenceIds.some((id) => packet.evidenceRefs.includes(id))) ||
    packet.knownGoodRefs.some((id) => knownGood.get(id)?.status !== 'KNOWN_GOOD_UNCHANGED' ||
      !packet.repositories.includes(knownGood.get(id)?.repository)) ||
    packet.proofGapRefs.some((id) => proofGaps.get(id)?.status !== 'OPEN') ||
    packet.graphifyRefs.some((id) => !graphify.has(id) || !packet.repositories.includes(id.split(':', 1)[0])) ||
    packet.validationRefs.some((id) => !validations.has(id))) errors.push('invalid packet authority refs');
  const selectedEvidence = new Set(packet.evidenceRefs);
  const selectedDependencies = new Set(packet.dependencyRefs.map((item) => item.id));
  for (const dependency of contextMap.dependencies) {
    if (![dependency.from.repository, dependency.to.repository].every((id) => packet.repositories.includes(id))) continue;
    const endpoints = [qualify(dependency.from.repository, dependency.from.ref),
      qualify(dependency.to.repository, dependency.to.ref)];
    const triggered = dependency.evidenceIds.some((id) => selectedEvidence.has(id)) ||
      endpoints.some((ref) => packet.scope.paths.includes(ref));
    const proofExcluded = dependency.evidenceIds.every((id) =>
      packet.target.reviewPolicy === 'INDEPENDENT_REVIEW_PACKET' && isReviewConclusionEvidence(evidence.get(id)));
    if (triggered && !selectedDependencies.has(dependency.id) &&
      !(proofExcluded && packet.ambiguities.includes(`DEPENDENCY_PROOF_EXCLUDED:${dependency.id}`))) {
      errors.push(`required dependency omitted: ${dependency.id}`);
    }
  }
  for (const capability of packet.capabilities.required) {
    if (!packet.evidenceRefs.some((id) => evidence.get(id)?.capabilityRefs?.includes(capability)) &&
      !packet.ambiguities.includes(`MISSING_REQUIRED_EVIDENCE:${capability}`)) {
      errors.push(`required capability evidence omitted: ${capability}`);
    }
  }
  const packetCapabilities = new Set([...packet.capabilities.required, ...packet.capabilities.optional]);
  for (const gap of contextMap.proofGaps.filter((item) => item.status === 'OPEN' &&
    !(packet.target.reviewPolicy === 'INDEPENDENT_REVIEW_PACKET' && isReviewConclusionEvidence(item)) &&
    (overlap(item.capabilityRefs ?? [], packetCapabilities) ||
      item.evidenceIds.some((id) => selectedEvidence.has(id)) || packet.target.type === 'validationRole'))) {
    if (!packet.proofGapRefs.includes(gap.id)) errors.push(`required proof gap omitted: ${gap.id}`);
  }
  for (const repository of packet.repositories) {
    if (contextMap.graphify[repository]?.decision === 'REQUIRED_BY_STRUCTURAL_UNCERTAINTY' &&
      !packet.graphifyRefs.some((ref) => ref.startsWith(`${repository}:`)) &&
      !packet.ambiguities.includes(`MISSING_STRUCTURAL_EVIDENCE:${repository}`)) {
      errors.push(`required structural evidence omitted: ${repository}`);
    }
  }
  for (const item of packet.dependencyRefs) rejectKeys(item, new Set(['id', 'reason']), `dependency ${item.id}`, errors);
  if (packet.target.reviewPolicy === 'INDEPENDENT_REVIEW_PACKET' &&
    (packet.evidenceRefs.some((id) => isReviewConclusionEvidence(evidence.get(id))) ||
      packet.validationRefs.some((id) => isReviewConclusionEvidence(validations.get(id))) ||
      packet.knownGoodRefs.length || packet.proofGapRefs.some((id) => isReviewConclusionEvidence(proofGaps.get(id))) ||
      !packet.exclusions.includes('PRIOR_REVIEW_CONCLUSIONS'))) errors.push('independent review contamination');
  const bytes = Buffer.byteLength(JSON.stringify(packet));
  const referencedBytes = packet.evidenceRefs.reduce((total, id) => total + (evidence.get(id).sourceBytes ?? 0), 0);
  const duplicateRefsAvoided = packet.dependencyRefs.reduce((total, item) => total +
    (dependencies.get(item.id)?.evidenceIds ?? []).filter((id) => packet.evidenceRefs.includes(id)).length, 0);
  if (Object.values(packet.metrics).some((value) => !Number.isInteger(value) || value < 0) ||
    packet.metrics.packetBytes !== bytes || packet.metrics.packetTokenProxy !== Math.ceil(bytes / 4) ||
    packet.metrics.evidenceCount !== packet.evidenceRefs.length ||
    packet.metrics.dependencyCount !== packet.dependencyRefs.length || packet.metrics.pathCount !== packet.scope.paths.length ||
    packet.metrics.inlineBytes !== 0 || packet.metrics.sourceBytesMaterialized !== 0 ||
    packet.metrics.sourceBytesReferenced !== referencedBytes || packet.metrics.knownGoodRefCount !== packet.knownGoodRefs.length ||
    packet.metrics.duplicateRefsAvoided !== duplicateRefsAvoided) {
    errors.push('invalid packet metrics');
  }
  if (packet.contextBudget.taskClass !== contextMap.taskClass || packet.contextBudget.targetType !== packet.target.type ||
    !Number.isInteger(packet.contextBudget.tokenProxyCeiling) || packet.contextBudget.tokenProxyCeiling < 1) {
    errors.push('invalid packet budget');
  }
  const expectedBudget = packet.metrics.packetTokenProxy > packet.contextBudget.tokenProxyCeiling ? 'OVER_BUDGET' : 'WITHIN_BUDGET';
  if (packet.contextBudget.status !== expectedBudget || (expectedBudget === 'OVER_BUDGET' && !packet.contextBudget.reason)) {
    errors.push('invalid packet budget semantics');
  }
  const walk = (value) => {
    if (typeof value === 'string' && Buffer.byteLength(value) > 512) errors.push('prohibited oversized packet value');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { if (FORBIDDEN_KEY.test(key)) errors.push(`prohibited packet field: ${key}`); walk(child); }
  };
  walk(packet);
  return { status: errors.length ? 'INVALID' : 'VALID', errors: sortedUnique(errors) };
}

export function validateContextPacket(packet, options = {}) {
  try {
    return validateContextPacketUnsafe(packet, options);
  } catch (error) {
    return { status: 'INVALID', errors: [`validator rejected malformed packet: ${error.message}`] };
  }
}

const observed = (value) => Number.isInteger(value) && value >= 0 ? value : 'UNKNOWN';
export function aggregatePacketTelemetry(contextMap, packets, { routerOutput, shadowLogBytes, observations = {}, providerUsage } = {}) {
  const evidenceCounts = new Map(); const dependencyCounts = new Map(); const graphifyCounts = new Map();
  for (const packet of packets) {
    packet.evidenceRefs.forEach((id) => evidenceCounts.set(id, (evidenceCounts.get(id) ?? 0) + 1));
    packet.dependencyRefs.forEach(({ id }) => dependencyCounts.set(id, (dependencyCounts.get(id) ?? 0) + 1));
    packet.graphifyRefs.forEach((id) => graphifyCounts.set(id, (graphifyCounts.get(id) ?? 0) + 1));
  }
  const evidenceById = new Map(contextMap.evidence.map((item) => [item.id, item]));
  const packetReferences = [...evidenceCounts.values()].reduce((sum, count) => sum + count, 0);
  const uniqueSourceBytes = [...evidenceCounts.keys()].reduce((sum, id) => sum + (evidenceById.get(id)?.sourceBytes ?? 0), 0);
  const hypotheticalDuplicatedBytesWithoutMap = [...evidenceCounts]
    .reduce((sum, [id, count]) => sum + (evidenceById.get(id)?.sourceBytes ?? 0) * count, 0);
  const repeated = (counts) => [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const deltaRefs = contextMap.learningDelta.flatMap((item) => item.added ?? []);
  const invalidatedRefs = contextMap.learningDelta.flatMap((item) => item.invalidated ?? []);
  return {
    providerUsage: providerUsage ?? { status: 'UNAVAILABLE', reason: 'PROVIDER_ATTRIBUTION_UNAVAILABLE' },
    fullFileReads: observed(observations.fullFileReads), rangeReads: observed(observations.rangeReads),
    evidenceCreated: new Set(deltaRefs.filter((id) => id.startsWith('E-'))).size,
    evidenceReused: repeated(evidenceCounts),
    evidenceInvalidated: new Set(invalidatedRefs.filter((id) => id.startsWith('E-'))).size,
    knownGoodReused: packets.reduce((sum, packet) => sum + packet.knownGoodRefs.length, 0),
    dependencyReused: repeated(dependencyCounts),
    GraphifyQueries: Object.values(contextMap.graphify).reduce((sum, graph) => sum + graph.queries.length, 0),
    repeatedGraphifyQueries: repeated(graphifyCounts),
    packetsBuilt: packets.length,
    packetBytes: packets.reduce((sum, packet) => sum + packet.metrics.packetBytes, 0),
    packetTokenProxy: packets.reduce((sum, packet) => sum + packet.metrics.packetTokenProxy, 0),
    sourceBytesReferenced: packets.reduce((sum, packet) => sum + packet.metrics.sourceBytesReferenced, 0),
    sourceBytesMaterialized: packets.reduce((sum, packet) => sum + packet.metrics.sourceBytesMaterialized, 0),
    duplicatedBytesAvoided: Math.max(0, hypotheticalDuplicatedBytesWithoutMap - uniqueSourceBytes),
    contextMapBytes: contextMap.metrics.bytes,
    routerOutputBytes: routerOutput ? Buffer.byteLength(JSON.stringify(routerOutput)) : 'UNKNOWN',
    shadowLogBytes: observed(shadowLogBytes),
    deduplication: { uniqueRefs: evidenceCounts.size, repeatedRefs: Math.max(0, packetReferences - evidenceCounts.size),
      uniqueSourceBytes, hypotheticalDuplicatedBytesWithoutMap,
      actualPacketBytes: packets.reduce((sum, packet) => sum + packet.metrics.packetBytes, 0) },
  };
}

function args(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || values[index + 1] === undefined) throw new Error(`Invalid argument: ${values[index]}`);
    result[values[index].slice(2)] = values[index + 1];
  }
  return result;
}

async function main() {
  if (process.argv.includes('--eval')) {
    const { evaluateContextPacketCases, formatPacketBenchmark } = await import('./quality/evaluate-context-packet-cases.mjs');
    const result = evaluateContextPacketCases();
    console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : formatPacketBenchmark(result));
    process.exitCode = result.status === 'PASS' ? 0 : 1;
    return;
  }
  const options = args(process.argv.slice(2));
  const state = readWorkingContext(ROOT, options);
  const { registry } = loadCapabilityFiles();
  const mapValidation = validateContextMap(state.contextMap, {
    repositoryDefinitions: repositoryDefinitions(options, state), registry,
  });
  if (mapValidation.status !== 'VALID') throw new Error(`Context Map is not current: ${mapValidation.errors.join('; ')}`);
  const routerOutput = options['router-output'] ? JSON.parse(fs.readFileSync(options['router-output'], 'utf8')) : undefined;
  const packet = buildContextPacket(state.contextMap, JSON.parse(options.target), { registry, routerOutput });
  const validation = validateContextPacket(packet, { contextMap: state.contextMap, registry });
  if (validation.status !== 'VALID') throw new Error(validation.errors.join('; '));
  console.log(JSON.stringify(packet, null, 2));
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  main().catch((error) => { console.error(`WAYPER CONTEXT PACKET TOOLING_ERROR\n${error.message}`); process.exitCode = 2; });
}
