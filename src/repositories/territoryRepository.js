import AsyncStorage from "@react-native-async-storage/async-storage";
import * as sync from "../utils/sync.js";
import {
  loadLocalTerritories,
  loadLocalTerritoryEvents,
  loadLocalTerritoryLeaderboards,
  migrateLegacyZonesToTerritories,
  removeLocalTerritory,
  saveLocalTerritory,
  saveLocalTerritoryEvent,
  saveLocalTerritoryLeaderboard,
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

export async function list(options = {}) {
  try {
    const territories = await loadLocalTerritories();
    const data = Array.isArray(territories) ? territories : [];
    if (!options.status) return ok(data);
    return ok(data.filter((item) => item?.status === options.status));
  } catch (error) {
    return fail(error, []);
  }
}

export async function findById(id) {
  try {
    const target = String(id || "");
    if (!target) return ok(null);
    const territories = await loadLocalTerritories();
    return ok((Array.isArray(territories) ? territories : []).find((item) => item?.id === target) || null);
  } catch (error) {
    return fail(error, null);
  }
}

export async function save(territory = {}, options = {}) {
  try {
    return ok(await saveLocalTerritory(territory, options));
  } catch (error) {
    return fail(error, null);
  }
}

export async function saveMany(territories = [], options = {}) {
  try {
    return ok(await saveLocalTerritories(territories, options));
  } catch (error) {
    return fail(error, []);
  }
}

export async function remove(id, options = {}) {
  try {
    return ok(await removeLocalTerritory(id, options));
  } catch (error) {
    return fail(error, null);
  }
}

export async function listEvents() {
  try {
    const events = await loadLocalTerritoryEvents();
    return ok(Array.isArray(events) ? events : []);
  } catch (error) {
    return fail(error, []);
  }
}

export async function saveEvent(event = {}, options = {}) {
  try {
    return ok(await saveLocalTerritoryEvent(event, options));
  } catch (error) {
    return fail(error, null);
  }
}

export async function saveEvents(events = [], options = {}) {
  try {
    return ok(await saveLocalTerritoryEvents(events, options));
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
  findById,
  save,
  saveMany,
  remove,
  listEvents,
  saveEvent,
  saveEvents,
  listLeaderboards,
  saveLeaderboard,
  listLegacyZones,
  migrateLegacy,
};
