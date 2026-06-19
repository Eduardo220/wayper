import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();

const AsyncStorageMock = {
  getItem: jest.fn(async (key) => storage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => {
    storage.set(key, value);
  }),
  removeItem: jest.fn(async (key) => {
    storage.delete(key);
  }),
  getAllKeys: jest.fn(async () => Array.from(storage.keys())),
};

const runtimeSnapshot = {
  status: "RUNNING",
  runId: "run-active",
  localRunId: "local-active",
  startedAt: "2026-06-19T10:00:00.000Z",
  updatedAt: "2026-06-19T10:05:00.000Z",
  elapsedMs: 300000,
  distanceMeters: 1234.5,
  rawPointsCount: 2,
  acceptedPointsCount: 2,
  displayPointsCount: 2,
  routeChunksCount: 1,
  lastPersistedAt: "2026-06-19T10:04:58.000Z",
  reconciliationStatus: "ok",
  storageHealth: "ok",
  foregroundWatcherStatus: "active",
  backgroundTaskStatus: "registered",
  notificationStatus: "visible",
  nativeNotificationState: { isActive: true },
  token: "token-secret",
};

const activeSnapshot = {
  activeRunId: "run-active",
  localRunId: "local-active",
  status: "RUNNING",
  rawPath: [
    { latitude: -30.1234567, longitude: -51.7654321, timestamp: 1000 },
    { latitude: -30.1244567, longitude: -51.7664321, timestamp: 2000 },
  ],
  trustedPath: [
    { latitude: -30.1234567, longitude: -51.7654321, timestamp: 1000 },
    { latitude: -30.1244567, longitude: -51.7664321, timestamp: 2000 },
  ],
  renderPath: [
    { latitude: -30.1234567, longitude: -51.7654321, timestamp: 1000 },
  ],
  segments: [{ trustedPath: [{ latitude: -30.1234567, longitude: -51.7654321 }] }],
  checkpointAt: "2026-06-19T10:04:30.000Z",
};

const getActiveRunRuntimeSnapshot = jest.fn(async () => runtimeSnapshot);
const getActiveRunSnapshot = jest.fn(async () => activeSnapshot);
const getActiveRunStorageDiagnostics = jest.fn(async () => ({
  storageHealth: "ok",
  routeChunks: { chunksCount: 1 },
}));
const getPermissionSummary = jest.fn(async () => ({
  foregroundLocation: { status: "granted", granted: true, canAskAgain: true },
  backgroundLocation: { status: "denied", granted: false, canAskAgain: true },
  notifications: { status: "granted", granted: true },
  mediaLibrary: { status: "limited", granted: true },
  canStartRun: true,
}));
const hasCompletedOnboarding = jest.fn(async () => true);
const runRepositoryList = jest.fn(async () => ({
  data: [
    {
      localRunId: "run-pending",
      syncStatus: "PENDING_SYNC",
      lastSyncAttemptAt: "2026-06-19T11:00:00.000Z",
      pendingSync: true,
    },
    {
      localRunId: "run-failed",
      syncStatus: "SYNC_FAILED",
      lastSyncError: "network down",
      updatedAt: "2026-06-19T11:05:00.000Z",
    },
    {
      localRunId: "run-synced",
      syncStatus: "SYNCED",
      lastSyncedAt: "2026-06-19T11:10:00.000Z",
    },
  ],
}));
const listPendingRuns = jest.fn(async () => ({ data: [{ localRunId: "run-pending" }] }));
const listTerritories = jest.fn(async () => ({ data: [{ id: "territory-1" }] }));
const listTerritoryEvents = jest.fn(async () => ({ data: [{ id: "event-1" }, { id: "event-2" }] }));
const listLeaderboards = jest.fn(async () => ({ data: [{ id: "leaderboard-1" }] }));
const getLocalTerritorySummary = jest.fn(async () => ({
  territoryCount: 1,
  eventCount: 2,
  leaderboardCount: 1,
  totalAreaM2: 321,
  pendingSyncCount: 1,
}));
const listLegacyZones = jest.fn(async () => ({ data: [{ id: "legacy-zone" }] }));
const listLocalRunStories = jest.fn(async () => ({
  data: [
    { localId: "story-1", syncStatus: "PENDING_SYNC", createdAt: "2026-06-19T12:00:00.000Z" },
    { localId: "story-2", syncStatus: "SYNC_FAILED", createdAt: "2026-06-19T12:05:00.000Z" },
  ],
}));
const loadActivityFeedCache = jest.fn(async () => ({
  data: [{ id: "feed-1" }, { id: "feed-2" }],
  source: "cache",
}));
const listXpEvents = jest.fn(async () => [{ id: "xp-1" }, { id: "xp-2" }]);
const getUserProgress = jest.fn(async () => ({ localId: "progress-offline", totalXp: 140, level: 2 }));
const getProgressSummary = jest.fn(async () => ({ totalXp: 140, level: 2, nextLevelXp: 110 }));
const listAchievements = jest.fn(async () => [
  { id: "first", unlocked: true },
  { id: "second", unlocked: false },
]);
const getLocalProfileStats = jest.fn(async () => ({
  source: "local",
  hasLocalData: true,
  totalRuns: 3,
  totalDistanceMeters: 5000,
  pendingSyncCount: 1,
  failedSyncCount: 1,
  totalXp: 140,
  level: 2,
}));
const getNativeNotificationState = jest.fn(async () => ({
  isActive: true,
  notificationId: "wayper-active-run",
  status: "visible",
}));
const fetchNetInfo = jest.fn(async () => ({
  isConnected: true,
  isInternetReachable: true,
}));
const getSyncRuntimeStatus = jest.fn(() => ({
  isSyncingRuns: true,
  autoSyncActive: true,
}));

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
}));

jest.unstable_mockModule("react-native", () => ({
  AppState: { currentState: "active" },
  Platform: { OS: "android", Version: 35 },
}));

jest.unstable_mockModule("expo-constants", () => ({
  default: {
    expoConfig: {
      version: "1.0.0",
      android: { versionCode: 42 },
    },
    appOwnership: "standalone",
  },
}));

jest.unstable_mockModule("@react-native-community/netinfo", () => ({
  default: { fetch: fetchNetInfo },
}));

jest.unstable_mockModule("../../runTracking/activeRunRuntimeService.js", () => ({
  default: { getActiveRunRuntimeSnapshot },
}));

jest.unstable_mockModule("../../runTracking/activeRunTrackingService.js", () => ({
  default: {
    getActiveRunSnapshot,
    getActiveRunStorageDiagnostics,
  },
}));

jest.unstable_mockModule("../../permissions.js", () => ({
  getPermissionSummary,
}));

jest.unstable_mockModule("../../onboarding/onboardingService.js", () => ({
  hasCompletedOnboarding,
}));

jest.unstable_mockModule("../../run/runNotificationService.js", () => ({
  getNativeNotificationState,
  isRunNotificationSupported: () => true,
}));

jest.unstable_mockModule("../../../repositories/runRepository.js", () => ({
  list: runRepositoryList,
  default: { list: runRepositoryList },
}));

jest.unstable_mockModule("../../../repositories/runSyncQueueRepository.js", () => ({
  listPending: listPendingRuns,
  default: { listPending: listPendingRuns },
}));

jest.unstable_mockModule("../../../repositories/territoryRepository.js", () => ({
  list: listTerritories,
  listEvents: listTerritoryEvents,
  listLeaderboards,
  getLocalTerritorySummary,
  listLegacyZones,
  default: {
    list: listTerritories,
    listEvents: listTerritoryEvents,
    listLeaderboards,
    getLocalTerritorySummary,
    listLegacyZones,
  },
}));

jest.unstable_mockModule("../../../repositories/socialHomeRepository.js", () => ({
  listLocalRunStories,
  loadActivityFeedCache,
  default: {
    listLocalRunStories,
    loadActivityFeedCache,
  },
}));

jest.unstable_mockModule("../../../repositories/progressionRepository.js", () => ({
  listXpEvents,
  getUserProgress,
  getProgressSummary,
  default: {
    listXpEvents,
    getUserProgress,
    getProgressSummary,
  },
}));

jest.unstable_mockModule("../../../repositories/achievementRepository.js", () => ({
  listAchievements,
  default: {
    listAchievements,
  },
}));

jest.unstable_mockModule("../../../repositories/profileStats.js", () => ({
  getLocalProfileStats,
  default: {
    getLocalProfileStats,
  },
}));

jest.unstable_mockModule("../../../utils/sync.js", () => ({
  getSyncRuntimeStatus,
  default: { getSyncRuntimeStatus },
}));

const config = await import("../../../config/diagnosticsConfig.js");
const { logger, LOG_CATEGORIES } = await import("../../../utils/logger.js");
const storageService = await import("../logStorageService.js");
const diagnostics = await import("../localDiagnosticsService.js");

describe("localDiagnosticsService", () => {
  beforeEach(async () => {
    storage.clear();
    jest.clearAllMocks();
    config.resetDiagnosticsConfigForTests();
    config.updateDiagnosticsConfig({
      consoleEnabled: false,
      persistEnabled: true,
      minLevel: "debug",
      maxStoredLogs: 1000,
      locationPrecisionMode: "masked",
    });
    storage.set("wayper:rankingCache:v1:global", JSON.stringify({
      data: [{ id: "rank-1" }],
      cachedAt: "2026-06-19T12:30:00.000Z",
    }));
    storageService.__resetLogStorageForTests();
    await storageService.clearLogs();
  });

  test("gera resumo local com corrida ativa, permissoes, sync, social, territorio e perfil", async () => {
    logger.debug(LOG_CATEGORIES.LOCATION, "LOCATION_POINT_RECEIVED", {
      point: { latitude: -30.1234567, longitude: -51.7654321, speed: 2 },
      accuracy: 12,
      timestamp: 1000,
    }, { forcePersist: true });
    logger.info(LOG_CATEGORIES.LOCATION, "LOCATION_POINT_ACCEPTED", {
      point: { latitude: -30.1234567, longitude: -51.7654321, speed: 2 },
      timestamp: 1000,
    }, { forcePersist: true });
    logger.warn(LOG_CATEGORIES.LOCATION, "LOCATION_POINT_REJECTED", {
      reason: "bad_accuracy",
      point: { latitude: -30.1244567, longitude: -51.7664321 },
      timestamp: 2000,
    }, { forcePersist: true });
    logger.info(LOG_CATEGORIES.SHARE, "SHARE_EXPORT_DIAGNOSTICS", {
      action: "native_share",
      generatedFilename: "wayper-run.png",
      fileInfo: { exists: true, size: 2048 },
    }, { forcePersist: true });
    await storageService.__flushLogWritesForTests();

    const summary = await diagnostics.buildLocalDiagnosticsSummary({ logsLimit: 50 });

    expect(summary.activeRun).toMatchObject({
      ok: true,
      exists: true,
      status: "RUNNING",
      localRunId: "local-active",
      rawPathCount: 2,
      trustedPathCount: 2,
      renderPathCount: 1,
      segmentsCount: 1,
    });
    expect(summary.gpsTracking).toMatchObject({
      rawPointsReceived: 1,
      acceptedPoints: 1,
      rejectedPoints: 1,
    });
    expect(summary.permissions).toMatchObject({
      onboardingCompleted: true,
      canStartRun: true,
    });
    expect(summary.sync).toMatchObject({
      pendingSync: 1,
      syncFailed: 1,
      synced: 1,
      pendingQueueCount: 1,
      lockActive: true,
      online: true,
    });
    expect(summary.social).toMatchObject({
      storiesCount: 2,
      pendingStorySyncCount: 1,
      failedStorySyncCount: 1,
      feedCacheCount: 2,
    });
    expect(summary.territory).toMatchObject({
      territoriesCount: 1,
      eventsCount: 2,
      leaderboardsCacheCount: 1,
      legacyZonesCount: 1,
    });
    expect(summary.profileRankingXp).toMatchObject({
      profileSource: "local",
      totalXp: 140,
      level: 2,
      achievementsCount: 2,
      achievementsUnlockedCount: 1,
      rankingSource: "cache",
    });
    expect(summary.share).toMatchObject({
      lastImageExportAction: "native_share",
      tempFilesTracked: ["wayper-run.png"],
    });
  });

  test("mascara coordenadas por padrao e nao exporta rawPath completo no resumo", async () => {
    logger.info(LOG_CATEGORIES.LOCATION, "LOCATION_POINT_RECEIVED", {
      point: { latitude: -30.1234567, longitude: -51.7654321 },
      timestamp: 1000,
    }, { forcePersist: true });
    await storageService.__flushLogWritesForTests();

    const summary = await diagnostics.buildLocalDiagnosticsSummary({ logsLimit: 50 });
    const json = JSON.stringify(summary);

    expect(summary.activeRun.rawPath).toBeUndefined();
    expect(summary.activeRun.trustedPath).toBeUndefined();
    expect(summary.activeRun.rawPathCount).toBe(2);
    expect(summary.activeRun.trustedPathCount).toBe(2);
    expect(json).not.toContain("-30.1234567");
    expect(json).not.toContain("-51.7654321");
    expect(json).not.toContain("token-secret");
  });

  test("falha de uma secao nao derruba o resumo inteiro", async () => {
    getActiveRunRuntimeSnapshot.mockImplementationOnce(() => {
      throw new Error("runtime exploded");
    });

    const summary = await diagnostics.buildLocalDiagnosticsSummary({ logsLimit: 50 });

    expect(summary.activeRun).toMatchObject({
      ok: false,
      exists: false,
      status: "IDLE",
    });
    expect(summary.storage).toMatchObject({
      ok: true,
      runsCount: 3,
    });
    expect(summary.sync).toMatchObject({
      ok: true,
      pendingSync: 1,
    });
  });
});
