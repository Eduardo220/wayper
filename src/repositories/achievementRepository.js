import AsyncStorage from "@react-native-async-storage/async-storage";

export const ACHIEVEMENTS_STORAGE_KEY = "wayper_achievements_v1";
export const ACHIEVEMENT_PROGRESS_STORAGE_KEY = "wayper_achievement_progress_v1";
export const ACHIEVEMENT_SCHEMA_VERSION = 1;

export const ACHIEVEMENT_SYNC_STATUS = {
  PENDING: "PENDING",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
};

export const ACHIEVEMENT_OFFLINE_STATUS = {
  LOCAL_ONLY: "LOCAL_ONLY",
  PENDING_SYNC: "PENDING_SYNC",
  SYNCED: "SYNCED",
  SYNC_FAILED: "SYNC_FAILED",
};

export const ACHIEVEMENT_CATALOG = Object.freeze([
  {
    id: "first_run_completed",
    type: "run",
    title: "Primeira corrida",
    description: "Conclua sua primeira corrida valida.",
    metric: "totalRuns",
    target: 1,
  },
  {
    id: "total_distance_1k",
    type: "distance",
    title: "Primeiro quilometro",
    description: "Some 1 km em corridas validas.",
    metric: "totalDistanceMeters",
    target: 1000,
  },
  {
    id: "total_distance_5k",
    type: "distance",
    title: "5 km acumulados",
    description: "Some 5 km em corridas validas.",
    metric: "totalDistanceMeters",
    target: 5000,
  },
  {
    id: "total_distance_10k",
    type: "distance",
    title: "10 km acumulados",
    description: "Some 10 km em corridas validas.",
    metric: "totalDistanceMeters",
    target: 10000,
  },
  {
    id: "first_zone_run",
    type: "zone_run",
    title: "Primeira corrida por zonas",
    description: "Conclua uma corrida no modo zonas.",
    metric: "zoneRuns",
    target: 1,
  },
  {
    id: "first_territory_capture",
    type: "territory",
    title: "Primeira area conquistada",
    description: "Capture sua primeira area real no modo zonas.",
    metric: "territoryCaptures",
    target: 1,
  },
  {
    id: "completed_runs_3",
    type: "run",
    title: "Tres corridas",
    description: "Conclua 3 corridas validas.",
    metric: "totalRuns",
    target: 3,
  },
  {
    id: "total_duration_30min",
    type: "duration",
    title: "30 minutos em movimento",
    description: "Some 30 minutos em corridas validas.",
    metric: "totalDurationSeconds",
    target: 30 * 60,
  },
]);

const nowIso = () => new Date().toISOString();

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resolveUserId(options = {}) {
  return String(options.userId || options.uid || "offline");
}

function progressKey(userId, achievementId) {
  return `${String(userId || "offline")}:${String(achievementId || "")}`;
}

function getProgressRecord(progressMap = {}, userId, achievementId) {
  const scoped = progressMap[progressKey(userId, achievementId)];
  if (scoped) return scoped;

  const legacy = progressMap[achievementId];
  if (legacy && (!legacy.userId || String(legacy.userId) === String(userId))) {
    return legacy;
  }

  return null;
}

function setProgressRecord(progressMap = {}, userId, achievementId, record = {}) {
  progressMap[progressKey(userId, achievementId)] = record;
  return progressMap;
}

async function loadUnlockedRecords() {
  const raw = await AsyncStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
  return asArray(safeParse(raw, []));
}

async function saveUnlockedRecords(records = []) {
  await AsyncStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(asArray(records)));
}

async function loadProgressMap() {
  const raw = await AsyncStorage.getItem(ACHIEVEMENT_PROGRESS_STORAGE_KEY);
  return asObject(safeParse(raw, {}));
}

async function saveProgressMap(map = {}) {
  await AsyncStorage.setItem(ACHIEVEMENT_PROGRESS_STORAGE_KEY, JSON.stringify(asObject(map)));
}

export function normalizeAchievement(definition = {}, state = {}, progress = {}) {
  const id = String(definition.id || state.id || progress.id || "");
  const target = Math.max(1, toNumber(definition.target ?? progress.target, 1));
  const value = Math.max(0, toNumber(progress.progress ?? progress.value ?? state.progress, 0));
  const unlockedAt = state.unlockedAt || progress.unlockedAt || null;
  const syncStatus = state.syncStatus || progress.syncStatus || ACHIEVEMENT_SYNC_STATUS.PENDING;

  return {
    ...definition,
    ...progress,
    ...state,
    id,
    localId: state.localId || progress.localId || id,
    remoteId: state.remoteId || progress.remoteId || null,
    userId: state.userId || progress.userId || null,
    type: definition.type || state.type || progress.type || "progress",
    source: state.source || progress.source || "local",
    progress: Math.min(value, target),
    target,
    unlocked: Boolean(unlockedAt || state.unlocked || progress.unlocked),
    unlockedAt,
    syncStatus,
    offlineStatus:
      state.offlineStatus ||
      progress.offlineStatus ||
      (syncStatus === ACHIEVEMENT_SYNC_STATUS.SYNCED
        ? ACHIEVEMENT_OFFLINE_STATUS.SYNCED
        : ACHIEVEMENT_OFFLINE_STATUS.PENDING_SYNC),
    schemaVersion: Number(state.schemaVersion || progress.schemaVersion || ACHIEVEMENT_SCHEMA_VERSION),
    createdAt: state.createdAt || progress.createdAt || null,
    updatedAt: state.updatedAt || progress.updatedAt || null,
    lastSyncAttemptAt: state.lastSyncAttemptAt || progress.lastSyncAttemptAt || null,
    syncError: state.syncError || progress.syncError || null,
  };
}

export async function listAchievements(options = {}) {
  const userId = resolveUserId(options);
  const [unlockedRecords, progressMap] = await Promise.all([
    loadUnlockedRecords(),
    loadProgressMap(),
  ]);
  const unlockedById = new Map(
    unlockedRecords
      .filter((item) => !item.userId || String(item.userId) === userId)
      .map((item) => [String(item.id), item])
  );

  return ACHIEVEMENT_CATALOG.map((definition) =>
    normalizeAchievement(
      definition,
      unlockedById.get(definition.id) || {},
      getProgressRecord(progressMap, userId, definition.id) || { userId }
    )
  );
}

export async function listUnlockedAchievements(options = {}) {
  const achievements = await listAchievements(options);
  return achievements.filter((achievement) => achievement.unlocked);
}

export async function findAchievementById(id, options = {}) {
  const target = String(id || "");
  if (!target) return null;
  const achievements = await listAchievements(options);
  return achievements.find((achievement) => achievement.id === target) || null;
}

export async function saveAchievementProgress(idOrProgress, patch = {}, options = {}) {
  const input = typeof idOrProgress === "object" ? idOrProgress : { id: idOrProgress, ...patch };
  const id = String(input.id || "");
  if (!id) throw new Error("achievement_id_required");

  const userId = String(input.userId || options.userId || "offline");
  const definition = ACHIEVEMENT_CATALOG.find((item) => item.id === id) || {};
  const progressMap = await loadProgressMap();
  const previous = getProgressRecord(progressMap, userId, id) || {};
  const now = nowIso();
  const target = Math.max(1, toNumber(input.target ?? previous.target ?? definition.target, 1));
  const progress = Math.max(0, toNumber(input.progress ?? input.value ?? previous.progress, 0));
  const next = normalizeAchievement(
    definition,
    {},
    {
      ...previous,
      ...input,
      id,
      userId,
      localId: input.localId || previous.localId || `achievement:${userId}:${id}`,
      progress: Math.min(progress, target),
      target,
      updatedAt: now,
      createdAt: previous.createdAt || input.createdAt || now,
      syncStatus: input.syncStatus || previous.syncStatus || ACHIEVEMENT_SYNC_STATUS.PENDING,
      offlineStatus: input.offlineStatus || previous.offlineStatus || ACHIEVEMENT_OFFLINE_STATUS.PENDING_SYNC,
      schemaVersion: ACHIEVEMENT_SCHEMA_VERSION,
    }
  );

  setProgressRecord(progressMap, userId, id, next);
  await saveProgressMap(progressMap);
  return next;
}

export async function unlockAchievement(id, options = {}) {
  const target = String(id || "");
  if (!target) throw new Error("achievement_id_required");

  const userId = resolveUserId(options);
  const now = options.unlockedAt || nowIso();
  const [records, progressMap] = await Promise.all([
    loadUnlockedRecords(),
    loadProgressMap(),
  ]);
  const existingIndex = records.findIndex(
    (item) => String(item.id) === target && String(item.userId || userId) === userId
  );
  const definition = ACHIEVEMENT_CATALOG.find((item) => item.id === target) || {};
  const existing = existingIndex >= 0 ? records[existingIndex] : null;

  if (existing?.unlockedAt) {
    return {
      achievement: normalizeAchievement(definition, existing, getProgressRecord(progressMap, userId, target) || {}),
      unlocked: false,
      alreadyUnlocked: true,
    };
  }

  const progress = getProgressRecord(progressMap, userId, target) || {};
  const normalized = normalizeAchievement(
    definition,
    {
      ...existing,
      id: target,
      localId: existing?.localId || `achievement:${userId}:${target}`,
      userId,
      source: options.source || "local_progress",
      unlocked: true,
      unlockedAt: now,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      syncStatus: options.syncStatus || ACHIEVEMENT_SYNC_STATUS.PENDING,
      offlineStatus: options.offlineStatus || ACHIEVEMENT_OFFLINE_STATUS.PENDING_SYNC,
      schemaVersion: ACHIEVEMENT_SCHEMA_VERSION,
    },
    {
      ...progress,
      progress: Math.max(toNumber(progress.progress, 0), toNumber(definition.target, 1)),
      target: definition.target || progress.target || 1,
      unlockedAt: now,
    }
  );

  if (existingIndex >= 0) records[existingIndex] = normalized;
  else records.push(normalized);

  setProgressRecord(progressMap, userId, target, {
    ...progress,
    ...normalized,
    progress: normalized.progress,
    target: normalized.target,
    updatedAt: now,
  });

  await Promise.all([
    saveUnlockedRecords(records),
    saveProgressMap(progressMap),
  ]);

  return {
    achievement: normalized,
    unlocked: true,
    alreadyUnlocked: false,
  };
}

async function patchUnlockedAchievement(id, patch = {}, options = {}) {
  const userId = resolveUserId(options);
  const records = await loadUnlockedRecords();
  const index = records.findIndex(
    (item) => String(item.id) === String(id) && String(item.userId || userId) === userId
  );
  if (index < 0) return null;
  records[index] = {
    ...records[index],
    ...patch,
    updatedAt: patch.updatedAt || nowIso(),
    schemaVersion: ACHIEVEMENT_SCHEMA_VERSION,
  };
  await saveUnlockedRecords(records);
  return records[index];
}

export function markAchievementSynced(id, remoteId = null, options = {}) {
  return patchUnlockedAchievement(id, {
    remoteId,
    syncStatus: ACHIEVEMENT_SYNC_STATUS.SYNCED,
    offlineStatus: ACHIEVEMENT_OFFLINE_STATUS.SYNCED,
    syncError: null,
    lastSyncedAt: options.syncedAt || nowIso(),
  }, options);
}

export function markAchievementSyncFailed(id, error, options = {}) {
  const message = typeof error === "string" ? error : String(error?.message || error || "sync_error");
  return patchUnlockedAchievement(id, {
    syncStatus: ACHIEVEMENT_SYNC_STATUS.FAILED,
    offlineStatus: ACHIEVEMENT_OFFLINE_STATUS.SYNC_FAILED,
    syncError: message,
    lastSyncAttemptAt: options.lastSyncAttemptAt || nowIso(),
  }, options);
}

export function markAchievementPendingSync(id, options = {}) {
  return patchUnlockedAchievement(id, {
    syncStatus: ACHIEVEMENT_SYNC_STATUS.PENDING,
    offlineStatus: ACHIEVEMENT_OFFLINE_STATUS.PENDING_SYNC,
    syncError: null,
  }, options);
}

export async function getAchievementProgressSummary(options = {}) {
  const achievements = await listAchievements(options);
  const unlocked = achievements.filter((achievement) => achievement.unlocked);
  return {
    total: achievements.length,
    unlockedCount: unlocked.length,
    lockedCount: achievements.length - unlocked.length,
    recentAchievements: unlocked
      .slice()
      .sort((a, b) => String(b.unlockedAt || "").localeCompare(String(a.unlockedAt || "")))
      .slice(0, options.limit || 5),
    pendingSyncCount: unlocked.filter((achievement) => achievement.syncStatus !== ACHIEVEMENT_SYNC_STATUS.SYNCED).length,
  };
}

function metricValue(progress = {}, metric) {
  if (metric === "territoryCaptures") {
    return Math.max(toNumber(progress.territoryCaptures), toNumber(progress.totalTerritoryAreaM2) > 0 ? 1 : 0);
  }
  return toNumber(progress[metric], 0);
}

export async function evaluateAchievementsFromProgress(userProgress = {}, options = {}) {
  const userId = String(options.userId || userProgress.userId || "offline");
  const newlyUnlocked = [];
  const updated = [];

  for (const definition of ACHIEVEMENT_CATALOG) {
    const value = metricValue(userProgress, definition.metric);
    const savedProgress = await saveAchievementProgress(definition.id, {
      userId,
      progress: value,
      target: definition.target,
      source: "local_progress",
    });
    updated.push(savedProgress);

    if (value >= definition.target) {
      const result = await unlockAchievement(definition.id, {
        userId,
        source: "local_progress",
      });
      if (result.unlocked) newlyUnlocked.push(result.achievement);
    }
  }

  return {
    updated,
    newlyUnlocked,
  };
}

export async function migrateLegacyAchievements() {
  return {
    migrated: 0,
    skipped: true,
    reason: "legacy medals are visual/demo badges and are not promoted to real local-first achievements",
  };
}

export default {
  ACHIEVEMENTS_STORAGE_KEY,
  ACHIEVEMENT_PROGRESS_STORAGE_KEY,
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_SYNC_STATUS,
  ACHIEVEMENT_OFFLINE_STATUS,
  listAchievements,
  listUnlockedAchievements,
  findAchievementById,
  saveAchievementProgress,
  unlockAchievement,
  markAchievementSynced,
  markAchievementSyncFailed,
  markAchievementPendingSync,
  getAchievementProgressSummary,
  normalizeAchievement,
  evaluateAchievementsFromProgress,
  migrateLegacyAchievements,
};
