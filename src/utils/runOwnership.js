const OWNER_FIELD_CANDIDATES = [
  "userId",
  "ownerId",
  "uid",
  "profileId",
  "actorId",
  "authorUid",
  "authorId",
  "createdBy",
];

function normalizeId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

export function getRunOwnerId(run = {}) {
  if (!run || typeof run !== "object") return null;

  for (const field of OWNER_FIELD_CANDIDATES) {
    const id = normalizeId(run[field]);
    if (id) return id;
  }

  const nestedCandidates = [
    run.user?.uid,
    run.user?.id,
    run.owner?.uid,
    run.owner?.id,
    run.author?.uid,
    run.author?.id,
    run.metadata?.userId,
    run.metadata?.ownerId,
    run.summary?.userId,
    run.raw?.userId,
    run.raw?.ownerId,
  ];

  for (const candidate of nestedCandidates) {
    const id = normalizeId(candidate);
    if (id) return id;
  }

  return null;
}

export function isRunOwnedByCurrentUser(run = {}, currentUserId = null, options = {}) {
  const ownerId = getRunOwnerId(run);
  const viewerId = normalizeId(currentUserId);

  if (ownerId) return Boolean(viewerId && ownerId === viewerId);
  return options.allowLegacyLocal !== false;
}

export default isRunOwnedByCurrentUser;
