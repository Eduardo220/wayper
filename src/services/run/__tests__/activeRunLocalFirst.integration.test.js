import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
const firestoreSets = [];
const firestoreDeletes = [];

let locationStarted = false;
let docShouldThrow = false;

const AsyncStorageMock = {
  getItem: jest.fn(async (key) => storage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => {
    storage.set(key, value);
  }),
  removeItem: jest.fn(async (key) => {
    storage.delete(key);
  }),
};

const NetInfoMock = {
  fetch: jest.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
  })),
  addEventListener: jest.fn(() => () => {}),
};

const LocationMock = {
  Accuracy: {
    Balanced: 3,
    High: 4,
    Highest: 5,
    BestForNavigation: 6,
  },
  ActivityType: {
    Fitness: 3,
  },
  hasStartedLocationUpdatesAsync: jest.fn(async () => locationStarted),
  startLocationUpdatesAsync: jest.fn(async () => {
    locationStarted = true;
  }),
  stopLocationUpdatesAsync: jest.fn(async () => {
    locationStarted = false;
  }),
};

const TaskManagerMock = {
  isTaskDefined: jest.fn(() => false),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
};

const BackgroundFetchMock = {
  BackgroundFetchResult: {
    NewData: "NewData",
    Failed: "Failed",
  },
  registerTaskAsync: jest.fn(async () => true),
  unregisterTaskAsync: jest.fn(async () => true),
};

function makeDocRef(parts = []) {
  return { path: parts.map((part) => String(part)).join("/") };
}

const FirestoreMock = {
  collection: jest.fn((...parts) => makeDocRef(parts)),
  doc: jest.fn((...parts) => {
    if (docShouldThrow) throw new Error("firestore unavailable");
    return makeDocRef(parts);
  }),
  getDocs: jest.fn(async () => ({ docs: [] })),
  query: jest.fn((...args) => args),
  orderBy: jest.fn((...args) => args),
  limit: jest.fn((...args) => args),
  startAfter: jest.fn((...args) => args),
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1_700_000_000, nanoseconds: 0 })),
  },
  writeBatch: jest.fn(() => ({
    set: jest.fn((ref, payload, options) => {
      firestoreSets.push({ ref, payload, options });
    }),
    delete: jest.fn((ref) => {
      firestoreDeletes.push({ ref });
    }),
    commit: jest.fn(async () => true),
  })),
};

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
}));

jest.unstable_mockModule("@react-native-community/netinfo", () => ({
  default: NetInfoMock,
}));

jest.unstable_mockModule("react-native", () => ({
  NativeModules: {},
  Platform: {
    OS: "android",
    Version: 33,
  },
}));

jest.unstable_mockModule("expo-location", () => LocationMock);

jest.unstable_mockModule("expo-task-manager", () => TaskManagerMock);

jest.unstable_mockModule("expo-background-fetch", () => BackgroundFetchMock);

jest.unstable_mockModule("firebase/firestore", () => FirestoreMock);

jest.unstable_mockModule("../../../firebaseConfig.js", () => ({
  db: { id: "mock-db" },
  auth: {
    currentUser: {
      uid: "user-1",
      displayName: "Atleta Teste",
      email: "runner@example.test",
    },
  },
}));

jest.unstable_mockModule("../../../utils/zones.js", () => ({
  default: {
    buildCapturedZone: jest.fn(() => []),
    buildConvexZone: jest.fn(() => []),
    isValidPolygon: jest.fn(() => false),
    calcArea: jest.fn(() => 0),
    compressCoords: jest.fn((coords) => coords),
  },
}));

jest.unstable_mockModule("../../notifications/notificationService.js", () => ({
  notifyActivitySubscribers: jest.fn(async () => true),
}));

jest.unstable_mockModule("../../territory/territoryStorageService.js", () => ({
  loadLocalTerritories: jest.fn(async () => []),
  loadLocalTerritoryEvents: jest.fn(async () => []),
  markTerritoryDeletedRemote: jest.fn(async () => true),
  saveLocalTerritories: jest.fn(async (items) => items),
  saveLocalTerritory: jest.fn(async (item) => item),
  saveLocalTerritoryEvent: jest.fn(async (item) => item),
  saveLocalTerritoryEvents: jest.fn(async (items) => items),
  saveTerritoryEventRemote: jest.fn(async (item) => item),
  saveTerritoryRemote: jest.fn(async (item) => item),
}));

const activeRunTrackingService = await import("../../runTracking/activeRunTrackingService.js");
const {
  ACTIVE_RUN_STATUS: CANONICAL_RUN_STATUS,
  ACTIVE_RUN_STORAGE_KEY,
} = await import("../../runTracking/activeRunState.js");
const {
  forceCheckpointForAppState,
  flushActiveRunCheckpoint,
  startActiveRunAutoCheckpointing,
  stopActiveRunAutoCheckpointing,
} = await import("../runAutoSaveService.js");
const {
  findRecoverableRunForUser,
  hydrateRecoverableRunCandidate,
  isLiveRecovery,
  markRecoveredRunLocallySaved,
  persistFinishedRunDraft,
} = await import("../runRecoveryService.js");
const {
  ACTIVE_RUN_STORAGE_KEY: LEGACY_ACTIVE_RUN_STORAGE_KEY,
  ACTIVE_RUN_STATUS: OFFLINE_RUN_STATUS,
  ACTIVE_RUN_SYNC_STATUS,
  loadActiveRun,
} = await import("../../runOfflineStorageService.js");
const {
  enqueueFinishedRun,
} = await import("../runSyncQueueService.js");
const {
  loadLocalRuns,
  saveLocalRun,
  syncRunsToFirestore,
} = await import("../../../utils/sync.js");

const BASE_LAT = -23.56;
const BASE_LNG = -46.64;
const BASE_TIME = 1_700_000_000_000;
const metersToLat = (meters) => meters / 111_320;
const metersToLng = (meters, latitude = BASE_LAT) => meters / (111_320 * Math.cos((latitude * Math.PI) / 180));

function point(index, north = 0, east = 0, extra = {}) {
  return {
    latitude: BASE_LAT + metersToLat(north),
    longitude: BASE_LNG + metersToLng(east),
    accuracy: 8,
    speed: 3,
    timestamp: BASE_TIME + index * 2000,
    source: "foreground",
    ...extra,
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function parseStored(key) {
  const raw = storage.get(key);
  return raw ? JSON.parse(raw) : null;
}

describe("active run local-first integration", () => {
  beforeEach(() => {
    storage.clear();
    firestoreSets.length = 0;
    firestoreDeletes.length = 0;
    locationStarted = false;
    docShouldThrow = false;
    jest.clearAllMocks();
    activeRunTrackingService.__resetActiveRunRuntimeForTests();
    stopActiveRunAutoCheckpointing();
  });

  afterEach(() => {
    stopActiveRunAutoCheckpointing();
    activeRunTrackingService.__resetActiveRunRuntimeForTests();
    jest.useRealTimers();
    jest.clearAllTimers();
  });

  test("percorre start, tracking, pause, resume, recovery, finish, historico local e fila de sync", async () => {
    startActiveRunAutoCheckpointing({
      minIntervalMs: 0,
      periodicIntervalMs: 0,
    });

    const started = await activeRunTrackingService.startActiveRun({
      activeRunId: "run-full-flow",
      userId: "user-1",
      mode: "free",
      startedAtMs: BASE_TIME,
    });
    await flushAsyncWork();

    expect(started.status).toBe(CANONICAL_RUN_STATUS.RUNNING);
    expect(parseStored(ACTIVE_RUN_STORAGE_KEY).activeRunId).toBe("run-full-flow");
    expect((await loadActiveRun()).localRunId).toBe("run-full-flow");

    await activeRunTrackingService.recordLocation(point(1, 0, 8), { source: "foreground" });
    await activeRunTrackingService.recordLocation(point(2, 0, 16), { source: "foreground" });
    const paused = await activeRunTrackingService.pauseActiveRun({
      endedAtMs: BASE_TIME + 6000,
    });
    await flushAsyncWork();

    expect(paused.status).toBe(CANONICAL_RUN_STATUS.PAUSED);
    expect(paused.trustedPath.length).toBeGreaterThanOrEqual(2);
    expect((await loadActiveRun()).status).toBe(OFFLINE_RUN_STATUS.PAUSED);

    activeRunTrackingService.__resetActiveRunRuntimeForTests();
    const pausedRecovery = await findRecoverableRunForUser("user-1");
    expect(pausedRecovery.id).toBe("run-full-flow");
    expect(pausedRecovery.status).toBe("paused");
    expect(isLiveRecovery(pausedRecovery)).toBe(true);

    const hydratedPaused = await hydrateRecoverableRunCandidate(pausedRecovery, {
      userId: "user-1",
      restartTracking: false,
    });
    expect(hydratedPaused.snapshot.status).toBe(CANONICAL_RUN_STATUS.PAUSED);
    expect(hydratedPaused.snapshot.trustedPath.length).toBeGreaterThanOrEqual(2);

    await activeRunTrackingService.resumeActiveRun({
      startedAtMs: BASE_TIME + 10_000,
    });
    await activeRunTrackingService.recordLocation(point(6, 0, 24), { source: "foreground" });
    await activeRunTrackingService.recordLocation(point(7, 0, 32), { source: "foreground" });
    await forceCheckpointForAppState("background");
    await forceCheckpointForAppState("inactive");

    const activeCheckpoint = await loadActiveRun();
    expect(activeCheckpoint.status).toBe(OFFLINE_RUN_STATUS.RUNNING);
    expect(activeCheckpoint.appState).toBe("inactive");
    expect(activeCheckpoint.points.length).toBeGreaterThanOrEqual(3);
    expect(activeCheckpoint.segments.length).toBeGreaterThanOrEqual(2);

    activeRunTrackingService.__resetActiveRunRuntimeForTests();
    const runningRecovery = await findRecoverableRunForUser("user-1");
    const runningHydrated = await hydrateRecoverableRunCandidate(runningRecovery, {
      userId: "user-1",
      restartTracking: false,
    });
    expect(runningHydrated.snapshot.activeRunId).toBe("run-full-flow");
    expect(runningHydrated.snapshot.status).toBe(CANONICAL_RUN_STATUS.RUNNING);
    expect(runningHydrated.snapshot.rawPath.length).toBeGreaterThanOrEqual(runningHydrated.snapshot.trustedPath.length);

    await flushActiveRunCheckpoint({
      reason: "before_finish",
      checkpointAtMs: BASE_TIME + 18_000,
    });
    const finalSnapshot = await activeRunTrackingService.finishActiveRun({
      finishedAtMs: BASE_TIME + 20_000,
    });
    expect(finalSnapshot.status).toBe(CANONICAL_RUN_STATUS.FINISHED);

    const runData = await activeRunTrackingService.buildFinishedRunData({
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
    });
    await persistFinishedRunDraft(runData, {
      userId: "user-1",
      status: OFFLINE_RUN_STATUS.FINISHED,
      syncStatus: ACTIVE_RUN_SYNC_STATUS.LOCAL_ONLY,
    });
    const saved = await enqueueFinishedRun(runData, {
      userId: "user-1",
      schedule: false,
    });
    await markRecoveredRunLocallySaved({ reason: "integration_finish_saved" });

    expect(saved.id).toBe("run-full-flow");
    expect(saved.pendingSync).toBe(true);
    expect(saved.offlineStatus).toBe("PENDING_SYNC");
    expect(saved.path.length).toBeGreaterThanOrEqual(3);
    expect(saved.rawPath.length).toBeGreaterThanOrEqual(saved.path.length);
    expect(saved.segments.length).toBeGreaterThanOrEqual(2);
    expect(await activeRunTrackingService.getActiveRunSnapshot()).toBeNull();
    expect(await loadActiveRun()).toBeNull();
    expect(await findRecoverableRunForUser("user-1")).toBeNull();

    const localRuns = await loadLocalRuns();
    expect(localRuns).toHaveLength(1);
    expect(localRuns[0]).toMatchObject({
      id: "run-full-flow",
      localRunId: "run-full-flow",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
    });
  });

  test("syncRunsToFirestore marca sucesso sem duplicar e preserva remoteRunId", async () => {
    await saveLocalRun({
      id: "run-sync-success",
      localRunId: "run-sync-success",
      remoteRunId: "remote-existing",
      userId: "user-1",
      status: "completed",
      pendingSync: true,
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      distance: 100,
      duration: 40,
      path: [point(1, 0, 8), point(2, 0, 16)],
      rawPath: [point(1, 0, 8), point(2, 0, 16)],
      segments: [{ index: 0, trustedPath: [point(1, 0, 8), point(2, 0, 16)] }],
    });
    await saveLocalRun({
      id: "run-sync-success",
      localRunId: "run-sync-success",
      userId: "user-1",
      status: "completed",
      pendingSync: true,
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      distance: 120,
      duration: 44,
      path: [point(1, 0, 8), point(2, 0, 16)],
    });

    await syncRunsToFirestore();

    const localRuns = await loadLocalRuns();
    expect(localRuns).toHaveLength(1);
    expect(localRuns[0]).toMatchObject({
      id: "run-sync-success",
      localRunId: "run-sync-success",
      remoteRunId: "remote-existing",
      synced: true,
      pendingSync: false,
      syncStatus: "SYNCED",
      offlineStatus: "SYNCED",
    });
    expect(firestoreSets.some((item) => item.ref.path.includes("runs/run-sync-success"))).toBe(true);
  });

  test("falha de Firestore preserva corrida local como SYNC_FAILED para retry", async () => {
    jest.useFakeTimers();
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await saveLocalRun({
      id: "run-sync-fail",
      localRunId: "run-sync-fail",
      userId: "user-1",
      status: "completed",
      pendingSync: true,
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      distance: 80,
      duration: 30,
      path: [point(1, 0, 8), point(2, 0, 16)],
      rawPath: [point(1, 0, 8), point(2, 0, 16)],
      segments: [{ index: 0, trustedPath: [point(1, 0, 8), point(2, 0, 16)] }],
    });

    docShouldThrow = true;
    try {
      await syncRunsToFirestore();

      const [failed] = await loadLocalRuns();
      expect(failed).toMatchObject({
        id: "run-sync-fail",
        localRunId: "run-sync-fail",
        synced: false,
        pendingSync: true,
        syncStatus: "FAILED",
        offlineStatus: "SYNC_FAILED",
      });
      expect(failed.path).toHaveLength(2);
      expect(failed.lastSyncError).toContain("firestore unavailable");
    } finally {
      consoleErrorSpy.mockRestore();
      jest.clearAllTimers();
    }
  });
});
