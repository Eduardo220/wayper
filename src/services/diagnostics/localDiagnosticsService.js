import AsyncStorage from "@react-native-async-storage/async-storage";
import { sanitizeLogContext } from "../../utils/logger.js";
import { getDiagnosticsConfig } from "../../config/diagnosticsConfig.js";
import {
  getDiagnosticStorageHealth,
  getLogs,
  getLogsSummary,
} from "./logStorageService.js";

const ACTIVE_RUN_CANONICAL_KEY = "wayper:activeRun:v2";
const ACTIVE_RUN_LEGACY_KEY = "wayper_active_offline_run_v1";
const RUNS_STORAGE_KEY = "runs";
const PROFILE_STORAGE_KEY = "wayper_profile_v3";
const ONBOARDING_STORAGE_KEY = "wayper:onboarding:v1:completed";
const FEED_CACHE_KEY = "wayper_home_feed_cache_v1";
const FRIENDS_CACHE_KEY = "wayper_home_friends_cache_v1";
const STORY_STORAGE_KEY = "wayper_run_stories_v1";
const SOCIAL_FEED_CACHE_KEY = "wayper_activity_feed_cache_v1";
const TERRITORIES_STORAGE_KEY = "wayper_territories_v1";
const TERRITORY_EVENTS_STORAGE_KEY = "wayper_territory_events_v1";
const TERRITORY_LEADERBOARDS_STORAGE_KEY = "wayper_territory_leaderboards_v1";
const XP_EVENTS_STORAGE_KEY = "wayper_xp_events_v1";
const USER_PROGRESS_STORAGE_KEY = "wayper_user_progress_v1";
const ACHIEVEMENTS_STORAGE_KEY = "wayper_achievements_v1";
const ACHIEVEMENT_PROGRESS_STORAGE_KEY = "wayper_achievement_progress_v1";
const RANKING_CACHE_KEY_PREFIX = "wayper:rankingCache:v1";

const LIVE_RUN_STATUSES = new Set(["STARTING", "RUNNING", "PAUSED", "RECOVERING", "ERROR_RECOVERABLE"]);
const PENDING_SYNC_STATUSES = new Set(["PENDING", "PENDING_SYNC", "LOCAL_ONLY"]);
const FAILED_SYNC_STATUSES = new Set(["FAILED", "SYNC_FAILED"]);
const SYNCING_STATUSES = new Set(["SYNCING"]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function byteLength(value = "") {
  const text = String(value || "");
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

function parseJson(raw, fallback = null) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function asError(error) {
  return sanitizeLogContext({
    message: error?.message || String(error || "unknown_error"),
    code: error?.code || null,
  });
}

async function safeSection(name, producer, fallback = {}) {
  try {
    const value = await producer();
    return sanitizeLogContext({
      ok: true,
      ...(value || {}),
    });
  } catch (error) {
    return sanitizeLogContext({
      ok: false,
      ...fallback,
      error: {
        section: name,
        ...asError(error),
      },
    });
  }
}

function countPointsFromSegments(segments = [], keyCandidates = ["trustedPath", "filteredPoints", "path"]) {
  return toArray(segments).reduce((total, segment) => {
    if (Array.isArray(segment)) return total + segment.length;
    for (const key of keyCandidates) {
      if (Array.isArray(segment?.[key])) return total + segment[key].length;
    }
    return total;
  }, 0);
}

function summarizeRunGeometry(snapshot = {}, runtime = {}) {
  const segments = toArray(snapshot.segments || snapshot.routeSegments || runtime.routeSegments);
  const rawPath = toArray(snapshot.rawPath || snapshot.rawPoints);
  const trustedPath = toArray(snapshot.trustedPath || snapshot.filteredPoints || snapshot.points || snapshot.path);
  const renderPath = toArray(snapshot.renderPath || snapshot.displayPath || snapshot.displayPoints || snapshot.liveRenderPath);

  return {
    rawPathCount: rawPath.length || runtime.rawPointsCount || countPointsFromSegments(segments, ["rawPath", "rawPoints"]),
    trustedPathCount: trustedPath.length || runtime.acceptedPointsCount || countPointsFromSegments(segments),
    renderPathCount: renderPath.length || runtime.displayPointsCount || countPointsFromSegments(segments, ["displayPoints", "liveRenderPath", "summaryRenderPath"]),
    segmentsCount: segments.length,
    routeChunksCount: Number(runtime.routeChunksCount || snapshot.routeChunksIndex?.chunks?.length || 0) || 0,
  };
}

function summarizeLastCheckpoint(snapshot = {}, runtime = {}) {
  return (
    runtime.lastPersistedAt ||
    snapshot.lastPersistedAt ||
    snapshot.checkpointAt ||
    snapshot.lastUpdatedAt ||
    snapshot.updatedAt ||
    null
  );
}

function latestLogByEvent(logs = [], eventName) {
  return [...toArray(logs)].reverse().find((log) => log.event === eventName) || null;
}

function countLogsByEvent(logs = [], eventName) {
  return toArray(logs).filter((log) => log.event === eventName).length;
}

function summarizeEmergencyRunDiagnostics(logs = []) {
  const emergencyLogs = toArray(logs).filter((log) => log.event === "EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT");
  const latestEmergency = emergencyLogs[emergencyLogs.length - 1] || null;
  const latestHeartbeat = latestLogByEvent(logs, "RUN_UI_HEARTBEAT");
  const latestTimerStall = latestLogByEvent(logs, "RUN_UI_TIMER_STALL");
  const latestDrawerRequest = latestLogByEvent(logs, "RUN_DRAWER_OPEN_REQUESTED");
  const latestDrawerTimeout = latestLogByEvent(logs, "RUN_DRAWER_OPEN_TIMEOUT");
  const context = latestEmergency?.context || {};

  return sanitizeLogContext({
    emergencySnapshotsCount: emergencyLogs.length,
    lastEmergencySnapshotAt: latestEmergency?.timestamp || context.updatedAt || null,
    lastUiHeartbeatAt: latestHeartbeat?.timestamp || null,
    lastUiTickAt: context.lastUiTickAt || latestHeartbeat?.context?.lastUiTickAt || null,
    lastLocationReceivedAt: context.lastLocationReceivedAt || null,
    lastLocationAcceptedAt: context.lastLocationAcceptedAt || null,
    lastRenderPathUpdatedAt: context.lastRenderPathUpdatedAt || null,
    timerStatus: context.timerStatus || latestHeartbeat?.context?.timerStatus || null,
    watcherStatus: context.watcherStatus || null,
    notificationStatus: context.notificationStatus || null,
    appState: context.appState || null,
    pathCounts: context.pathCounts || null,
    discardedPointReasons: context.discardedPointReasons || {},
    drawerOpenAttempts: countLogsByEvent(logs, "RUN_DRAWER_OPEN_REQUESTED"),
    drawerOpenTimeouts: countLogsByEvent(logs, "RUN_DRAWER_OPEN_TIMEOUT"),
    lastDrawerOpenRequestedAt: latestDrawerRequest?.timestamp || null,
    lastDrawerOpenTimeoutAt: latestDrawerTimeout?.timestamp || null,
    stallCounters: {
      ui: countLogsByEvent(logs, "RUN_UI_STALL"),
      timer: countLogsByEvent(logs, "RUN_UI_TIMER_STALL"),
      drawer: countLogsByEvent(logs, "RUN_DRAWER_OPEN_TIMEOUT"),
      eventLoop: toArray(logs).filter((log) => String(log.event || "").includes("JS_EVENT_LOOP_STALL")).length,
    },
    lastTimerStallAt: latestTimerStall?.timestamp || null,
  });
}

function statusCounts(runs = []) {
  return toArray(runs).reduce((acc, run) => {
    const status = normalizeStatus(run.syncStatus || run.offlineStatus || (run.synced ? "SYNCED" : "PENDING"));
    if (PENDING_SYNC_STATUSES.has(status)) acc.pendingSync += 1;
    else if (FAILED_SYNC_STATUSES.has(status)) acc.syncFailed += 1;
    else if (SYNCING_STATUSES.has(status)) acc.syncing += 1;
    else if (status === "SYNCED") acc.synced += 1;
    else acc.unknown += 1;
    return acc;
  }, {
    pendingSync: 0,
    syncFailed: 0,
    syncing: 0,
    synced: 0,
    unknown: 0,
  });
}

function latestByDate(items = [], pickDate) {
  return toArray(items)
    .map((item) => ({ item, timestamp: Date.parse(pickDate(item) || "") }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp)[0]?.item || null;
}

async function getAllStorageKeys() {
  try {
    if (typeof AsyncStorage.getAllKeys !== "function") return [];
    const keys = await AsyncStorage.getAllKeys();
    return Array.isArray(keys) ? keys : [];
  } catch {
    return [];
  }
}

async function readStorageKeyInfo(key, { parse = false, includeSize = false } = {}) {
  const raw = await AsyncStorage.getItem(key);
  const parsed = parse ? parseJson(raw, null) : null;
  const count = Array.isArray(parsed)
    ? parsed.length
    : parsed && typeof parsed === "object"
      ? Object.keys(parsed).length
      : null;
  return {
    key,
    exists: raw != null,
    count,
    sizeBytes: includeSize && raw != null ? byteLength(raw) : null,
  };
}

async function readRankingCacheSummary({ includeSize = false } = {}) {
  const keys = (await getAllStorageKeys()).filter((key) => String(key).startsWith(RANKING_CACHE_KEY_PREFIX));
  const entries = await Promise.all(keys.slice(0, 10).map(async (key) => {
    const raw = await AsyncStorage.getItem(key);
    const parsed = parseJson(raw, null);
    return {
      key,
      count: Array.isArray(parsed?.data) ? parsed.data.length : 0,
      cachedAt: parsed?.cachedAt || null,
      updatedAt: parsed?.updatedAt || parsed?.cachedAt || null,
      sizeBytes: includeSize && raw != null ? byteLength(raw) : null,
    };
  }));
  const latest = latestByDate(entries, (entry) => entry.updatedAt || entry.cachedAt);
  return {
    cacheKeysCount: keys.length,
    cacheItemsCount: entries.reduce((total, entry) => total + Number(entry.count || 0), 0),
    latestUpdatedAt: latest?.updatedAt || latest?.cachedAt || null,
    estimatedSizeBytes: includeSize
      ? entries.reduce((total, entry) => total + Number(entry.sizeBytes || 0), 0)
      : null,
  };
}

async function buildActiveRunSection() {
  const [{ default: runtimeService }, { default: trackingService }] = await Promise.all([
    import("../runTracking/activeRunRuntimeService.js"),
    import("../runTracking/activeRunTrackingService.js"),
  ]);
  const [runtime, snapshot, storageDiagnostics, recentLogs] = await Promise.all([
    runtimeService.getActiveRunRuntimeSnapshot?.("local_diagnostics").catch((error) => ({ error })),
    trackingService.getActiveRunSnapshot?.().catch(() => null),
    trackingService.getActiveRunStorageDiagnostics?.().catch(() => null),
    getLogs({ limit: 300 }).catch(() => []),
  ]);
  const status = normalizeStatus(runtime?.status || snapshot?.status || "IDLE");
  const geometry = summarizeRunGeometry(snapshot || {}, runtime || {});
  const emergencyDiagnostics = summarizeEmergencyRunDiagnostics(recentLogs);

  return {
    exists: LIVE_RUN_STATUSES.has(status) || Boolean(runtime?.activeRunId || snapshot?.activeRunId),
    status,
    runId: runtime?.runId || snapshot?.activeRunId || snapshot?.runId || null,
    localRunId: runtime?.localRunId || snapshot?.localRunId || null,
    startedAt: runtime?.startedAt || snapshot?.startedAt || null,
    updatedAt: runtime?.updatedAt || snapshot?.lastUpdatedAt || null,
    elapsedMs: Number(runtime?.elapsedMs || snapshot?.durationMs || 0) || 0,
    distanceMeters: Number(runtime?.distanceMeters ?? snapshot?.distanceMeters ?? snapshot?.distance ?? 0) || 0,
    ...geometry,
    lastCheckpointAt: summarizeLastCheckpoint(snapshot || {}, runtime || {}),
    recoveryStatus: runtime?.reconciliationStatus || runtime?.recoveryReason || null,
    autoSaveStatus: storageDiagnostics?.storageHealth || runtime?.storageHealth || null,
    foregroundWatcherStatus: runtime?.foregroundWatcherStatus || runtime?.watcherStatus || null,
    backgroundTaskStatus: runtime?.backgroundTaskStatus || runtime?.backgroundTaskProbe?.status || null,
    notificationStatus: runtime?.notificationStatus || null,
    nativeNotificationActive: Boolean(runtime?.nativeNotificationState?.isActive || runtime?.nativeNotificationState?.hasForegroundService),
    canShowStartButton: runtime?.canShowStartButton ?? null,
    emergencyDiagnostics,
    lastEmergencySnapshotAt: emergencyDiagnostics.lastEmergencySnapshotAt,
    lastUiTickAt: emergencyDiagnostics.lastUiTickAt,
    lastLocationReceivedAt: emergencyDiagnostics.lastLocationReceivedAt,
    lastLocationAcceptedAt: emergencyDiagnostics.lastLocationAcceptedAt,
    lastRenderPathUpdatedAt: emergencyDiagnostics.lastRenderPathUpdatedAt,
    timerStatus: emergencyDiagnostics.timerStatus,
    drawerOpenAttempts: emergencyDiagnostics.drawerOpenAttempts,
    drawerOpenTimeouts: emergencyDiagnostics.drawerOpenTimeouts,
    stallCounters: emergencyDiagnostics.stallCounters,
  };
}

async function buildGpsSection(activeRun = {}) {
  const diagnostics = await import("./runDiagnosticsService.js");
  const logs = await getLogs({ limit: 800 });
  const gpsLogs = logs.filter((log) => (
    log.category === "LOCATION" ||
    String(log.event || "").startsWith("LOCATION_POINT") ||
    String(log.event || "").includes("GPS")
  ));
  const report = diagnostics.buildGpsFilterReport(gpsLogs);
  const lastPointLog = [...gpsLogs].reverse().find((log) => (
    log.event === "LOCATION_POINT_RECEIVED" ||
    log.event === "LOCATION_POINT_ACCEPTED" ||
    log.event === "LOCATION_POINT_REJECTED"
  ));
  const lastErrorLog = [...logs].reverse().find((log) => (
    log.category === "LOCATION" && ["warn", "error", "fatal"].includes(log.level)
  ));

  return {
    rawPointsReceived: report.rawGpsPointsReceived,
    acceptedPoints: report.acceptedGpsPoints,
    rejectedPoints: report.rejectedGpsPoints,
    acceptedByRelaxedFilter: report.acceptedByRelaxedFilter,
    topRejectReasons: report.topRejectReasons,
    lastAccuracy: lastPointLog?.context?.accuracy ?? lastPointLog?.context?.point?.accuracy ?? null,
    lastSpeed: lastPointLog?.context?.point?.speed ?? null,
    longestRawGapMs: report.longestGapBetweenRawPointsMs,
    longestAcceptedGapMs: report.longestGapBetweenAcceptedPointsMs,
    lastRawPointAt: report.lastRawPointAt,
    lastAcceptedPointAt: report.lastAcceptedPointAt,
    lastError: lastErrorLog ? {
      event: lastErrorLog.event,
      at: lastErrorLog.timestamp,
      reason: lastErrorLog.context?.reason || lastErrorLog.context?.error?.message || null,
    } : null,
    rawPathCount: activeRun.rawPathCount || 0,
    trustedPathCount: activeRun.trustedPathCount || 0,
    renderPathCount: activeRun.renderPathCount || 0,
    gpsFilterReport: report,
  };
}

async function buildPermissionsSection() {
  const [permissions, onboarding] = await Promise.all([
    import("../permissions.js"),
    import("../onboarding/onboardingService.js").catch(() => null),
  ]);
  const summary = await permissions.getPermissionSummary?.({ includeMedia: true });
  const onboardingCompleted = onboarding?.hasCompletedOnboarding
    ? await onboarding.hasCompletedOnboarding().catch(() => (AsyncStorage.getItem(ONBOARDING_STORAGE_KEY).then((value) => value === "1")))
    : (await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)) === "1";

  return {
    foregroundLocation: summary?.foregroundLocation || null,
    backgroundLocation: summary?.backgroundLocation || null,
    notifications: summary?.notifications || null,
    mediaLibrary: summary?.mediaLibrary || null,
    imageLibrary: summary?.imageLibrary || null,
    canStartRun: Boolean(summary?.canStartRun),
    backgroundLimited: Boolean(summary?.backgroundLimited),
    notificationLimited: Boolean(summary?.notificationLimited),
    requiredBlocked: Boolean(summary?.requiredBlocked),
    optionalBlocked: Boolean(summary?.optionalBlocked),
    onboardingCompleted,
  };
}

async function buildStorageSection({ includeSize = false } = {}) {
  const [
    runRepository,
    territoryRepository,
    socialHomeRepository,
    achievementRepository,
    progressionRepository,
  ] = await Promise.all([
    import("../../repositories/runRepository.js"),
    import("../../repositories/territoryRepository.js"),
    import("../../repositories/socialHomeRepository.js"),
    import("../../repositories/achievementRepository.js"),
    import("../../repositories/progressionRepository.js"),
  ]);

  const [
    runsResult,
    activeKey,
    legacyActiveKey,
    territoriesResult,
    territoryEventsResult,
    territoryLeaderboardsResult,
    storiesResult,
    feedCacheResult,
    xpEvents,
    progress,
    achievements,
    rankingCache,
    diagnosticsHealth,
    logsSummary,
    profileKey,
  ] = await Promise.all([
    runRepository.list?.().catch((error) => ({ data: [], error })),
    readStorageKeyInfo(ACTIVE_RUN_CANONICAL_KEY, { includeSize }),
    readStorageKeyInfo(ACTIVE_RUN_LEGACY_KEY, { includeSize }),
    territoryRepository.list?.({ status: "active" }).catch((error) => ({ data: [], error })),
    territoryRepository.listEvents?.().catch((error) => ({ data: [], error })),
    territoryRepository.listLeaderboards?.().catch((error) => ({ data: [], error })),
    socialHomeRepository.listLocalRunStories?.().catch((error) => ({ data: [], error })),
    socialHomeRepository.loadActivityFeedCache?.().catch((error) => ({ data: [], error })),
    progressionRepository.listXpEvents?.().catch(() => []),
    progressionRepository.getUserProgress?.().catch(() => null),
    achievementRepository.listAchievements?.().catch(() => []),
    readRankingCacheSummary({ includeSize }),
    getDiagnosticStorageHealth().catch(() => ({})),
    getLogsSummary().catch(() => ({})),
    readStorageKeyInfo(PROFILE_STORAGE_KEY, { includeSize }),
  ]);

  const selectedKeys = includeSize ? await Promise.all([
    readStorageKeyInfo(RUNS_STORAGE_KEY, { includeSize }),
    readStorageKeyInfo(STORY_STORAGE_KEY, { includeSize }),
    readStorageKeyInfo(SOCIAL_FEED_CACHE_KEY, { includeSize }),
    readStorageKeyInfo(FEED_CACHE_KEY, { includeSize }),
    readStorageKeyInfo(FRIENDS_CACHE_KEY, { includeSize }),
    readStorageKeyInfo(TERRITORIES_STORAGE_KEY, { includeSize }),
    readStorageKeyInfo(TERRITORY_EVENTS_STORAGE_KEY, { includeSize }),
    readStorageKeyInfo(TERRITORY_LEADERBOARDS_STORAGE_KEY, { includeSize }),
    readStorageKeyInfo(XP_EVENTS_STORAGE_KEY, { includeSize }),
    readStorageKeyInfo(USER_PROGRESS_STORAGE_KEY, { includeSize }),
    readStorageKeyInfo(ACHIEVEMENTS_STORAGE_KEY, { includeSize }),
    readStorageKeyInfo(ACHIEVEMENT_PROGRESS_STORAGE_KEY, { includeSize }),
  ]) : [];

  const selectedSizeBytes = selectedKeys.reduce((total, item) => total + Number(item.sizeBytes || 0), 0);

  return {
    runsCount: toArray(runsResult?.data).length,
    activeSnapshotExists: Boolean(activeKey.exists),
    legacyActiveSnapshotExists: Boolean(legacyActiveKey.exists),
    territoriesCount: toArray(territoriesResult?.data).length,
    territoryEventsCount: toArray(territoryEventsResult?.data).length,
    territoryLeaderboardsCount: toArray(territoryLeaderboardsResult?.data).length,
    storiesCount: toArray(storiesResult?.data).length,
    feedCacheCount: toArray(feedCacheResult?.data).length,
    xpEventsCount: toArray(xpEvents).length,
    progressExists: Boolean(progress?.localId || progress?.totalXp),
    achievementsCount: toArray(achievements).length,
    achievementsUnlockedCount: toArray(achievements).filter((item) => item?.unlocked).length,
    profileCacheExists: Boolean(profileKey.exists),
    rankingCacheExists: rankingCache.cacheKeysCount > 0,
    rankingCacheCount: rankingCache.cacheItemsCount,
    estimatedSizeBytes: includeSize ? selectedSizeBytes + Number(rankingCache.estimatedSizeBytes || 0) : null,
    selectedStorageKeys: includeSize ? selectedKeys : undefined,
    diagnostics: diagnosticsHealth,
    logs: logsSummary,
  };
}

async function buildSyncSection() {
  const [runRepository, queueRepository, syncModule, netInfoModule] = await Promise.all([
    import("../../repositories/runRepository.js"),
    import("../../repositories/runSyncQueueRepository.js"),
    import("../../utils/sync.js"),
    import("@react-native-community/netinfo").catch(() => null),
  ]);
  const [runsResult, pendingResult, logs] = await Promise.all([
    runRepository.list?.().catch((error) => ({ data: [], error })),
    queueRepository.listPending?.().catch((error) => ({ data: [], error })),
    getLogs({ category: "SYNC", limit: 200 }).catch(() => []),
  ]);
  const runs = toArray(runsResult?.data);
  const latestAttempt = latestByDate(runs, (run) => run.lastSyncAttemptAt || run.lastSyncedAt || run.syncedAt || run.updatedAt);
  const lastErrorRun = latestByDate(
    runs.filter((run) => run.lastSyncError || run.syncError),
    (run) => run.lastSyncAttemptAt || run.updatedAt || run.date
  );
  const netInfo = await netInfoModule?.default?.fetch?.().catch(() => null);
  const runtimeStatus = syncModule.getSyncRuntimeStatus?.() || null;
  const lastSyncLog = [...logs].reverse().find((log) => String(log.event || "").startsWith("RUN_SYNC_")) || null;
  const counts = statusCounts(runs);

  return {
    ...counts,
    pendingQueueCount: toArray(pendingResult?.data).length,
    lastSyncAttemptAt: latestAttempt?.lastSyncAttemptAt || latestAttempt?.lastSyncedAt || latestAttempt?.syncedAt || null,
    lockActive: Boolean(runtimeStatus?.isSyncingRuns),
    runtimeStatus,
    online: netInfo ? Boolean(netInfo.isConnected && netInfo.isInternetReachable !== false) : null,
    lastError: lastErrorRun?.lastSyncError || lastErrorRun?.syncError || null,
    lastErrorRunId: lastErrorRun?.localRunId || lastErrorRun?.id || null,
    lastEvent: lastSyncLog ? {
      event: lastSyncLog.event,
      at: lastSyncLog.timestamp,
      level: lastSyncLog.level,
    } : null,
  };
}

async function buildNotificationBackgroundSection(activeRun = {}) {
  const [runtimeService, notificationService, reactNative] = await Promise.all([
    import("../runTracking/activeRunRuntimeService.js"),
    import("../run/runNotificationService.js"),
    import("react-native").catch(() => null),
  ]);
  const [runtime, nativeNotificationState, lifecycleLogs] = await Promise.all([
    runtimeService.default?.getActiveRunRuntimeSnapshot?.("notification_background_diagnostics").catch(() => ({})),
    notificationService.getNativeNotificationState?.().catch(() => null),
    getLogs({ limit: 120 }).catch(() => []),
  ]);
  const lifecycleEvents = lifecycleLogs
    .filter((log) => (
      log.category === "APP_STATE" ||
      log.category === "BACKGROUND" ||
      log.category === "RUN_RECOVERY" ||
      String(log.event || "").includes("WATCHER") ||
      String(log.event || "").includes("BACKGROUND_TASK") ||
      String(log.event || "").includes("NOTIFICATION") ||
      String(log.event || "").startsWith("RUN_UI_") ||
      String(log.event || "").startsWith("RUN_DRAWER_") ||
      String(log.event || "").startsWith("RUN_EMERGENCY_DIAGNOSTICS_") ||
      String(log.event || "") === "EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT"
    ))
    .slice(-20)
    .map((log) => ({
      timestamp: log.timestamp,
      level: log.level,
      category: log.category,
      event: log.event,
      reason: log.context?.reason || null,
    }));

  return {
    foregroundServiceActive: Boolean(nativeNotificationState?.hasForegroundService || nativeNotificationState?.isActive || activeRun.nativeNotificationActive),
    notificationId: nativeNotificationState?.notificationId || null,
    notificationStatus: runtime?.notificationStatus || activeRun.notificationStatus || nativeNotificationState?.status || null,
    notificationActionsRegistered: notificationService.isRunNotificationSupported?.() ? "supported" : "unsupported",
    backgroundTaskStatus: runtime?.backgroundTaskStatus || runtime?.backgroundTaskProbe?.status || activeRun.backgroundTaskStatus || null,
    foregroundWatcherStatus: runtime?.foregroundWatcherStatus || activeRun.foregroundWatcherStatus || null,
    appState: runtime?.appState || reactNative?.AppState?.currentState || null,
    lastDeepLinkReceived: runtime?.lastDeepLinkReceived || null,
    lastNotificationActionReceived: runtime?.lastNotificationActionReceived || null,
    lifecycleEvents,
  };
}

async function buildSocialSection() {
  const repository = await import("../../repositories/socialHomeRepository.js");
  const [storiesResult, cacheResult] = await Promise.all([
    repository.listLocalRunStories?.().catch((error) => ({ data: [], source: "empty", error })),
    repository.loadActivityFeedCache?.().catch((error) => ({ data: [], source: "empty", error })),
  ]);
  const stories = toArray(storiesResult?.data);
  const cache = toArray(cacheResult?.data);
  const pending = stories.filter((story) => normalizeStatus(story.syncStatus) === "PENDING_SYNC");
  const failed = stories.filter((story) => normalizeStatus(story.syncStatus) === "SYNC_FAILED");

  return {
    storiesCount: stories.length,
    pendingStorySyncCount: pending.length,
    failedStorySyncCount: failed.length,
    feedCacheCount: cache.length,
    source: stories.length ? "local" : cache.length ? "cache" : "empty",
    demoEnabled: false,
    lastRemoteError: storiesResult?.error?.message || cacheResult?.error?.message || null,
    latestStoryAt: stories[0]?.createdAt || null,
  };
}

async function buildShareSection(permissions = {}) {
  const shareLogs = await getLogs({ category: "SHARE", limit: 120 }).catch(() => []);
  const lastInfo = [...shareLogs].reverse().find((log) => log.level !== "error") || null;
  const lastError = [...shareLogs].reverse().find((log) => ["warn", "error", "fatal"].includes(log.level)) || null;
  const storyCreated = [...shareLogs].reverse().find((log) => String(log.event || "").includes("STORY")) || null;

  return {
    lastImageExportAt: lastInfo?.timestamp || null,
    lastImageExportAction: lastInfo?.context?.action || lastInfo?.event || null,
    lastGeneratedFileSize: lastInfo?.context?.fileSize || lastInfo?.context?.fileInfo?.size || null,
    lastPngExportAt: shareLogs.slice().reverse().find((log) => String(log.context?.action || log.event || "").includes("trace"))?.timestamp || null,
    lastError: lastError ? {
      event: lastError.event,
      at: lastError.timestamp,
      code: lastError.context?.code || null,
      message: lastError.context?.error?.message || lastError.context?.message || null,
    } : null,
    mediaPermission: permissions.mediaLibrary || permissions.imageLibrary || null,
    storyCreatedViaShareAt: storyCreated?.timestamp || null,
    tempFilesTracked: lastInfo?.context?.generatedFilename ? [lastInfo.context.generatedFilename] : [],
  };
}

async function buildTerritorySection() {
  const [repository, logs] = await Promise.all([
    import("../../repositories/territoryRepository.js"),
    getLogs({ limit: 150 }).catch(() => []),
  ]);
  const [summaryResult, legacyResult] = await Promise.all([
    repository.getLocalTerritorySummary?.().catch((error) => ({ data: null, error })),
    repository.listLegacyZones?.({ includeAtWayperZones: true }).catch((error) => ({ data: [], error })),
  ]);
  const territoryLogs = logs.filter((log) => (
    log.category === "TERRITORY" ||
    String(log.event || "").includes("TERRITORY") ||
    String(log.event || "").includes("ZONE")
  ));
  const lastCapture = [...territoryLogs].reverse().find((log) => String(log.event || "").includes("CAPTURE")) || null;
  const lastError = [...territoryLogs].reverse().find((log) => ["warn", "error", "fatal"].includes(log.level)) || null;
  const summary = summaryResult?.data || summaryResult || {};

  return {
    territoriesCount: Number(summary.territoryCount || 0),
    eventsCount: Number(summary.eventCount || 0),
    leaderboardsCacheCount: Number(summary.leaderboardCount || 0),
    legacyZonesCount: toArray(legacyResult?.data).length,
    totalAreaM2: Number(summary.totalAreaM2 || 0),
    pendingSyncCount: Number(summary.pendingSyncCount || 0),
    lastCaptureAt: lastCapture?.timestamp || null,
    lastError: lastError ? {
      event: lastError.event,
      at: lastError.timestamp,
      reason: lastError.context?.reason || lastError.context?.error?.message || null,
    } : null,
  };
}

async function buildProfileRankingXpSection() {
  const [profileStats, progression, achievement, rankingCache] = await Promise.all([
    import("../../repositories/profileStats.js").then((module) => module.getLocalProfileStats?.().catch((error) => ({ error }))),
    import("../../repositories/progressionRepository.js").then((module) => module.getProgressSummary?.().catch((error) => ({ error }))),
    import("../../repositories/achievementRepository.js").then((module) => module.listAchievements?.().catch(() => [])),
    readRankingCacheSummary({ includeSize: false }),
  ]);
  const achievements = toArray(achievement);
  const hasRankingCache = rankingCache.cacheKeysCount > 0;
  const localHasData = Boolean(profileStats?.hasLocalData || progression?.totalXp > 0 || achievements.some((item) => item?.unlocked));

  return {
    profileSource: profileStats?.source || "local",
    totalXp: Number(progression?.totalXp ?? profileStats?.totalXp ?? 0) || 0,
    level: Number(progression?.level ?? profileStats?.level ?? 1) || 1,
    xpToNextLevel: Number(progression?.nextLevelXp ?? profileStats?.nextLevelXp ?? 0) || 0,
    achievementsCount: achievements.length,
    achievementsUnlockedCount: achievements.filter((item) => item?.unlocked).length,
    rankingSource: hasRankingCache ? "cache" : localHasData ? "local" : "empty",
    rankingCacheUpdatedAt: rankingCache.latestUpdatedAt,
    totalRuns: Number(profileStats?.totalRuns || 0),
    totalDistanceMeters: Number(profileStats?.totalDistanceMeters || profileStats?.totalDistance || 0),
    pendingSyncCount: Number(profileStats?.pendingSyncCount || 0),
    failedSyncCount: Number(profileStats?.failedSyncCount || 0),
  };
}

async function buildMetadataSection() {
  const [reactNative, constants] = await Promise.all([
    import("react-native").catch(() => null),
    import("expo-constants").catch(() => null),
  ]);
  const platform = reactNative?.Platform || {};
  const expoConstants = constants?.default || constants || {};
  const config = getDiagnosticsConfig();

  return {
    app: "Wayper",
    generatedAt: new Date().toISOString(),
    environment: typeof __DEV__ === "undefined" || __DEV__ ? "dev" : "prod",
    diagnosticsVersion: 1,
    logsMinLevel: config.minLevel,
    preciseLocationLogsEnabled: config.allowPreciseLocationLogs === true,
    locationPrecisionMode: config.locationPrecisionMode,
    platform: platform.OS || "unknown",
    platformVersion: platform.Version || null,
    appVersion: expoConstants.expoConfig?.version || config.appVersion || "unknown",
    buildVersion: expoConstants.expoConfig?.android?.versionCode || expoConstants.nativeBuildVersion || config.buildVersion || "unknown",
    appOwnership: expoConstants.appOwnership || null,
  };
}

export async function buildLocalDiagnosticsSummary(options = {}) {
  const includeStorageSizes = options.includeStorageSizes === true;
  const recentLogsLimit = Math.max(50, Math.min(Number(options.logsLimit || 150), 1000));
  const metadata = await safeSection("metadata", buildMetadataSection, { app: "Wayper" });
  const activeRun = await safeSection("activeRun", buildActiveRunSection, { exists: false, status: "IDLE" });

  const [
    gpsTracking,
    permissions,
    storage,
    sync,
    notificationBackground,
    social,
    territory,
    profileRankingXp,
    logsSummary,
    recentLogs,
  ] = await Promise.all([
    safeSection("gpsTracking", () => buildGpsSection(activeRun)),
    safeSection("permissions", buildPermissionsSection),
    safeSection("storage", () => buildStorageSection({ includeSize: includeStorageSizes })),
    safeSection("sync", buildSyncSection),
    safeSection("notificationBackground", () => buildNotificationBackgroundSection(activeRun)),
    safeSection("social", buildSocialSection),
    safeSection("territory", buildTerritorySection),
    safeSection("profileRankingXp", buildProfileRankingXpSection),
    safeSection("logsSummary", () => getLogsSummary()),
    getLogs({ limit: recentLogsLimit }).catch(() => []),
  ]);
  const share = await safeSection("share", () => buildShareSection(permissions));

  return sanitizeLogContext({
    metadata,
    activeRun,
    gpsTracking,
    permissions,
    storage,
    sync,
    notificationBackground,
    social,
    share,
    territory,
    profileRankingXp,
    logsSummary,
    recentLogs: toArray(recentLogs).slice(-recentLogsLimit),
  });
}

export function buildTechnicalSummaryText(summary = {}) {
  const active = summary.activeRun || {};
  const gps = summary.gpsTracking || {};
  const sync = summary.sync || {};
  const permissions = summary.permissions || {};
  const storage = summary.storage || {};
  const social = summary.social || {};
  const territory = summary.territory || {};
  const profile = summary.profileRankingXp || {};

  return [
    "Wayper Local Diagnostics",
    `generatedAt: ${summary.metadata?.generatedAt || "-"}`,
    `environment: ${summary.metadata?.environment || "-"}`,
    `activeRun: ${active.exists ? "yes" : "no"} status=${active.status || "IDLE"} localRunId=${active.localRunId || "-"}`,
    `gps: raw=${gps.rawPointsReceived || 0} accepted=${gps.acceptedPoints || 0} rejected=${gps.rejectedPoints || 0}`,
    `paths: raw=${active.rawPathCount || 0} trusted=${active.trustedPathCount || 0} render=${active.renderPathCount || 0} segments=${active.segmentsCount || 0}`,
    `permissions: fg=${permissions.foregroundLocation?.status || "-"} bg=${permissions.backgroundLocation?.status || "-"} notifications=${permissions.notifications?.status || "-"}`,
    `storage: runs=${storage.runsCount || 0} stories=${storage.storiesCount || 0} territories=${storage.territoriesCount || 0} xpEvents=${storage.xpEventsCount || 0}`,
    `sync: pending=${sync.pendingSync || 0} failed=${sync.syncFailed || 0} syncing=${sync.syncing || 0} synced=${sync.synced || 0} online=${sync.online}`,
    `social: stories=${social.storiesCount || 0} pendingStories=${social.pendingStorySyncCount || 0} feedCache=${social.feedCacheCount || 0}`,
    `territory: territories=${territory.territoriesCount || 0} events=${territory.eventsCount || 0} legacyZones=${territory.legacyZonesCount || 0}`,
    `profile: source=${profile.profileSource || "-"} xp=${profile.totalXp || 0} level=${profile.level || 1} ranking=${profile.rankingSource || "-"}`,
  ].join("\n");
}

export default {
  buildLocalDiagnosticsSummary,
  buildTechnicalSummaryText,
};
