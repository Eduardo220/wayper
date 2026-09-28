import {
  fetchActiveTerritoriesNear,
  loadLocalTerritories,
  saveLocalTerritories,
  saveLocalTerritoryEvents,
} from "./territoryStorageService.js";

function timestamp(territory) {
  return Date.parse(territory?.updatedAt || territory?.capturedAt || 0) || 0;
}

export async function loadTerritoryCaptureCandidates({ bbox, cellIds }) {
  const local = await loadLocalTerritories({ throwOnError: true });
  let remote = [];
  try {
    remote = await fetchActiveTerritoriesNear({ bbox, cellIds, limitTo: 100 });
  } catch {
    // Remote is best effort; local neighbors remain authoritative offline.
  }
  const candidates = new Map();
  [...local, ...(Array.isArray(remote) ? remote : [])].forEach((territory) => {
    if (!territory?.id) return;
    const previous = candidates.get(String(territory.id));
    const previousVersion = Number(previous?.version || 0);
    const nextVersion = Number(territory.version || 0);
    if (!previous || nextVersion > previousVersion ||
      (nextVersion === previousVersion && timestamp(territory) >= timestamp(previous))) {
      candidates.set(String(territory.id), territory);
    }
  });
  return Array.from(candidates.values());
}

export async function persistTerritoryCapture({ capturedTerritoryId, events, territories }) {
  const savedTerritories = await saveLocalTerritories(territories, {
    preserveTimestamps: true,
    preserveVersion: true,
    throwOnError: true,
  });
  const savedEvents = await saveLocalTerritoryEvents(events, {
    preserveTimestamps: true,
    preserveVersion: true,
    throwOnError: true,
  });
  if (savedTerritories.some((territory) => territory.id === capturedTerritoryId) &&
    savedEvents.length >= events.length) return;
  const error = new Error("territory_local_persistence_not_confirmed");
  error.code = "territory_storage_failed";
  throw error;
}
