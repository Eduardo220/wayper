export function getRunIdentityCandidates(run = {}) {
  return [
    run.id,
    run.localRunId,
    run.remoteRunId,
    run.runId,
    run.activeRunId,
    run.legacyId,
    run.clientRunId,
  ]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map(String);
}

export function hasSharedRunIdentity(left = {}, right = {}) {
  const leftIds = new Set(getRunIdentityCandidates(left));
  return leftIds.size > 0 && getRunIdentityCandidates(right).some((id) => leftIds.has(id));
}
