import AsyncStorage from "@react-native-async-storage/async-storage";
import * as sync from "../utils/sync.js";
import {
  loadLocalTerritories,
  loadLocalTerritoryEvents,
  loadLocalTerritoryLeaderboards,
  migrateLegacyZonesToTerritories,
  normalizeTerritoryEventPayload,
  normalizeTerritoryPayload,
  removeLocalTerritory,
  saveLocalTerritory,
  saveLocalTerritoryEvent,
  saveLocalTerritoryLeaderboard,
  saveLocalTerritoryLeaderboards,
  saveLocalTerritories,
  saveLocalTerritoryEvents,
} from "../services/territory/index.js";

export const TERRITORY_REPOSITORY_SOURCE = {
  LOCAL: "local",
  LEGACY: "legacy",
};

export const LEGACY_TERRITORY_STORAGE_KEYS = [
  {
    key: "zones",
    domain: "territory",
    replacement: "wayper_territories_v1",
    deprecated: true,
  },
  {
    key: "@wayper_zones",
    domain: "territory",
    replacement: "wayper_territories_v1",
    deprecated: true,
  },
];

const ok = (data, meta = {}) => ({
  data,
  source: meta.source || TERRITORY_REPOSITORY_SOURCE.LOCAL,
  loading: false,
  error: null,
  ...meta,
});

const fail = (error, fallback, meta = {}) => ({
  data: fallback,
  source: meta.source || TERRITORY_REPOSITORY_SOURCE.LOCAL,
  loading: false,
  error,
  ...meta,
});

function safeParse(raw, fallback = []) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function withTerritoryMetadata(territory = {}) {
  const normalized = normalizeTerritoryPayload(territory, {
    preserveTimestamps: true,
    preserveVersion: true,
  });
  const pendingSync = normalized.pendingSync !== undefined ? !!normalized.pendingSync : !normalized.synced;
  const synced = normalized.synced === true && !pendingSync;
  const runLocalId = normalized.runLocalId || normalized.localRunId || normalized.runId || null;
  const remoteId = normalized.remoteId || normalized.remoteTerritoryId || null;

  return {
    ...normalized,
    localId: normalized.localId || normalized.id || null,
    remoteId,
    runLocalId,
    runRemoteId: normalized.runRemoteId || normalized.remoteRunId || null,
    syncStatus: normalized.syncStatus || (synced ? "SYNCED" : "PENDING"),
    offlineStatus: normalized.offlineStatus || (synced ? "SYNCED" : "PENDING_SYNC"),
    schemaVersion: Number(normalized.schemaVersion || 1),
    areaM2: toFiniteNumber(normalized.areaM2 ?? normalized.area),
    area: toFiniteNumber(normalized.area ?? normalized.areaM2),
    zoneCoords: Array.isArray(normalized.zoneCoords)
      ? normalized.zoneCoords
      : Array.isArray(normalized.coordsPreview)
        ? normalized.coordsPreview
        : [],
  };
}

function withEventMetadata(event = {}) {
  const normalized = normalizeTerritoryEventPayload(event, {
    preserveTimestamps: true,
    preserveVersion: true,
  });
  const pendingSync = normalized.pendingSync !== undefined ? !!normalized.pendingSync : !normalized.synced;
  const synced = normalized.synced === true && !pendingSync;

  return {
    ...normalized,
    localId: normalized.localId || normalized.id || null,
    remoteId: normalized.remoteId || normalized.remoteEventId || null,
    runLocalId: normalized.runLocalId || normalized.localRunId || normalized.runId || null,
    runRemoteId: normalized.runRemoteId || normalized.remoteRunId || null,
    syncStatus: normalized.syncStatus || (synced ? "SYNCED" : "PENDING"),
    offlineStatus: normalized.offlineStatus || (synced ? "SYNCED" : "PENDING_SYNC"),
    schemaVersion: Number(normalized.schemaVersion || 1),
  };
}

export async function list(options = {}) {
  try {
    const territories = await loadLocalTerritories();
    const data = (Array.isArray(territories) ? territories : []).map(withTerritoryMetadata);
    if (!options.status) return ok(data);
    return ok(data.filter((item) => item?.status === options.status));
  } catch (error) {
    return fail(error, []);
  }
}

export const listTerritories = list;

export async function findById(id) {
  try {
    const target = String(id || "");
    if (!target) return ok(null);
    const territories = await loadLocalTerritories();
    const data = (Array.isArray(territories) ? territories : []).map(withTerritoryMetadata);
    return ok(data.find((item) => item?.id === target || item?.localId === target || item?.remoteId === target) || null);
  } catch (error) {
    return fail(error, null);
  }
}

export const findTerritoryById = findById;

export async function save(territory = {}, options = {}) {
  try {
    const saved = await saveLocalTerritory(withTerritoryMetadata(territory), options);
    if (options.scheduleSync) {
      sync.scheduleTerritoriesSync?.(options.delayMs ?? 0);
    }
    return ok(saved ? withTerritoryMetadata(saved) : null);
  } catch (error) {
    return fail(error, null);
  }
}

export const saveTerritory = save;

export async function saveMany(territories = [], options = {}) {
  try {
    const saved = await saveLocalTerritories((Array.isArray(territories) ? territories : []).map(withTerritoryMetadata), options);
    if (options.scheduleSync) {
      sync.scheduleTerritoriesSync?.(options.delayMs ?? 0);
    }
    return ok((Array.isArray(saved) ? saved : []).map(withTerritoryMetadata));
  } catch (error) {
    return fail(error, []);
  }
}

export async function update(id, patch = {}, options = {}) {
  const current = await findById(id);
  if (current.error || !current.data) return current;
  return save(
    {
      ...current.data,
      ...patch,
      id: current.data.id,
      updatedAt: patch.updatedAt || nowIso(),
      pendingSync: patch.pendingSync ?? true,
      synced: patch.synced ?? false,
    },
    { scheduleSync: true, ...options }
  );
}

export const updateTerritory = update;

export async function remove(id, options = {}) {
  try {
    const removed = await removeLocalTerritory(id, options);
    if (options.scheduleSync !== false) {
      sync.scheduleTerritoriesSync?.(options.delayMs ?? 0);
    }
    return ok(removed ? withTerritoryMetadata(removed) : null);
  } catch (error) {
    return fail(error, null);
  }
}

export const softDelete = remove;
export const deleteTerritory = remove;

export async function listEvents() {
  try {
    const events = await loadLocalTerritoryEvents();
    return ok((Array.isArray(events) ? events : []).map(withEventMetadata));
  } catch (error) {
    return fail(error, []);
  }
}

export const listTerritoryEvents = listEvents;

export async function saveEvent(event = {}, options = {}) {
  try {
    const saved = await saveLocalTerritoryEvent(withEventMetadata(event), options);
    if (options.scheduleSync) {
      sync.scheduleTerritoryEventsSync?.(options.delayMs ?? 0);
    }
    return ok(saved ? withEventMetadata(saved) : null);
  } catch (error) {
    return fail(error, null);
  }
}

export const saveTerritoryEvent = saveEvent;

export async function saveEvents(events = [], options = {}) {
  try {
    const saved = await saveLocalTerritoryEvents((Array.isArray(events) ? events : []).map(withEventMetadata), options);
    if (options.scheduleSync) {
      sync.scheduleTerritoryEventsSync?.(options.delayMs ?? 0);
    }
    return ok((Array.isArray(saved) ? saved : []).map(withEventMetadata));
  } catch (error) {
    return fail(error, []);
  }
}

export async function listLeaderboards() {
  try {
    const leaderboards = await loadLocalTerritoryLeaderboards();
    return ok(Array.isArray(leaderboards) ? leaderboards : []);
  } catch (error) {
    return fail(error, []);
  }
}

export async function saveLeaderboard(leaderboard = {}, options = {}) {
  try {
    return ok(await saveLocalTerritoryLeaderboard(leaderboard, options));
  } catch (error) {
    return fail(error, null);
  }
}

export const saveLeaderboardCache = saveLeaderboard;

export async function saveLeaderboardCacheMany(leaderboards = [], options = {}) {
  try {
    const saved = await saveLocalTerritoryLeaderboards(leaderboards, options);
    return ok(Array.isArray(saved) ? saved : []);
  } catch (error) {
    return fail(error, []);
  }
}

export async function getLocalTerritorySummary(options = {}) {
  try {
    const [territoriesResult, eventsResult, leaderboardsResult] = await Promise.all([
      list({ status: options.status || "active" }),
      listEvents(),
      listLeaderboards(),
    ]);
    const userId = options.userId ? String(options.userId) : null;
    const territories = (territoriesResult.data || []).filter((territory) => {
      if (!userId) return true;
      return String(territory.ownerId || territory.userId || "") === userId;
    });
    const cellIds = new Set();
    territories.forEach((territory) => {
      (Array.isArray(territory.cellIds) ? territory.cellIds : []).forEach((cellId) => cellIds.add(String(cellId)));
    });

    return ok({
      territoryCount: territories.length,
      totalAreaM2: territories.reduce((sum, territory) => sum + toFiniteNumber(territory.areaM2 ?? territory.area), 0),
      cellCount: cellIds.size,
      eventCount: (eventsResult.data || []).length,
      leaderboardCount: (leaderboardsResult.data || []).length,
      pendingSyncCount: territories.filter((territory) => territory.pendingSync || territory.syncStatus !== "SYNCED").length,
      source: TERRITORY_REPOSITORY_SOURCE.LOCAL,
    });
  } catch (error) {
    return fail(error, {
      territoryCount: 0,
      totalAreaM2: 0,
      cellCount: 0,
      eventCount: 0,
      leaderboardCount: 0,
      pendingSyncCount: 0,
      source: TERRITORY_REPOSITORY_SOURCE.LOCAL,
    });
  }
}

export const normalizeTerritory = withTerritoryMetadata;
export const normalizeTerritoryEvent = withEventMetadata;

export async function listLegacyZones({ includeAtWayperZones = false } = {}) {
  try {
    const zonesFromSync = typeof sync.loadLocalZones === "function"
      ? await sync.loadLocalZones()
      : [];
    let data = Array.isArray(zonesFromSync) ? zonesFromSync : [];

    if (includeAtWayperZones) {
      const raw = await AsyncStorage.getItem("@wayper_zones");
      const atWayperZones = safeParse(raw, []);
      data = [...data, ...(Array.isArray(atWayperZones) ? atWayperZones : [])];
    }

    return ok(data, {
      source: TERRITORY_REPOSITORY_SOURCE.LEGACY,
      deprecated: true,
    });
  } catch (error) {
    return fail(error, [], {
      source: TERRITORY_REPOSITORY_SOURCE.LEGACY,
      deprecated: true,
    });
  }
}

export async function migrateLegacy(options = {}) {
  try {
    return ok(await migrateLegacyZonesToTerritories(options), {
      source: TERRITORY_REPOSITORY_SOURCE.LEGACY,
      deprecated: true,
    });
  } catch (error) {
    return fail(error, {
      dryRun: options.dryRun !== false,
      scanned: 0,
      migrated: 0,
      skipped: 0,
      errors: [String(error?.message || error)],
    }, {
      source: TERRITORY_REPOSITORY_SOURCE.LEGACY,
      deprecated: true,
    });
  }
}

export default {
  LEGACY_TERRITORY_STORAGE_KEYS,
  list,
  listTerritories,
  findById,
  findTerritoryById,
  save,
  saveTerritory,
  saveMany,
  update,
  updateTerritory,
  remove,
  softDelete,
  deleteTerritory,
  listEvents,
  listTerritoryEvents,
  saveEvent,
  saveTerritoryEvent,
  saveEvents,
  listLeaderboards,
  saveLeaderboard,
  saveLeaderboardCache,
  saveLeaderboardCacheMany,
  getLocalTerritorySummary,
  normalizeTerritory,
  normalizeTerritoryEvent,
  listLegacyZones,
  migrateLegacy,
};
