import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  NATIVE_ROLES,
  REGISTRY_PATH,
  ROOT,
  ROUTER_REPOSITORIES,
  validateRegistry,
} from './quality/check-capability-routing.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const ROUTER_VERSION = '1.1.0';
export const ROUTER_SCHEMA_VERSION = 1;
export const ROUTER_EVALS_PATH = 'docs/ai/agent-router-shadow-evals.json';
export const ROUTER_MODE = 'SELECTIVE';
export const ROUTER_SELECTION_DECISIONS = Object.freeze({
  ROUTER_SELECTED: 'ROUTER_SELECTED',
  BEHAVIORAL_FALLBACK: 'BEHAVIORAL_FALLBACK',
});
const ROUTER_SELECTION_REASONS = new Set([
  'DECISION_CONTEXT_INCOMPLETE', 'NO_SPECIALIST_REQUESTED', 'WRITER_REQUIRES_BEHAVIORAL_GATE',
  'TASK_CLASS_REQUIRES_BEHAVIORAL_GATE', 'ORCHESTRATION_MODE_REQUIRES_BEHAVIORAL_GATE',
  'CROSS_REPO_SCOPE_REQUIRES_BEHAVIORAL_GATE', 'CAPABILITY_ASSESSMENT_INCOMPLETE',
  'STRUCTURAL_JUDGMENT_REQUIRED', 'NO_SPECIALIST_REQUIRED', 'NO_OPERATIONAL_PROFILE_AVAILABLE',
  'CAPABILITY_COVERAGE_INCOMPLETE', 'JUDGMENT_RESIDUAL', 'PROFILE_CONFLICT',
  'PREREQUISITE_REQUIRES_BEHAVIORAL_GATE', 'NON_OPERATIONAL_PROFILE',
  'REPOSITORY_SCOPE_REQUIRES_BEHAVIORAL_GATE', 'REDUNDANT_PROFILE_SELECTION',
  'COMPLETE_UNAMBIGUOUS_READ_ONLY_COVERAGE',
]);
export const ROUTER_DISPATCH_INVARIANT = 'HARNESS_SPECIALIST_DISPATCH_V1';
export const GRAPHIFY_DECISIONS = Object.freeze({
  NOT_NEEDED: 'NOT_NEEDED',
  TARGETED_RECOMMENDED: 'TARGETED_RECOMMENDED',
  REQUIRED: 'REQUIRED_BY_STRUCTURAL_UNCERTAINTY',
});
const TASK_CLASSES = new Set(['TRIVIAL', 'BOUNDED', 'BUG', 'INVESTIGATION', 'ARCHITECTURAL', 'CRITICAL_RUNTIME']);
const ORCHESTRATION_MODES = new Set(['S0', 'S1', 'S2', 'S3']);
const EXECUTION_INTENTS = new Set(['NONE', 'READ_ONLY_SPECIALIST', 'WRITER']);

const uniq = (items = []) => [...new Set(items)];
const sorted = (items = []) => uniq(items).sort();
const sameSet = (left = [], right = []) =>
  JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
const intersection = (left, right) => [...left].filter((item) => right.has(item));
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const hash = (value) => crypto.createHash('sha256').update(stable(value)).digest('hex');

function strings(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return sorted(value);
}

function optionalEnum(value, allowed, field) {
  if (value == null) return null;
  if (!allowed.has(value)) throw new Error(`Invalid ${field}: ${value}`);
  return value;
}

function repoPath(value, repositories, field) {
  let repository;
  let relativePath;
  if (typeof value === 'string') {
    const separator = value.indexOf(':');
    if (separator > 0) {
      repository = value.slice(0, separator);
      relativePath = value.slice(separator + 1);
    } else if (repositories.length === 1) {
      [repository] = repositories;
      relativePath = value;
    }
  } else if (value && typeof value === 'object') {
    ({ repository, path: relativePath } = value);
  }
  const normalized = relativePath?.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !ROUTER_REPOSITORIES.has(repository) ||
    !repositories.includes(repository) ||
    typeof normalized !== 'string' ||
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Invalid ${field}: ${JSON.stringify(value)}`);
  }
  return { repository, path: normalized };
}

function signal(value, index) {
  const allowed = new Set(['capability', 'domain', 'subdomain', 'keyword', 'text', 'exclusion']);
  if (
    !value || typeof value !== 'object' || !allowed.has(value.type) ||
    typeof value.value !== 'string' || !value.value ||
    !value.provenance || typeof value.provenance !== 'object' ||
    typeof value.provenance.source !== 'string' || !value.provenance.source
  ) {
    throw new Error(`Invalid signal at index ${index}; behavioral signals require provenance`);
  }
  if (value.requirement !== undefined && !['REQUIRED', 'OPTIONAL'].includes(value.requirement)) {
    throw new Error(`Invalid signal requirement at index ${index}`);
  }
  return {
    type: value.type,
    value: value.value,
    requirement: value.requirement === 'OPTIONAL' ? 'OPTIONAL' : 'REQUIRED',
    provenance: value.provenance,
  };
}

function graphifyResults(input, repositories) {
  if (input.graphifyResult != null && input.graphifyResults != null) {
    throw new Error('Use graphifyResult or graphifyResults, not both');
  }
  const values = input.graphifyResults ?? (input.graphifyResult == null ? [] : [input.graphifyResult]);
  if (!Array.isArray(values)) throw new Error('Graphify results must be an array');
  const normalized = values.map((value) => {
    if (
      !value || typeof value !== 'object' || !repositories.includes(value.repository) ||
      typeof value.repositoryFingerprint !== 'string' || !value.repositoryFingerprint ||
      !Array.isArray(value.dependencySignals)
    ) throw new Error('Graphify result must be repository-scoped and fingerprinted');
    return {
      repository: value.repository,
      repositoryFingerprint: value.repositoryFingerprint,
      dependencySignals: value.dependencySignals.map((item, index) => {
        if (
          !item || typeof item.capability !== 'string' || !item.capability ||
          !item.provenance || typeof item.provenance.source !== 'string' || !item.provenance.source
        ) throw new Error(`Invalid Graphify dependency signal at index ${index}`);
        return { capability: item.capability, provenance: item.provenance };
      }).sort((left, right) => stable(left).localeCompare(stable(right))),
    };
  }).sort((left, right) => left.repository.localeCompare(right.repository));
  if (new Set(normalized.map((item) => item.repository)).size !== normalized.length) {
    throw new Error('Graphify results must contain at most one fingerprint per repository');
  }
  return normalized;
}

export function createTaskFingerprint(input) {
  if (
    input?.schemaVersion !== 1 || typeof input.goalId !== 'string' || !input.goalId ||
    typeof input.operation !== 'string' || !input.operation
  ) {
    throw new Error('Unsupported task fingerprint input');
  }
  const repositories = strings(input.repositories, 'repositories');
  if (repositories.length === 0 || repositories.some((item) => !ROUTER_REPOSITORIES.has(item))) {
    throw new Error('Task must select wayper and/or wayper-site');
  }
  const facts = {
    goalId: input.goalId,
    operation: input.operation,
    repositories,
    changedFiles: (input.changedFiles ?? []).map((item) => repoPath(item, repositories, 'changedFile'))
      .sort((left, right) => stable(left).localeCompare(stable(right))),
    candidatePaths: (input.candidatePaths ?? []).map((item) => repoPath(item, repositories, 'candidatePath'))
      .sort((left, right) => stable(left).localeCompare(stable(right))),
    riskFlags: strings(input.riskFlags ?? [], 'riskFlags'),
    knownCapabilities: strings(input.knownCapabilities ?? [], 'knownCapabilities'),
    knownGoodCapabilities: strings(input.knownGoodCapabilities ?? [], 'knownGoodCapabilities'),
    capabilityAssessmentComplete: input.capabilityAssessmentComplete === true,
    structuralUncertainty: input.structuralUncertainty === true,
    questionsExistingBehavior: input.questionsExistingBehavior === true,
    taskClass: optionalEnum(input.taskClass, TASK_CLASSES, 'taskClass'),
    orchestrationMode: optionalEnum(input.orchestrationMode, ORCHESTRATION_MODES, 'orchestrationMode'),
    executionIntent: optionalEnum(input.executionIntent, EXECUTION_INTENTS, 'executionIntent'),
    graphifyResults: graphifyResults(input, repositories),
  };
  const signals = (input.signals ?? []).map(signal)
    .sort((left, right) => stable(left).localeCompare(stable(right)));
  const normalized = { schemaVersion: 1, routerVersion: ROUTER_VERSION, facts, signals };
  return { ...normalized, hash: `sha256:${hash(normalized)}` };
}

function capabilitySelections(fingerprint, state) {
  const selections = new Map();
  const add = (id, requirement, reason, provenance) => {
    if (!state.capabilities.has(id)) throw new Error(`Unknown capability: ${id}`);
    const current = selections.get(id) ?? { id, requirement, reasons: [], provenance: [] };
    if (requirement === 'REQUIRED') current.requirement = 'REQUIRED';
    current.reasons.push(reason);
    current.provenance.push(provenance);
    selections.set(id, current);
  };
  for (const id of fingerprint.facts.knownCapabilities) {
    add(id, 'REQUIRED', 'KNOWN_CAPABILITY', { source: 'TASK_FINGERPRINT' });
  }
  for (const id of fingerprint.facts.knownGoodCapabilities) {
    add(id, 'OPTIONAL', 'KNOWN_GOOD_CAPABILITY', { source: 'WORKING_CONTEXT' });
  }
  for (const item of fingerprint.signals.filter((item) => item.type === 'capability')) {
    add(item.value, item.requirement, 'BEHAVIORAL_CAPABILITY_SIGNAL', item.provenance);
  }
  for (const result of fingerprint.facts.graphifyResults) {
    for (const item of result.dependencySignals) {
      add(item.capability, 'OPTIONAL', 'REPO_SCOPED_GRAPHIFY_SIGNAL', item.provenance);
    }
  }
  return [...selections.values()].map((item) => ({
    ...item,
    reasons: sorted(item.reasons),
    provenance: uniq(item.provenance.map(stable)).sort().map((value) => JSON.parse(value)),
    knownGood: fingerprint.facts.knownGoodCapabilities.includes(item.id),
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function globMatches(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0').replaceAll('*', '[^/]*').replaceAll('\0', '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function matchingPaths(profile, fingerprint) {
  const taskPaths = [...fingerprint.facts.changedFiles, ...fingerprint.facts.candidatePaths];
  const patterns = [...(profile.ownedPaths ?? []), ...(profile.paths ?? []), ...(profile.relatedPaths ?? [])];
  return patterns.flatMap((pattern) => {
    const separator = pattern.indexOf(':');
    if (separator < 1) return [];
    const repository = pattern.slice(0, separator);
    const pathPattern = pattern.slice(separator + 1);
    return taskPaths.filter((item) => item.repository === repository && globMatches(pathPattern, item.path))
      .map((item) => `${repository}:${item.path}`);
  });
}

function profileCost(profile, state, root) {
  if (profile.estimatedContextCost) return Object.values(profile.estimatedContextCost)
    .reduce((total, value) => total + value, 0);
  const files = (profile.skills ?? []).map((skill) => state.assets.get(`skill:${skill}`)?.path)
    .filter(Boolean);
  if (profile.tomlProfile) files.push(profile.tomlProfile);
  return Math.ceil(uniq(files).reduce((total, file) => total + fs.statSync(path.join(root, file)).size, 0) / 4);
}

function profileCandidates(registry, state, fingerprint, selections, root) {
  const required = new Set(selections.filter((item) => item.requirement === 'REQUIRED').map((item) => item.id));
  const optional = new Set(selections.filter((item) => item.requirement === 'OPTIONAL').map((item) => item.id));
  const knownGood = new Set(fingerprint.facts.knownGoodCapabilities);
  const textSignals = fingerprint.signals.filter((item) => ['keyword', 'text', 'exclusion'].includes(item.type));
  const lowerSignals = textSignals.map((item) => item.value.toLocaleLowerCase());
  return registry.agentProfiles.map((profile) => {
    const repositories = profile.repositories ?? ['wayper'];
    const repositoryMatch = intersection(new Set(repositories), new Set(fingerprint.facts.repositories));
    const coverage = new Set(profile.capabilities);
    const requiredCoverage = intersection(required, coverage).sort();
    const optionalCoverage = intersection(optional, coverage).sort();
    const riskMatches = intersection(
      new Set(profile.activationSignals?.riskFlags ?? []),
      new Set(fingerprint.facts.riskFlags)
    ).sort();
    const keywordMatches = (profile.activationSignals?.keywords ?? []).filter((keyword) =>
      lowerSignals.some((value) => value.includes(keyword.toLocaleLowerCase()))
    ).sort();
    const domainMatches = fingerprint.signals.filter((item) => item.type === 'domain' && item.value === profile.domain)
      .map((item) => item.value);
    const subdomainMatches = fingerprint.signals.filter(
      (item) => item.type === 'subdomain' && item.value === profile.subdomain
    ).map((item) => item.value);
    const pathMatches = matchingPaths(profile, fingerprint);
    const exclusionMatches = (profile.exclusions ?? []).filter((item) =>
      lowerSignals.some((value) => value.includes(item.toLocaleLowerCase()))
    ).sort();
    const estimatedContextCost = profileCost(profile, state, root);
    const knownGoodCoverage = intersection(knownGood, coverage).sort();
    const components = {
      requiredCoverage: requiredCoverage.length * 1000,
      optionalCoverage: optionalCoverage.length * 180,
      risk: riskMatches.length * 80,
      path: pathMatches.length * 60,
      domain: domainMatches.length * 40,
      subdomain: subdomainMatches.length * 50,
      keyword: keywordMatches.length * 25,
      knownGoodPenalty: -knownGoodCoverage.length * (fingerprint.facts.questionsExistingBehavior ? 20 : 80),
      contextCostPenalty: -Math.ceil(estimatedContextCost / 250),
    };
    return {
      id: profile.id,
      repositories,
      capabilities: profile.capabilities,
      requiredCoverage,
      optionalCoverage,
      matches: { risk: riskMatches, path: pathMatches, domain: domainMatches,
        subdomain: subdomainMatches, keyword: keywordMatches },
      exclusionMatches,
      conflicts: profile.conflicts ?? [],
      prerequisites: profile.prerequisites ?? [],
      validators: profile.validators ?? [],
      estimatedContextCost,
      score: Object.values(components).reduce((total, value) => total + value, 0),
      scoreComponents: components,
      repositoryMatch,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function conflicts(left, right, byId) {
  return left.conflicts.includes(right.id) || (byId.get(right.id)?.conflicts ?? []).includes(left.id);
}

function prerequisiteGroup(candidate, byId, selected, visiting = new Set()) {
  if (visiting.has(candidate.id)) throw new Error(`Cyclic profile prerequisite: ${candidate.id}`);
  visiting.add(candidate.id);
  const group = [];
  for (const id of candidate.prerequisites) {
    const dependency = byId.get(id);
    if (!selected.has(id)) group.push(...prerequisiteGroup(dependency, byId, selected, new Set(visiting)));
  }
  if (!selected.has(candidate.id)) group.push(candidate);
  return uniq(group.map((item) => item.id)).map((id) => byId.get(id));
}

function selectProfiles(candidates, required, optional) {
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const selected = new Map();
  const covered = new Set();
  const desired = new Set([...required, ...optional]);
  const hardExcluded = new Map(candidates.filter((item) =>
    item.repositoryMatch.length === 0 || item.exclusionMatches.length > 0
  ).map((item) => [item.id, item.repositoryMatch.length === 0 ? 'REPOSITORY_MISMATCH' : 'EXCLUSION_MATCH']));

  while ([...desired].some((id) => !covered.has(id))) {
    const options = candidates.filter((item) => !selected.has(item.id) && !hardExcluded.has(item.id))
      .map((item) => {
        const group = prerequisiteGroup(item, byId, selected);
        const infeasible = group.some((profile) => hardExcluded.has(profile.id)) ||
          group.some((profile, index) => group.slice(index + 1).some((other) => conflicts(profile, other, byId))) ||
          group.some((profile) => [...selected.values()].some((other) => conflicts(profile, other, byId)));
        const groupCapabilities = new Set(group.flatMap((profile) => profile.capabilities));
        const requiredGain = [...required].filter((id) => !covered.has(id) && groupCapabilities.has(id));
        const optionalGain = [...optional].filter((id) => !covered.has(id) && groupCapabilities.has(id));
        const overlap = group.reduce((total, profile) =>
          total + profile.capabilities.filter((id) => covered.has(id)).length, 0);
        const marginal = requiredGain.length * 1000 + optionalGain.length * 180 +
          item.matches.risk.length * 80 + item.matches.path.length * 60 +
          item.matches.domain.length * 40 + item.matches.subdomain.length * 50 +
          item.matches.keyword.length * 25 - overlap * 45 -
          Math.ceil(group.reduce((total, profile) => total + profile.estimatedContextCost, 0) / 250);
        return { item, group, requiredGain, optionalGain, marginal: infeasible ? -Infinity : marginal };
      }).filter((option) => option.requiredGain.length + option.optionalGain.length > 0)
      .sort((left, right) => right.marginal - left.marginal || left.item.id.localeCompare(right.item.id));
    if (!options.length || options[0].marginal <= 0) break;
    const choice = options[0];
    for (const profile of choice.group) {
      selected.set(profile.id, {
        ...profile,
        selectionReason: profile.id === choice.item.id ? 'DETERMINISTIC_SET_COVER' : `PREREQUISITE_FOR:${choice.item.id}`,
        marginalScore: choice.marginal,
      });
      profile.capabilities.forEach((id) => { if (desired.has(id)) covered.add(id); });
    }
  }

  const selectedList = [...selected.values()];
  const excluded = candidates.filter((item) => !selected.has(item.id)).map((item) => {
    let reason = hardExcluded.get(item.id);
    if (!reason && selectedList.some((other) => conflicts(item, other, byId))) reason = 'CONFLICT';
    if (!reason && [...item.capabilities].some((id) => desired.has(id)) &&
      [...item.capabilities].filter((id) => desired.has(id)).every((id) => covered.has(id))) {
      reason = 'ALREADY_COVERED';
    }
    if (!reason && item.requiredCoverage.length + item.optionalCoverage.length === 0) reason = 'NO_RELEVANT_CAPABILITY';
    return { id: item.id, reason: reason ?? 'NO_POSITIVE_MARGINAL_GAIN',
      details: reason === 'EXCLUSION_MATCH' ? item.exclusionMatches : [] };
  });
  return { selected: selectedList, excluded, covered };
}

function graphifyDecision(fingerprint) {
  const resultRepositories = new Set(fingerprint.facts.graphifyResults.map((item) => item.repository));
  const allScopesSupplied = fingerprint.facts.repositories.every((item) => resultRepositories.has(item));
  if (fingerprint.facts.structuralUncertainty && !allScopesSupplied) {
    return GRAPHIFY_DECISIONS.REQUIRED;
  }
  if (
    fingerprint.facts.repositories.length > 1 &&
    fingerprint.facts.changedFiles.length === 0 &&
    fingerprint.facts.candidatePaths.length === 0 &&
    fingerprint.facts.graphifyResults.length === 0
  ) return GRAPHIFY_DECISIONS.TARGETED_RECOMMENDED;
  return GRAPHIFY_DECISIONS.NOT_NEEDED;
}

function compare(actual, deterministic, state) {
  if (actual == null) return {
    status: 'UNKNOWN', bothProfiles: 'UNKNOWN', onlyBehavioralProfiles: 'UNKNOWN',
    onlyDeterministicProfiles: 'UNKNOWN', capabilityCoverageDifference: 'UNKNOWN',
    redundantBehavioralProfiles: 'UNKNOWN', missingBehavioralProfiles: 'UNKNOWN',
    contextCostDifference: 'UNKNOWN', reviewerDiff: 'UNKNOWN',
  };
  const actualProfiles = strings(actual.profiles ?? [], 'actualBehavioralSelection.profiles');
  const actualCapabilities = strings(actual.capabilities ?? [], 'actualBehavioralSelection.capabilities');
  for (const id of actualCapabilities) if (!state.capabilities.has(id)) throw new Error(`Unknown capability: ${id}`);
  const deterministicProfiles = deterministic.selectedProfiles.map((item) => item.id);
  const deterministicCapabilities = deterministic.coverage.required.covered;
  const knownProfiles = new Set([...state.agentProfiles.keys(), ...NATIVE_ROLES]);
  if (actualProfiles.some((id) => !knownProfiles.has(id))) throw new Error('Unknown behavioral profile');
  const redundant = actualProfiles.filter((id) => state.agentProfiles.has(id)).filter((id) => {
    const own = new Set(state.agentProfiles.get(id).capabilities);
    const others = new Set(actualProfiles.filter((other) => other !== id && state.agentProfiles.has(other))
      .flatMap((other) => state.agentProfiles.get(other).capabilities));
    return [...own].every((capability) => others.has(capability));
  });
  const deterministicCost = deterministic.estimatedContextCost;
  const actualCost = Number.isInteger(actual.estimatedContextCost) ? actual.estimatedContextCost : null;
  return {
    status: 'AVAILABLE',
    bothProfiles: intersection(new Set(actualProfiles), new Set(deterministicProfiles)).sort(),
    onlyBehavioralProfiles: actualProfiles.filter((id) => !deterministicProfiles.includes(id)),
    onlyDeterministicProfiles: deterministicProfiles.filter((id) => !actualProfiles.includes(id)),
    capabilityCoverageDifference: {
      onlyBehavioral: actualCapabilities.filter((id) => !deterministicCapabilities.includes(id)),
      onlyDeterministic: deterministicCapabilities.filter((id) => !actualCapabilities.includes(id)),
    },
    redundantBehavioralProfiles: redundant,
    missingBehavioralProfiles: deterministicProfiles.filter((id) => !actualProfiles.includes(id)),
    contextCostDifference: actualCost == null ? 'UNKNOWN' : actualCost - deterministicCost,
    reviewerDiff: {
      onlyBehavioral: actualProfiles.filter((id) => state.agentProfiles.has(id) && !deterministicProfiles.includes(id)),
      onlyDeterministic: deterministicProfiles.filter((id) => !actualProfiles.includes(id)),
    },
  };
}

function routerSelectionReason({ fingerprint, coverage, ambiguities, selectedProfiles, excludedProfiles,
  graphify, state }) {
  const facts = fingerprint.facts;
  if (!facts.taskClass || !facts.orchestrationMode || !facts.executionIntent) return 'DECISION_CONTEXT_INCOMPLETE';
  if (facts.executionIntent === 'NONE') return 'NO_SPECIALIST_REQUESTED';
  if (facts.executionIntent === 'WRITER') return 'WRITER_REQUIRES_BEHAVIORAL_GATE';
  if (['ARCHITECTURAL', 'CRITICAL_RUNTIME'].includes(facts.taskClass)) return 'TASK_CLASS_REQUIRES_BEHAVIORAL_GATE';
  if (!['S1', 'S2'].includes(facts.orchestrationMode)) return 'ORCHESTRATION_MODE_REQUIRES_BEHAVIORAL_GATE';
  if (facts.repositories.length !== 1) return 'CROSS_REPO_SCOPE_REQUIRES_BEHAVIORAL_GATE';
  if (!facts.capabilityAssessmentComplete) return 'CAPABILITY_ASSESSMENT_INCOMPLETE';
  if (graphify !== GRAPHIFY_DECISIONS.NOT_NEEDED) return 'STRUCTURAL_JUDGMENT_REQUIRED';
  if (coverage.required.covered.length === 0) return 'NO_SPECIALIST_REQUIRED';
  if (selectedProfiles.length === 0) return 'NO_OPERATIONAL_PROFILE_AVAILABLE';
  if (coverage.required.uncovered.length || coverage.optional.uncovered.length) return 'CAPABILITY_COVERAGE_INCOMPLETE';
  if (ambiguities.length) return 'JUDGMENT_RESIDUAL';
  if (excludedProfiles.some((item) => item.reason === 'CONFLICT')) return 'PROFILE_CONFLICT';
  if (selectedProfiles.some((item) => item.selectionReason !== 'DETERMINISTIC_SET_COVER')) {
    return 'PREREQUISITE_REQUIRES_BEHAVIORAL_GATE';
  }
  const repository = facts.repositories[0];
  for (const item of selectedProfiles) {
    const profile = state.agentProfiles.get(item.id);
    if (!profile || profile.writePermission !== 'none' || profile.sandbox !== 'read-only' ||
      (!profile.tomlProfile && !profile.nativeRole) ||
      profile.handoffSchema !== 'structured-handoff-v1' || !profile.modelPolicy || profile.modelPolicy === 'inherit' ||
      !profile.reasoningPolicy || profile.reasoningPolicy === 'inherit') return 'NON_OPERATIONAL_PROFILE';
    if (!sameSet(profile.repositories ?? ['wayper'], [repository])) return 'REPOSITORY_SCOPE_REQUIRES_BEHAVIORAL_GATE';
    if (item.requiredCoverage.length + item.optionalCoverage.length === 0) return 'REDUNDANT_PROFILE_SELECTION';
  }
  return 'COMPLETE_UNAMBIGUOUS_READ_ONLY_COVERAGE';
}

function buildSelectionReceipt(args) {
  const reason = routerSelectionReason(args);
  const decision = reason === 'COMPLETE_UNAMBIGUOUS_READ_ONLY_COVERAGE'
    ? ROUTER_SELECTION_DECISIONS.ROUTER_SELECTED : ROUTER_SELECTION_DECISIONS.BEHAVIORAL_FALLBACK;
  const proposedProfileIds = args.selectedProfiles.map((item) => item.id);
  const payload = { schemaVersion: 1, decision, reason, routerVersion: ROUTER_VERSION,
    taskFingerprint: args.fingerprint.hash, repositories: args.fingerprint.facts.repositories,
    profileIds: decision === ROUTER_SELECTION_DECISIONS.ROUTER_SELECTED ? proposedProfileIds : [],
    proposedProfileIds, dispatchInvariant: decision === ROUTER_SELECTION_DECISIONS.ROUTER_SELECTED
      ? ROUTER_DISPATCH_INVARIANT : null };
  return { ...payload, receiptId: `RR-${hash(payload).slice(0, 16)}` };
}

export function validateRouterSelectionReceipt(receipt, { registry, agentId } = {}) {
  const errors = [];
  const allowed = new Set(['schemaVersion', 'decision', 'reason', 'routerVersion', 'taskFingerprint', 'repositories',
    'profileIds', 'proposedProfileIds', 'dispatchInvariant', 'receiptId']);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { status: 'INVALID', errors: ['invalid receipt'] };
  for (const key of Object.keys(receipt)) if (!allowed.has(key)) errors.push(`unknown receipt field: ${key}`);
  if (!Array.isArray(receipt.repositories) || !Array.isArray(receipt.profileIds) ||
    !Array.isArray(receipt.proposedProfileIds)) return { status: 'INVALID', errors: ['invalid receipt refs'] };
  const { receiptId, ...payload } = receipt;
  if (receipt.schemaVersion !== 1 || receipt.routerVersion !== ROUTER_VERSION ||
    !Object.values(ROUTER_SELECTION_DECISIONS).includes(receipt.decision) ||
    !ROUTER_SELECTION_REASONS.has(receipt.reason) || !/^sha256:[a-f0-9]{64}$/.test(receipt.taskFingerprint ?? '') ||
    receiptId !== `RR-${hash(payload).slice(0, 16)}`) {
    errors.push('invalid receipt identity');
  }
  if (!receipt.repositories.length || receipt.repositories.some((id) => !ROUTER_REPOSITORIES.has(id))) {
    errors.push('invalid receipt repositories');
  }
  if (uniq(receipt.repositories ?? []).length !== receipt.repositories?.length ||
    uniq(receipt.profileIds ?? []).length !== receipt.profileIds?.length ||
    uniq(receipt.proposedProfileIds ?? []).length !== receipt.proposedProfileIds?.length) errors.push('duplicate receipt refs');
  if (receipt.decision === ROUTER_SELECTION_DECISIONS.ROUTER_SELECTED) {
    if (receipt.reason !== 'COMPLETE_UNAMBIGUOUS_READ_ONLY_COVERAGE' || receipt.repositories.length !== 1 ||
      !receipt.profileIds?.length || receipt.dispatchInvariant !== ROUTER_DISPATCH_INVARIANT ||
      !sameSet(receipt.profileIds, receipt.proposedProfileIds)) errors.push('invalid router-selected authority');
    const profiles = new Map((registry?.agentProfiles ?? []).map((item) => [item.id, item]));
    for (const id of receipt.proposedProfileIds ?? []) if (!profiles.has(id)) errors.push(`unknown receipt profile: ${id}`);
    for (const id of receipt.profileIds ?? []) {
      const profile = profiles.get(id);
      if (!profile || profile.writePermission !== 'none' || profile.sandbox !== 'read-only' ||
        (!profile.tomlProfile && !profile.nativeRole) || profile.handoffSchema !== 'structured-handoff-v1' || !profile.modelPolicy ||
        profile.modelPolicy === 'inherit' || !profile.reasoningPolicy || profile.reasoningPolicy === 'inherit' ||
        !sameSet(profile.repositories ?? ['wayper'], receipt.repositories)) {
        errors.push(`non-operational receipt profile: ${id}`);
      }
    }
    if (agentId && !receipt.profileIds?.includes(agentId)) errors.push('receipt does not authorize agent');
  } else {
    const profiles = new Set((registry?.agentProfiles ?? []).map((item) => item.id));
    if (receipt.reason === 'COMPLETE_UNAMBIGUOUS_READ_ONLY_COVERAGE' || receipt.profileIds?.length ||
      receipt.dispatchInvariant !== null) errors.push('behavioral fallback cannot authorize profiles');
    if (receipt.proposedProfileIds.some((id) => !profiles.has(id))) errors.push(`unknown proposed receipt profile`);
  }
  return { status: errors.length ? 'INVALID' : 'VALID', errors: [...new Set(errors)].sort() };
}

export function routeTask(input, registry, { root = ROOT } = {}) {
  const state = validateRegistry(registry, root);
  const fingerprint = createTaskFingerprint(input);
  const selections = capabilitySelections(fingerprint, state);
  const required = new Set(selections.filter((item) => item.requirement === 'REQUIRED').map((item) => item.id));
  const optional = new Set(selections.filter((item) => item.requirement === 'OPTIONAL').map((item) => item.id));
  const candidates = profileCandidates(registry, state, fingerprint, selections, root);
  const selection = selectProfiles(candidates, required, optional);
  const selectedProfiles = selection.selected.map((item) => ({
    id: item.id,
    selectionReason: item.selectionReason,
    requiredCoverage: item.requiredCoverage,
    optionalCoverage: item.optionalCoverage,
    score: item.score,
    marginalScore: item.marginalScore,
    estimatedContextCost: item.estimatedContextCost,
    validators: item.validators,
    reasons: item.matches,
  }));
  const coveredByProfiles = new Set(selection.selected.flatMap((item) => item.capabilities));
  const coverage = {
    required: {
      covered: [...required].filter((id) => coveredByProfiles.has(id)).sort(),
      uncovered: [...required].filter((id) => !coveredByProfiles.has(id)).sort(),
    },
    optional: {
      covered: [...optional].filter((id) => coveredByProfiles.has(id)).sort(),
      uncovered: [...optional].filter((id) => !coveredByProfiles.has(id)).sort(),
    },
  };
  const ambiguities = [];
  if (coverage.required.uncovered.length) ambiguities.push({
    code: 'NO_OPERATIONAL_PROFILE_AVAILABLE', capabilities: coverage.required.uncovered,
  });
  if (coverage.required.uncovered.some((id) => candidates.some((item) => item.capabilities.includes(id)))) {
    ambiguities.push({ code: 'PROFILE_POLICY_RESIDUAL', capabilities: coverage.required.uncovered });
  }
  if (selections.length === 0 && !fingerprint.facts.capabilityAssessmentComplete) {
    ambiguities.push({ code: 'CAPABILITY_JUDGMENT_REQUIRED' });
  }
  if (candidates.some((item) => item.requiredCoverage.length + item.optionalCoverage.length === 0 &&
    Object.values(item.matches).some((values) => values.length))) {
    ambiguities.push({ code: 'PROFILE_SIGNAL_WITHOUT_CAPABILITY' });
  }
  const estimatedContextCost = selectedProfiles.reduce((total, item) => total + item.estimatedContextCost, 0);
  const graphify = graphifyDecision(fingerprint);
  const selectionReceipt = buildSelectionReceipt({ fingerprint, coverage, ambiguities, selectedProfiles,
    excludedProfiles: selection.excluded, graphify, state });
  const output = {
    schemaVersion: ROUTER_SCHEMA_VERSION,
    routerVersion: ROUTER_VERSION,
    mode: ROUTER_MODE,
    taskFingerprint: fingerprint,
    repositories: fingerprint.facts.repositories,
    requiredCapabilities: selections.filter((item) => item.requirement === 'REQUIRED'),
    optionalCapabilities: selections.filter((item) => item.requirement === 'OPTIONAL'),
    candidateProfiles: candidates.filter((item) =>
      item.requiredCoverage.length + item.optionalCoverage.length > 0 ||
      Object.values(item.matches).some((values) => values.length)
    ),
    selectedProfiles,
    excludedProfiles: selection.excluded,
    coverage,
    graphifyDecision: graphify,
    ambiguities,
    requiresModelJudgment: ambiguities.some((item) => item.code !== 'NO_OPERATIONAL_PROFILE_AVAILABLE'),
    estimatedContextCost,
    selectionReceipt,
    recommendation: {
      status: selectedProfiles.length ? 'PROFILES_RECOMMENDED' : 'NO_OPERATIONAL_PROFILE_AVAILABLE',
      profileIds: selectionReceipt.profileIds,
      proposedProfileIds: selectedProfiles.map((item) => item.id),
      nativeRole: selectedProfiles.length ? 'explorer' : 'default',
      operationalEffect: selectionReceipt.decision === ROUTER_SELECTION_DECISIONS.ROUTER_SELECTED
        ? ROUTER_DISPATCH_INVARIANT : 'BEHAVIORAL_SELECTION_REQUIRED',
    },
  };
  output.shadowComparison = compare(input.actualBehavioralSelection, output, state);
  return output;
}

function readJson(relativePath, root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

export function validateShadowEvals(evals, state) {
  if (evals?.schemaVersion !== 1 || !Array.isArray(evals.cases) || evals.cases.length < 18) {
    throw new Error('Router shadow eval corpus must contain at least 18 cases');
  }
  const ids = new Set();
  const decisions = new Set(Object.values(GRAPHIFY_DECISIONS));
  const profiles = new Set([...state.agentProfiles.keys(), ...NATIVE_ROLES]);
  for (const item of evals.cases) {
    const expected = item?.expected;
    if (
      !item?.id || ids.has(item.id) || typeof item.category !== 'string' || !item.category ||
      !expected || !Array.isArray(expected.repositories) ||
      !Array.isArray(expected.requiredCapabilities) || !Array.isArray(expected.forbiddenCapabilities) ||
      !Array.isArray(expected.acceptableProfileSets) || expected.acceptableProfileSets.length === 0 ||
      expected.acceptableProfileSets.some((profileSet) => !Array.isArray(profileSet)) ||
      !Array.isArray(expected.forbiddenProfiles) || !decisions.has(expected.graphifyDecision) ||
      typeof expected.ambiguity !== 'boolean'
    ) throw new Error(`Invalid router shadow eval: ${item?.id}`);
    ids.add(item.id);
    const capabilityIds = [...expected.requiredCapabilities, ...expected.forbiddenCapabilities];
    if (capabilityIds.some((id) => !state.capabilities.has(id))) {
      throw new Error(`Unknown capability in router shadow eval: ${item.id}`);
    }
    const profileIds = [...expected.acceptableProfileSets.flat(), ...expected.forbiddenProfiles];
    if (profileIds.some((id) => !profiles.has(id))) {
      throw new Error(`Unknown profile in router shadow eval: ${item.id}`);
    }
    if (expected.repositories.some((id) => !ROUTER_REPOSITORIES.has(id))) {
      throw new Error(`Unknown repository in router shadow eval: ${item.id}`);
    }
  }
}

export function evaluateShadowEvals(root = ROOT) {
  const readStarted = performance.now();
  const registry = readJson(REGISTRY_PATH, root);
  const evals = readJson(ROUTER_EVALS_PATH, root);
  const registryReadMs = performance.now() - readStarted;
  const state = validateRegistry(registry, root);
  validateShadowEvals(evals, state);
  const started = performance.now();
  const results = evals.cases.map((item) => {
    const actual = routeTask(item.input, registry, { root });
    const required = actual.requiredCapabilities.map((entry) => entry.id);
    const selected = actual.selectedProfiles.map((entry) => entry.id);
    const acceptable = item.expected.acceptableProfileSets.some((profileSet) => sameSet(profileSet, selected));
    const falsePositiveCapabilities = required.filter((id) => !item.expected.requiredCapabilities.includes(id));
    const falseNegativeCapabilities = item.expected.requiredCapabilities.filter((id) => !required.includes(id));
    const forbiddenCapabilities = item.expected.forbiddenCapabilities.filter((id) =>
      [...required, ...actual.optionalCapabilities.map((entry) => entry.id)].includes(id)
    );
    const expectedProfiles = [...item.expected.acceptableProfileSets].sort((left, right) => {
      const difference = (profileSet) => profileSet.filter((id) => !selected.includes(id)).length +
        selected.filter((id) => !profileSet.includes(id)).length;
      return difference(left) - difference(right) || stable(left).localeCompare(stable(right));
    })[0];
    const overRoutingProfiles = selected.filter((id) => !expectedProfiles.includes(id));
    const underRoutingProfiles = expectedProfiles.filter((id) => !selected.includes(id));
    const forbiddenProfiles = item.expected.forbiddenProfiles.filter((id) => selected.includes(id));
    const redundantProfiles = actual.excludedProfiles.filter((entry) => entry.reason === 'ALREADY_COVERED')
      .map((entry) => entry.id);
    const checks = {
      repositories: sameSet(actual.repositories, item.expected.repositories),
      capabilities: falsePositiveCapabilities.length + falseNegativeCapabilities.length === 0,
      forbiddenCapabilities: forbiddenCapabilities.length === 0,
      profiles: acceptable,
      forbiddenProfiles: forbiddenProfiles.length === 0,
      graphify: actual.graphifyDecision === item.expected.graphifyDecision,
      ambiguity: actual.requiresModelJudgment === item.expected.ambiguity,
    };
    return { id: item.id, pass: Object.values(checks).every(Boolean), checks, actual,
      falsePositiveCapabilities, falseNegativeCapabilities, forbiddenCapabilities,
      overRoutingProfiles, underRoutingProfiles, forbiddenProfiles, redundantProfiles };
  });
  const routerExecutionMs = performance.now() - started;
  const expectedCapabilityCount = evals.cases.reduce(
    (total, item) => total + item.expected.requiredCapabilities.length, 0
  );
  const actualCapabilityCount = results.reduce(
    (total, item) => total + item.actual.requiredCapabilities.length, 0
  );
  const truePositiveCapabilities = results.reduce((total, item) =>
    total + item.actual.requiredCapabilities.length - item.falsePositiveCapabilities.length, 0);
  const expectedProfileCount = results.reduce((total, item) =>
    total + item.actual.selectedProfiles.length - item.overRoutingProfiles.length + item.underRoutingProfiles.length, 0);
  const selectedProfileCount = results.reduce((total, item) => total + item.actual.selectedProfiles.length, 0);
  const truePositiveProfiles = selectedProfileCount - results.reduce(
    (total, item) => total + item.overRoutingProfiles.length, 0
  );
  return {
    schemaVersion: 1,
    mode: 'SHADOW',
    status: results.every((item) => item.pass) ? 'PASS' : 'FAIL',
    cases: results.length,
    passed: results.filter((item) => item.pass).length,
    metrics: {
      capabilityPrecision: actualCapabilityCount ? truePositiveCapabilities / actualCapabilityCount : 1,
      capabilityRecall: expectedCapabilityCount ? truePositiveCapabilities / expectedCapabilityCount : 1,
      profilePrecision: selectedProfileCount ? truePositiveProfiles / selectedProfileCount : 1,
      profileCoverage: expectedProfileCount ? truePositiveProfiles / expectedProfileCount : 1,
      profileRedundancy: results.reduce((total, item) => total + item.overRoutingProfiles.length, 0),
      ambiguousResidual: results.filter((item) => item.actual.requiresModelJudgment).length,
    },
    performance: {
      registryReadMs: Number(registryReadMs.toFixed(3)),
      routerExecutionMs: Number(routerExecutionMs.toFixed(3)),
      outputBytes: Buffer.byteLength(JSON.stringify(results.map((item) => item.actual))),
      candidateProfiles: results.reduce((total, item) => total + item.actual.candidateProfiles.length, 0),
      selectedProfiles: selectedProfileCount,
      estimatedContextCost: results.reduce((total, item) => total + item.actual.estimatedContextCost, 0),
      llmCalls: 0,
    },
    failures: results.filter((item) => !item.pass),
  };
}

function resolveOutputPath(relativePath) {
  const resolved = path.resolve(ROOT, relativePath);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`Log path escapes repository: ${relativePath}`);
  }
  return resolved;
}

function parseArgs(args) {
  const options = { json: args.includes('--json') };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--input' || argument === '--log') options[argument.slice(2)] = args[++index];
    else if (argument === '--eval') options.eval = true;
    else if (argument !== '--json') throw new Error('Usage: wayper-agent-router --input <json|-> [--log <jsonl>] [--json] | --eval [--json]');
  }
  if ((options.eval ? 1 : 0) + (options.input ? 1 : 0) !== 1) throw new Error('Select exactly one of --input or --eval');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.eval) {
    const result = evaluateShadowEvals();
    if (options.json) console.log(JSON.stringify(result));
    else console.log([
      `AGENT ROUTER SHADOW ${result.status}`,
      `${result.passed}/${result.cases} evals`,
      `capability precision ${(result.metrics.capabilityPrecision * 100).toFixed(1)}% / recall ${(result.metrics.capabilityRecall * 100).toFixed(1)}%`,
      `profile precision ${(result.metrics.profilePrecision * 100).toFixed(1)}% / coverage ${(result.metrics.profileCoverage * 100).toFixed(1)}% / redundant ${result.metrics.profileRedundancy}`,
      `registry ${result.performance.registryReadMs} ms / router ${result.performance.routerExecutionMs} ms / ${result.performance.outputBytes} B / LLM ${result.performance.llmCalls}`,
    ].join('\n'));
    process.exitCode = result.status === 'PASS' ? 0 : 1;
    return;
  }
  const source = options.input === '-' ? await new Promise((resolve, reject) => {
    let body = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { body += chunk; });
    process.stdin.on('end', () => resolve(body));
    process.stdin.on('error', reject);
  }) : fs.readFileSync(resolveOutputPath(options.input), 'utf8');
  const result = routeTask(JSON.parse(source), readJson(REGISTRY_PATH));
  if (options.log) {
    const target = resolveOutputPath(options.log);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(result)}\n`);
  }
  console.log(options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    await main();
  } catch (error) {
    console.error(`AGENT ROUTER SHADOW TOOLING_ERROR\n${error.message}`);
    process.exitCode = 2;
  }
}
