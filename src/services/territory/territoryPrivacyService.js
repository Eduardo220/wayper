const DEFAULT_VISIBILITY = "followers";

const getViewerId = (viewer) => {
  if (!viewer) return null;
  if (typeof viewer === "string") return viewer;
  return viewer.id || viewer.uid || viewer.userId || null;
};

const getOwnerId = (input = {}, explicitOwnerId = null) =>
  explicitOwnerId || input.ownerId || input.userId || input.actorId || input.uid || null;

const getRelationship = (relationship = {}, viewer = {}) => ({
  ...(viewer?.relationship || {}),
  ...(relationship || {}),
});

const isFollowerAllowed = (relationship = {}) =>
  Boolean(
    relationship.isFriend ||
      relationship.friend ||
      relationship.isFollower ||
      relationship.follows ||
      relationship.following ||
      relationship.canViewFollowers ||
      relationship.followers
  );

function canViewByVisibility({ visibility = DEFAULT_VISIBILITY, viewerId, ownerId, relationship }) {
  const owner = ownerId ? String(ownerId) : null;
  const viewer = viewerId ? String(viewerId) : null;
  const isOwner = Boolean(owner && viewer && owner === viewer);

  if (isOwner) return true;
  if (visibility === "public") return true;
  if (visibility === "private") return false;
  if (visibility === "followers") return isFollowerAllowed(relationship);
  return false;
}

export function canViewRun({ run, viewerId, ownerId, relationship } = {}) {
  if (!run) return false;
  return canViewByVisibility({
    visibility: run.visibility || DEFAULT_VISIBILITY,
    viewerId,
    ownerId: getOwnerId(run, ownerId),
    relationship: getRelationship(relationship),
  });
}

export function canViewTerritory({ territory, viewerId, ownerId, relationship } = {}) {
  if (!territory) return false;
  return canViewByVisibility({
    visibility: territory.visibility || DEFAULT_VISIBILITY,
    viewerId,
    ownerId: getOwnerId(territory, ownerId),
    relationship: getRelationship(relationship),
  });
}

export function canViewTerritoryEvent({ event, viewerId, relationship } = {}) {
  if (!event) return false;
  return canViewByVisibility({
    visibility: event.visibility || DEFAULT_VISIBILITY,
    viewerId,
    ownerId: getOwnerId(event),
    relationship: getRelationship(relationship),
  });
}

function compactRunPath(run = {}, isOwner = false) {
  if (isOwner) return run;
  const { path, rawPath, sanitizedPath, coords, ...safe } = run;
  const preview = run.zoneCoords || run.coordsPreview || run.zone?.coords || [];
  return {
    ...safe,
    path: [],
    coords: [],
    coordsPreview: Array.isArray(preview) ? preview.slice(0, 120) : [],
    pathHidden: true,
  };
}

export function sanitizeRunForViewer(run, viewer = {}) {
  if (!run) return null;
  const viewerId = getViewerId(viewer);
  const ownerId = getOwnerId(run, viewer.ownerId);
  const relationship = getRelationship(viewer.relationship, viewer);

  if (!canViewRun({ run, viewerId, ownerId, relationship })) return null;
  return compactRunPath(run, ownerId && viewerId && String(ownerId) === String(viewerId));
}

export function sanitizeTerritoryForViewer(territory, viewer = {}) {
  if (!territory) return null;
  const viewerId = getViewerId(viewer);
  const ownerId = getOwnerId(territory, viewer.ownerId);
  const relationship = getRelationship(viewer.relationship, viewer);

  if (!canViewTerritory({ territory, viewerId, ownerId, relationship })) return null;

  const isOwner = ownerId && viewerId && String(ownerId) === String(viewerId);
  if (isOwner) return territory;

  const { path, rawPath, sanitizedPath, sourcePath, ...safe } = territory;
  return {
    ...safe,
    pathHidden: true,
  };
}

export function sanitizeEventForViewer(event, viewer = {}) {
  if (!event) return null;
  const viewerId = getViewerId(viewer);
  const relationship = getRelationship(viewer.relationship, viewer);

  if (!canViewTerritoryEvent({ event, viewerId, relationship })) return null;

  const ownerId = getOwnerId(event);
  const isOwner = ownerId && viewerId && String(ownerId) === String(viewerId);
  if (isOwner) return event;

  const { path, rawPath, sanitizedPath, sourcePath, ...safe } = event;
  return {
    ...safe,
    pathHidden: true,
  };
}

export default {
  canViewRun,
  canViewTerritory,
  canViewTerritoryEvent,
  sanitizeRunForViewer,
  sanitizeTerritoryForViewer,
  sanitizeEventForViewer,
};
