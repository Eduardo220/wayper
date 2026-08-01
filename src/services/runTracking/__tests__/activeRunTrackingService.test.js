import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const storage = new Map();
const AsyncStorageMock = {
  getItem: jest.fn(async (key) => storage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => {
    storage.set(key, value);
  }),
  removeItem: jest.fn(async (key) => {
    storage.delete(key);
  }),
};

let locationStarted = false;
let backgroundTaskHandler = null;
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
  defineTask: jest.fn((name, handler) => {
    backgroundTaskHandler = handler;
  }),
};

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
}));

jest.unstable_mockModule("@react-native-community/netinfo", () => ({
  default: {
    fetch: jest.fn(async () => ({
      isConnected: true,
      isInternetReachable: true,
    })),
    addEventListener: jest.fn(() => () => {}),
  },
}));

jest.unstable_mockModule("react-native", () => ({
  AppState: {
    currentState: "active",
  },
  NativeModules: {},
  PermissionsAndroid: {
    PERMISSIONS: {
      POST_NOTIFICATIONS: "android.permission.POST_NOTIFICATIONS",
    },
    RESULTS: {
      GRANTED: "granted",
      DENIED: "denied",
    },
    check: jest.fn(async () => true),
    request: jest.fn(async () => "granted"),
  },
  Platform: {
    OS: "android",
    Version: 33,
  },
}));

jest.unstable_mockModule("expo-location", () => LocationMock);

jest.unstable_mockModule("expo-task-manager", () => TaskManagerMock);

const service = await import("../activeRunTrackingService.js");
await import("../../../tasks/activeRunLocationTask.js");
const runtimeService = await import("../activeRunRuntimeService.js");
const {
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_STORAGE_KEY,
} = await import("../activeRunState.js");
const {
  clearLogs,
  getLogs,
  __flushLogWritesForTests,
} = await import("../../diagnostics/logStorageService.js");

const BASE_TIME = 1_700_000_000_000;
const BASE_POINT = {
  latitude: -23.56,
  longitude: -46.64,
  accuracy: 8,
  timestamp: BASE_TIME,
};

function nextPoint(index = 1) {
  return {
    ...BASE_POINT,
    longitude: BASE_POINT.longitude + index * 0.00008,
    timestamp: BASE_TIME + index * 2000,
  };
}

function getStoredActiveRun() {
  return JSON.parse(storage.get(ACTIVE_RUN_STORAGE_KEY));
}

function getStoredTrustedPointsFromChunks(raw = getStoredActiveRun()) {
  const chunks = raw.routeChunksIndex?.chunks || [];
  return chunks.flatMap((chunk) => {
    const stored = storage.get(chunk.key);
    return stored ? JSON.parse(stored).trustedPath || [] : [];
  });
}

beforeEach(async () => {
  storage.clear();
  locationStarted = false;
  jest.clearAllMocks();
  TaskManagerMock.isTaskDefined.mockReturnValue(false);
  service.__resetActiveRunRuntimeForTests();
  await clearLogs();
});

afterEach(() => {
  service.__resetActiveRunRuntimeForTests();
});

describe("activeRunTrackingService lifecycle", () => {
  test("mantem ponto em memoria e persiste checkpoint canonico em lote", async () => {
    const started = await service.startActiveRun({
      activeRunId: "run-local-snapshot",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });

    expect(started.status).toBe(ACTIVE_RUN_STATUS.RUNNING);
    expect(storage.has(ACTIVE_RUN_STORAGE_KEY)).toBe(true);

    const writesBeforePoint = AsyncStorageMock.setItem.mock.calls
      .filter(([key]) => key === ACTIVE_RUN_STORAGE_KEY)
      .length;
    const updated = await service.recordLocation(nextPoint(1), { source: "foreground" });
    const beforeFlush = getStoredActiveRun();

    expect(updated.activeRunId).toBe("run-local-snapshot");
    expect(updated.trustedPath).toHaveLength(1);
    expect(beforeFlush.routeChunksIndex.chunks).toHaveLength(0);
    expect(AsyncStorageMock.setItem.mock.calls.filter(([key]) => key === ACTIVE_RUN_STORAGE_KEY)).toHaveLength(writesBeforePoint);
    expect(service.getTrackingRuntimeStatus().checkpointDirty).toBe(true);

    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });
    const raw = getStoredActiveRun();
    const chunkPoints = getStoredTrustedPointsFromChunks(raw);
    expect(raw.activeRunId).toBe("run-local-snapshot");
    expect(raw.snapshotStorage).toBe("light");
    expect(raw.trustedPath).toBeUndefined();
    expect(raw.routeChunksIndex.chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunkPoints.length).toBeGreaterThanOrEqual(1);
  });

  test("checkpoint aceita correcao de distancia quando anti-zigzag substitui a cauda", async () => {
    const metersToLongitude = (meters) =>
      meters / (111_320 * Math.cos((BASE_POINT.latitude * Math.PI) / 180));
    const pointAt = (elapsedMs, eastMeters, accuracy) => ({
      ...BASE_POINT,
      longitude: BASE_POINT.longitude + metersToLongitude(eastMeters),
      accuracy,
      timestamp: BASE_TIME + elapsedMs,
    });
    await service.startActiveRun({
      activeRunId: "run-distance-correction",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(pointAt(0, 0, 8), { source: "foreground" });
    const beforeCorrection = await service.recordLocation(pointAt(4_000, 8, 24), {
      source: "foreground",
    });
    await service.flushPendingActiveRunCheckpoint({
      reason: "distance_before_correction_test",
      force: true,
    });
    const beforeCorrectionCheckpoint =
      service.__getActiveRunCheckpointWorkCountersForTests();
    AsyncStorageMock.setItem.mockClear();

    const corrected = await service.recordLocation(pointAt(8_000, 1, 8), {
      source: "foreground",
      deferCheckpoint: true,
    });

    expect(corrected.trustedPath).toHaveLength(2);
    expect(corrected.distanceMeters).toBeLessThan(beforeCorrection.distanceMeters);
    await service.flushPendingActiveRunCheckpoint({
      reason: "distance_correction_test",
      force: true,
    });
    const afterCorrectionCheckpoint =
      service.__getActiveRunCheckpointWorkCountersForTests();
    expect(afterCorrectionCheckpoint.committedCheckpointFallbacks).toBe(
      beforeCorrectionCheckpoint.committedCheckpointFallbacks + 1
    );
    expect(afterCorrectionCheckpoint.normalizedPersistCalls).toBe(
      beforeCorrectionCheckpoint.normalizedPersistCalls + 1
    );
    expect(AsyncStorageMock.setItem.mock.calls
      .map(([key]) => key)
      .filter((key) => key.includes(":routeChunk:"))
    ).toHaveLength(1);
    expect(getStoredActiveRun().distanceMeters).toBeCloseTo(
      corrected.distanceMeters,
      6
    );

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });
    expect(restored.trustedPath).toHaveLength(2);
    expect(restored.rawPath).toHaveLength(3);
    expect(restored.trustedPath[1].longitude).toBeCloseTo(
      corrected.trustedPath[1].longitude,
      8
    );
    expect(restored.distanceMeters).toBeCloseTo(corrected.distanceMeters, 6);
  });

  test("checkpoint comprometido nao renormaliza a rota e preserva recovery", async () => {
    await service.startActiveRun({
      activeRunId: "run-committed-checkpoint-fast-path",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    const beforePoints =
      service.__getActiveRunCheckpointWorkCountersForTests();
    const canonicalWritesBefore = AsyncStorageMock.setItem.mock.calls
      .filter(([key]) => key === ACTIVE_RUN_STORAGE_KEY)
      .length;

    let committedSnapshot = null;
    for (let index = 1; index <= 5; index += 1) {
      committedSnapshot = await service.recordLocation(nextPoint(index), {
        source: index % 2 === 0 ? "background" : "foreground",
        deferCheckpoint: true,
      });
    }

    const beforeCheckpoint =
      service.__getActiveRunCheckpointWorkCountersForTests();
    expect(beforeCheckpoint.normalizedPersistCalls).toBe(
      beforePoints.normalizedPersistCalls
    );
    expect(beforeCheckpoint.committedCheckpointWrites).toBe(
      beforePoints.committedCheckpointWrites
    );
    expect(AsyncStorageMock.setItem.mock.calls
      .filter(([key]) => key === ACTIVE_RUN_STORAGE_KEY)
    ).toHaveLength(canonicalWritesBefore);

    const saved = await service.flushPendingActiveRunCheckpoint({
      reason: "committed_fast_path_test",
      force: true,
    });
    const storedCheckpoint = getStoredActiveRun();

    const afterCheckpoint =
      service.__getActiveRunCheckpointWorkCountersForTests();
    expect(afterCheckpoint.normalizedPersistCalls).toBe(
      beforeCheckpoint.normalizedPersistCalls
    );
    expect(afterCheckpoint.committedCheckpointFallbacks).toBe(
      beforeCheckpoint.committedCheckpointFallbacks
    );
    expect(afterCheckpoint.committedCheckpointWrites).toBe(
      beforeCheckpoint.committedCheckpointWrites + 1
    );
    expect(saved.trustedPath).toBe(committedSnapshot.trustedPath);
    expect(saved.rawPath).toBe(committedSnapshot.rawPath);
    expect(saved.segments).toBe(committedSnapshot.segments);
    expect(storedCheckpoint.durationSeconds).toBeGreaterThan(0);
    expect(storedCheckpoint.durationMs).toBe(
      storedCheckpoint.durationSeconds * 1000
    );
    expect(storedCheckpoint.pace).toBeCloseTo(
      storedCheckpoint.paceSecondsPerKm,
      8
    );
    expect(storedCheckpoint.paceSecondsPerKm).toBeCloseTo(
      storedCheckpoint.durationSeconds /
        (storedCheckpoint.distanceMeters / 1000),
      8
    );
    expect(
      afterCheckpoint.routeChunkPointsSanitized -
      beforeCheckpoint.routeChunkPointsSanitized
    ).toBeLessThanOrEqual(10);

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({
      restartTracking: false,
    });
    expect(restored).toMatchObject({
      activeRunId: "run-committed-checkpoint-fast-path",
      runId: "run-committed-checkpoint-fast-path",
      id: "run-committed-checkpoint-fast-path",
      status: ACTIVE_RUN_STATUS.RUNNING,
    });
    expect(restored.trustedPath).toHaveLength(5);
    expect(restored.rawPath).toHaveLength(5);
  });

  test("checkpoint legado fora do formato comprometido usa normalizacao segura", async () => {
    await service.startActiveRun({
      activeRunId: "run-checkpoint-safe-fallback",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    const legacySnapshot = await service.recordLocation(nextPoint(1), {
      source: "foreground",
      deferCheckpoint: true,
    });
    legacySnapshot.version = 1;
    legacySnapshot.schemaVersion = 1;
    legacySnapshot.formatVersion = 1;
    const before = service.__getActiveRunCheckpointWorkCountersForTests();

    await service.flushPendingActiveRunCheckpoint({
      reason: "safe_fallback_without_point_commit",
      force: true,
    });

    const after = service.__getActiveRunCheckpointWorkCountersForTests();
    expect(after.committedCheckpointWrites).toBe(
      before.committedCheckpointWrites
    );
    expect(after.committedCheckpointFallbacks).toBe(
      before.committedCheckpointFallbacks + 1
    );
    expect(after.normalizedPersistCalls).toBe(
      before.normalizedPersistCalls + 1
    );
    expect(getStoredActiveRun()).toMatchObject({
      activeRunId: "run-checkpoint-safe-fallback",
      status: ACTIVE_RUN_STATUS.RUNNING,
      snapshotStorage: "light",
      version: 1,
    });
  });

  test.each([
    {
      label: "chunk",
      matchesKey: (key) => key.startsWith(
        `${service.ACTIVE_RUN_ROUTE_CHUNK_KEY_PREFIX}:`
      ),
    },
    {
      label: "indice de chunks",
      matchesKey: (key) => key.startsWith(
        `${service.ACTIVE_RUN_ROUTE_CHUNK_INDEX_STORAGE_KEY}:`
      ),
    },
  ])("falha de escrita de $label preserva snapshot anterior e recupera com seguranca", async ({
    label,
    matchesKey,
  }) => {
    await service.startActiveRun({
      activeRunId: "run-route-chunk-write-retry",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), {
      source: "foreground",
      deferCheckpoint: true,
    });
    await service.flushPendingActiveRunCheckpoint({
      reason: "route_chunk_write_baseline_test",
      force: true,
    });
    const currentBefore = storage.get(ACTIVE_RUN_STORAGE_KEY);
    const backupBefore = storage.get(service.ACTIVE_RUN_BACKUP_STORAGE_KEY);
    const countersBefore =
      service.__getActiveRunCheckpointWorkCountersForTests();
    await service.recordLocation(nextPoint(2), {
      source: "foreground",
      deferCheckpoint: true,
    });
    let failedOnce = false;
    AsyncStorageMock.setItem.mockImplementation(async (key, value) => {
      if (!failedOnce && matchesKey(key)) {
        failedOnce = true;
        throw new Error("route chunk storage unavailable");
      }
      storage.set(key, value);
    });

    try {
      await expect(service.flushPendingActiveRunCheckpoint({
        reason: "route_chunk_write_failure_test",
        force: true,
      })).resolves.toMatchObject({
        activeRunId: "run-route-chunk-write-retry",
      });

      expect(failedOnce).toBe(true);
      expect(storage.get(ACTIVE_RUN_STORAGE_KEY)).toBe(currentBefore);
      expect(storage.get(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)).toBe(
        backupBefore
      );
      expect(service.getTrackingRuntimeStatus()).toMatchObject({
        checkpointDirty: true,
        acceptedPointsSinceCheckpoint: 1,
        rawPointsSinceCheckpoint: 1,
      });
      expect(
        service.__getActiveRunCheckpointWorkCountersForTests()
          .committedCheckpointWrites
      ).toBe(countersBefore.committedCheckpointWrites);
    } finally {
      AsyncStorageMock.setItem.mockImplementation(async (key, value) => {
        storage.set(key, value);
      });
    }

    if (label === "indice de chunks") {
      service.__resetActiveRunRuntimeForTests();
      const restoredAfterCrash = await service.restoreActiveRun({
        restartTracking: false,
      });
      expect(restoredAfterCrash.trustedPath).toHaveLength(1);
      expect(restoredAfterCrash.rawPath).toHaveLength(1);
      expect(restoredAfterCrash.trustedPath[0].timestamp).toBe(
        nextPoint(1).timestamp
      );
      expect(restoredAfterCrash.distanceMeters).toBeCloseTo(
        JSON.parse(currentBefore).distanceMeters,
        6
      );
      return;
    }

    await service.flushPendingActiveRunCheckpoint({
      reason: "route_chunk_write_retry_test",
      force: true,
    });

    expect(service.getTrackingRuntimeStatus().checkpointDirty).toBe(false);
    expect(getStoredTrustedPointsFromChunks()).toHaveLength(2);

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });
    expect(restored.trustedPath).toHaveLength(2);
    expect(restored.trustedPath[1].timestamp).toBe(nextPoint(2).timestamp);
  });

  test("recovery prefere backup mais novo quando current falha apos o backup", async () => {
    await service.startActiveRun({
      activeRunId: "run-newer-backup-recovery",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), {
      source: "foreground",
      deferCheckpoint: true,
    });
    const currentBefore = storage.get(ACTIVE_RUN_STORAGE_KEY);
    let currentWriteFailed = false;
    AsyncStorageMock.setItem.mockImplementation(async (key, value) => {
      if (!currentWriteFailed && key === ACTIVE_RUN_STORAGE_KEY) {
        currentWriteFailed = true;
        throw new Error("canonical snapshot write unavailable");
      }
      storage.set(key, value);
    });

    try {
      await service.flushPendingActiveRunCheckpoint({
        reason: "newer_backup_test",
        force: true,
      });
      expect(currentWriteFailed).toBe(true);
      expect(storage.get(ACTIVE_RUN_STORAGE_KEY)).toBe(currentBefore);
      expect(JSON.parse(
        storage.get(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)
      ).routeChunksIndex.totalTrustedPoints).toBe(1);
    } finally {
      AsyncStorageMock.setItem.mockImplementation(async (key, value) => {
        storage.set(key, value);
      });
    }

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });

    expect(restored).toMatchObject({
      activeRunId: "run-newer-backup-recovery",
      status: ACTIVE_RUN_STATUS.RUNNING,
    });
    expect(restored.trustedPath).toHaveLength(1);
    expect(restored.trustedPath[0].timestamp).toBe(nextPoint(1).timestamp);
    await __flushLogWritesForTests();
    const logs = await getLogs({ runId: "run-newer-backup-recovery" });
    expect(logs.map((entry) => entry.event)).toContain(
      "RUN_ACTIVE_SNAPSHOT_BACKUP_USED"
    );
  });

  test("backup de outra corrida nao substitui o current canonico", async () => {
    await service.startActiveRun({
      activeRunId: "run-current-identity-backup",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    const foreignObservedAtMs = Date.now() + 60_000;
    const foreignBackup = {
      ...JSON.parse(storage.get(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)),
      activeRunId: "run-foreign-backup",
      runId: "run-foreign-backup",
      id: "run-foreign-backup",
      lastUpdatedAtMs: foreignObservedAtMs,
      lastUpdatedAt: new Date(foreignObservedAtMs).toISOString(),
    };
    foreignBackup.routeChunksIndex = {
      ...foreignBackup.routeChunksIndex,
      activeRunId: "run-foreign-backup",
      updatedAt: new Date(foreignObservedAtMs).toISOString(),
    };
    storage.set(
      service.ACTIVE_RUN_BACKUP_STORAGE_KEY,
      JSON.stringify(foreignBackup)
    );

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });

    expect(restored.activeRunId).toBe("run-current-identity-backup");
  });

  test("backup live mais antigo nao vence current mais avancado", async () => {
    await service.startActiveRun({
      activeRunId: "run-stale-live-backup",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    const staleBackup = JSON.parse(
      storage.get(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)
    );
    staleBackup.routeChunksIndex = {
      ...staleBackup.routeChunksIndex,
      updatedAt: new Date(BASE_TIME).toISOString(),
    };
    await service.recordLocation(nextPoint(1), {
      source: "foreground",
      deferCheckpoint: true,
    });
    await service.flushPendingActiveRunCheckpoint({
      reason: "newer_current_test",
      force: true,
    });
    storage.set(
      service.ACTIVE_RUN_BACKUP_STORAGE_KEY,
      JSON.stringify(staleBackup)
    );

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });

    expect(restored.trustedPath).toHaveLength(1);
    await __flushLogWritesForTests();
    const logs = await getLogs({ runId: "run-stale-live-backup" });
    expect(logs.map((entry) => entry.event)).not.toContain(
      "RUN_ACTIVE_SNAPSHOT_BACKUP_USED"
    );
  });

  test("empate de recencia aceita backup com distancia corrigida", async () => {
    await service.startActiveRun({
      activeRunId: "run-corrected-distance-backup",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    const current = JSON.parse(storage.get(ACTIVE_RUN_STORAGE_KEY));
    const backup = JSON.parse(
      storage.get(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)
    );
    current.distanceMeters = 100;
    current.distance = 100;
    backup.distanceMeters = 50;
    backup.distance = 50;
    storage.set(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(current));
    storage.set(
      service.ACTIVE_RUN_BACKUP_STORAGE_KEY,
      JSON.stringify(backup)
    );

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });
    await __flushLogWritesForTests();
    const logs = await getLogs({ runId: "run-corrected-distance-backup" });

    expect(logs.map((entry) => entry.event)).toContain(
      "RUN_ACTIVE_SNAPSHOT_BACKUP_USED"
    );
    expect(restored.distanceMeters).toBe(50);
  });

  test("backup terminal da mesma corrida nao perde para current live", async () => {
    await service.startActiveRun({
      activeRunId: "run-terminal-backup",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    const terminalBackup = {
      ...JSON.parse(storage.get(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)),
      status: ACTIVE_RUN_STATUS.FINISHING,
      lastUpdatedAtMs: BASE_TIME - 1_000,
      lastUpdatedAt: new Date(BASE_TIME - 1_000).toISOString(),
      updatedAt: new Date(BASE_TIME - 1_000).toISOString(),
    };
    terminalBackup.routeChunksIndex = {
      ...terminalBackup.routeChunksIndex,
      updatedAt: new Date(BASE_TIME - 1_000).toISOString(),
    };
    storage.set(
      service.ACTIVE_RUN_BACKUP_STORAGE_KEY,
      JSON.stringify(terminalBackup)
    );

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });

    expect(restored).toMatchObject({
      activeRunId: "run-terminal-backup",
      status: ACTIVE_RUN_STATUS.FINISHING,
    });
  });

  test("mantem backup do snapshot canonico e usa backup se current estiver corrompido", async () => {
    await service.startActiveRun({
      activeRunId: "run-backup-restore",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });

    expect(storage.has(ACTIVE_RUN_STORAGE_KEY)).toBe(true);
    expect(storage.has(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)).toBe(true);

    storage.set(ACTIVE_RUN_STORAGE_KEY, "{broken-json");
    service.__resetActiveRunRuntimeForTests();

    const restored = await service.restoreActiveRun({ restartTracking: false });

    expect(restored.activeRunId).toBe("run-backup-restore");
    expect(restored.status).toBe(ACTIVE_RUN_STATUS.RUNNING);
    expect(restored.trustedPath.length).toBeGreaterThanOrEqual(1);
    expect(storage.has(service.ACTIVE_RUN_CORRUPT_STORAGE_KEY)).toBe(true);
  });

  test("usa backup quando current e JSON valido sem identidade de corrida", async () => {
    await service.startActiveRun({
      activeRunId: "run-invalid-current-identity",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    storage.set(ACTIVE_RUN_STORAGE_KEY, "{}");

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });

    expect(restored.activeRunId).toBe("run-invalid-current-identity");
    expect(storage.has(service.ACTIVE_RUN_CORRUPT_STORAGE_KEY)).toBe(true);
  });

  test("salva rota em chunks, nao regrava chunks antigos e restaura rota completa", async () => {
    await service.startActiveRun({
      activeRunId: "run-route-chunks",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });

    for (let index = 1; index <= service.ACTIVE_RUN_ROUTE_CHUNK_SIZE + 2; index += 1) {
      await service.recordLocation(nextPoint(index), { source: "foreground" });
    }
    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });

    const raw = getStoredActiveRun();
    expect(raw.snapshotStorage).toBe("light");
    expect(raw.trustedPath).toBeUndefined();
    expect(raw.routeChunksIndex.chunks.length).toBeGreaterThanOrEqual(2);

    const firstChunkKey = raw.routeChunksIndex.chunks[0].key;
    const writesBefore = AsyncStorageMock.setItem.mock.calls
      .filter(([key]) => key === firstChunkKey)
      .length;

    await service.recordLocation(nextPoint(service.ACTIVE_RUN_ROUTE_CHUNK_SIZE + 3), { source: "foreground" });
    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });

    const writesAfter = AsyncStorageMock.setItem.mock.calls
      .filter(([key]) => key === firstChunkKey)
      .length;
    expect(writesAfter).toBe(writesBefore);

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });

    expect(restored.activeRunId).toBe("run-route-chunks");
    expect(restored.trustedPath.length).toBeGreaterThanOrEqual(service.ACTIVE_RUN_ROUTE_CHUNK_SIZE + 3);
    expect(restored.routeSegments.length).toBeGreaterThanOrEqual(1);
  });

  test("limpa snapshot leve e chunks somente apos confirmacao local", async () => {
    await service.startActiveRun({
      activeRunId: "run-clean-chunks",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });
    const raw = getStoredActiveRun();
    const chunkKeys = raw.routeChunksIndex.chunks.map((chunk) => chunk.key);
    expect(chunkKeys.some((key) => storage.has(key))).toBe(true);

    await service.markActiveRunLocallySaved({
      expectedRunId: "run-clean-chunks",
      reason: "test",
    });

    expect(storage.has(ACTIVE_RUN_STORAGE_KEY)).toBe(false);
    expect(storage.has(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)).toBe(false);
    expect(chunkKeys.some((key) => storage.has(key))).toBe(false);
  });

  test("nao limpa snapshot nem chunks quando o ID esperado e de outra corrida", async () => {
    await service.startActiveRun({
      activeRunId: "run-protected-cleanup",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });
    const raw = getStoredActiveRun();
    const chunkKeys = raw.routeChunksIndex.chunks.map((chunk) => chunk.key);

    const cleared = await service.markActiveRunLocallySaved({
      expectedRunId: "another-run",
      reason: "test_mismatch",
    });

    expect(cleared).toBe(false);
    expect(storage.has(ACTIVE_RUN_STORAGE_KEY)).toBe(true);
    expect(storage.has(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)).toBe(true);
    expect(chunkKeys.some((key) => storage.has(key))).toBe(true);
    expect((await service.getActiveRunSnapshot()).activeRunId).toBe("run-protected-cleanup");
  });

  test("falha de escrita do AsyncStorage nao apaga snapshot em memoria nem backup anterior", async () => {
    await service.startActiveRun({
      activeRunId: "run-write-error-safe",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    const previousBackup = storage.get(service.ACTIVE_RUN_BACKUP_STORAGE_KEY);
    let failedActiveRunWrite = false;
    AsyncStorageMock.setItem.mockImplementation(async (key, value) => {
      if (!failedActiveRunWrite && key === service.ACTIVE_RUN_BACKUP_STORAGE_KEY) {
        failedActiveRunWrite = true;
        throw new Error("sqlite busy");
      }
      storage.set(key, value);
    });

    try {
      await service.recordLocation(nextPoint(1), { source: "foreground" });
      await expect(service.flushPendingActiveRunCheckpoint({ reason: "test", force: true })).resolves.toMatchObject({
        activeRunId: "run-write-error-safe",
      });

      expect(await service.getActiveRunSnapshot()).toMatchObject({
        activeRunId: "run-write-error-safe",
      });
      expect(storage.get(service.ACTIVE_RUN_BACKUP_STORAGE_KEY)).toBe(previousBackup);
    } finally {
      AsyncStorageMock.setItem.mockImplementation(async (key, value) => {
        storage.set(key, value);
      });
    }
  });

  test("ponto em background atualiza o snapshot canonico sem duplicar watcher", async () => {
    await service.startActiveRun({
      activeRunId: "run-background-point",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(service.getTrackingRuntimeStatus()).toMatchObject({
      activeRunId: "run-background-point",
      watcherStatus: "background_started",
      backgroundStarted: true,
      taskName: service.ACTIVE_RUN_LOCATION_TASK,
    });

    const updated = await service.handleActiveRunLocationTask({
      data: {
        locations: [{
          coords: nextPoint(1),
          timestamp: nextPoint(1).timestamp,
        }],
      },
    });
    const raw = getStoredActiveRun();
    const chunkPoints = getStoredTrustedPointsFromChunks(raw);

    expect(updated.activeRunId).toBe("run-background-point");
    expect(updated.source).toBe("background");
    expect(raw.activeRunId).toBe("run-background-point");
    expect(raw.source).toBe("background");
    expect(raw.snapshotStorage).toBe("light");
    expect(chunkPoints.length).toBeGreaterThanOrEqual(1);
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  test("lote de background e ordenado por timestamp antes de atualizar o snapshot canonico", async () => {
    const backgroundTask = backgroundTaskHandler;
    expect(typeof backgroundTask).toBe("function");

    await service.startActiveRun({
      activeRunId: "run-background-ordered",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });

    await backgroundTask({
      data: {
        locations: [
          { coords: { ...nextPoint(2), accuracy: 8 }, timestamp: BASE_TIME + 4000 },
          { coords: { ...nextPoint(1), accuracy: 8 }, timestamp: BASE_TIME + 2000 },
        ],
      },
    });

    const raw = getStoredActiveRun();
    const chunkPoints = getStoredTrustedPointsFromChunks(raw);
    expect(raw.activeRunId).toBe("run-background-ordered");
    expect(chunkPoints.map((point) => point.timestamp)).toEqual([
      BASE_TIME + 2000,
      BASE_TIME + 4000,
    ]);
    expect(chunkPoints).toHaveLength(2);
  });

  test("ponto recebido em background durante PAUSED nao soma distancia", async () => {
    await service.startActiveRun({
      activeRunId: "run-paused-background",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });
    const paused = await service.pauseActiveRun({ endedAtMs: BASE_TIME + 5000 });

    const ignored = await service.recordLocation(nextPoint(3), { source: "background" });

    expect(ignored.status).toBe(ACTIVE_RUN_STATUS.PAUSED);
    expect(ignored.trustedPath).toEqual(paused.trustedPath);
    expect(ignored.distanceMeters).toBe(paused.distanceMeters);
  });

  test("restaura corrida RUNNING depois de runtime resetado sem criar nova sessao", async () => {
    await service.startActiveRun({
      activeRunId: "run-restart",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: true });

    expect(restored.activeRunId).toBe("run-restart");
    expect(restored.status).toBe(ACTIVE_RUN_STATUS.RUNNING);
    expect(restored.trustedPath.length).toBeGreaterThanOrEqual(1);

    const afterRestorePoint = await service.recordLocation(nextPoint(2), { source: "foreground" });
    expect(afterRestorePoint.activeRunId).toBe("run-restart");
    expect(afterRestorePoint.trustedPath.length).toBeGreaterThanOrEqual(restored.trustedPath.length);
  });

  test("minimizar e voltar nao apaga rota nem cria segmento sem pausa", async () => {
    await service.startActiveRun({
      activeRunId: "run-minimize-return",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    for (let index = 1; index <= 5; index += 1) {
      await service.recordLocation(nextPoint(index), { source: "foreground" });
    }

    const before = await service.getActiveRunSnapshot();
    const restored = await service.restoreActiveRun({ restartTracking: true });

    expect(before.trustedPath).toHaveLength(5);
    expect(restored.activeRunId).toBe("run-minimize-return");
    expect(restored.trustedPath).toHaveLength(5);
    expect(restored.segments).toHaveLength(before.segments.length);
    expect(restored.segments).toHaveLength(1);
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  test("novo ponto apos recovery entra no ultimo segmento existente", async () => {
    await service.startActiveRun({
      activeRunId: "run-append-after-recovery",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    for (let index = 1; index <= 5; index += 1) {
      await service.recordLocation(nextPoint(index), { source: "foreground" });
    }

    await service.restoreActiveRun({ restartTracking: true });
    const updated = await service.recordLocation(nextPoint(6), { source: "foreground" });

    expect(updated.trustedPath).toHaveLength(6);
    expect(updated.segments).toHaveLength(1);
    expect(updated.segments[0].trustedPath).toHaveLength(6);
  });

  test("hidratar snapshot parcial nao sobrescreve segments reais com vazio", async () => {
    await service.startActiveRun({
      activeRunId: "run-safe-empty-overwrite",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    for (let index = 1; index <= 5; index += 1) {
      await service.recordLocation(nextPoint(index), { source: "foreground" });
    }

    const hydrated = await service.hydrateActiveRunSnapshot({
      activeRunId: "run-safe-empty-overwrite",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: BASE_TIME,
      lastUpdatedAtMs: BASE_TIME + 20_000,
      points: [],
      path: [],
      trustedPath: [],
      filteredPoints: [],
      rawPath: [],
      rawPoints: [],
      segments: [],
      routeSegments: [],
      distanceMeters: 0,
    }, { restartTracking: false });

    expect(hydrated.trustedPath).toHaveLength(5);
    expect(hydrated.segments).toHaveLength(1);
    expect(hydrated.meta.ignoredEmptyGeometryOverwrite).toBe(true);
    await __flushLogWritesForTests();
    const logs = await getLogs({ runId: "run-safe-empty-overwrite" });
    expect(logs.map((log) => log.event)).toContain("ACTIVE_RUN_EMPTY_OVERWRITE_BLOCKED");
  });

  test("distancia preservada quando recovery recebe geometria parcial menor", async () => {
    await service.startActiveRun({
      activeRunId: "run-distance-preserved",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    for (let index = 1; index <= 5; index += 1) {
      await service.recordLocation(nextPoint(index), { source: "foreground" });
    }
    const existing = await service.getActiveRunSnapshot();

    const hydrated = await service.hydrateActiveRunSnapshot({
      activeRunId: "run-distance-preserved",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: BASE_TIME,
      lastUpdatedAtMs: BASE_TIME + 20_000,
      trustedPath: existing.trustedPath.slice(-1),
      rawPath: existing.rawPath.slice(-1),
      segments: [],
      routeSegments: [],
      distanceMeters: Math.max(0, existing.distanceMeters - 50),
    }, { restartTracking: false });

    expect(hydrated.distanceMeters).toBe(existing.distanceMeters);
    expect(hydrated.trustedPath).toHaveLength(existing.trustedPath.length);
    expect(hydrated.meta.distancePreserved).toBe(true);
    await __flushLogWritesForTests();
    const logs = await getLogs({ runId: "run-distance-preserved" });
    expect(logs.map((log) => log.event)).toContain("ACTIVE_RUN_DISTANCE_REGRESSION_BLOCKED");
  });

  test("fechar e abrir app recupera todos os pontos e continua append", async () => {
    await service.startActiveRun({
      activeRunId: "run-app-restart",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    for (let index = 1; index <= 5; index += 1) {
      await service.recordLocation(nextPoint(index), { source: "foreground" });
    }

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: true });
    const updated = await service.recordLocation(nextPoint(6), { source: "foreground" });

    expect(restored.trustedPath).toHaveLength(5);
    expect(restored.segments).toHaveLength(1);
    expect(updated.trustedPath).toHaveLength(6);
    expect(updated.segments).toHaveLength(1);
  });

  test("pausa explicita permite novo segmento ao retomar, recovery nao cria outro", async () => {
    await service.startActiveRun({
      activeRunId: "run-explicit-pause",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.recordLocation(nextPoint(2), { source: "foreground" });
    await service.pauseActiveRun({ endedAtMs: BASE_TIME + 6000 });
    await service.resumeActiveRun({ startedAtMs: BASE_TIME + 10_000 });
    await service.recordLocation(nextPoint(6), { source: "foreground" });
    await service.recordLocation(nextPoint(7), { source: "foreground" });

    const beforeRestore = await service.getActiveRunSnapshot();
    const restored = await service.restoreActiveRun({ restartTracking: true });
    const updated = await service.recordLocation(nextPoint(8), { source: "foreground" });

    expect(beforeRestore.segments).toHaveLength(2);
    expect(restored.segments).toHaveLength(2);
    expect(updated.segments).toHaveLength(2);
    expect(updated.segments[1].trustedPath.length).toBeGreaterThan(restored.segments[1].trustedPath.length);
  });

  test("retorno active nao duplica background watcher quando location task ja esta rodando", async () => {
    await service.startActiveRun({
      activeRunId: "run-no-duplicate-watchers",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);

    service.__resetActiveRunRuntimeForTests();
    locationStarted = true;
    await service.restoreActiveRun({ restartTracking: true });

    expect(LocationMock.hasStartedLocationUpdatesAsync).toHaveBeenCalled();
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  test("parada background trata task removida concorrente como sucesso idempotente", async () => {
    await service.startActiveRun({
      activeRunId: "run-background-stop-race",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    LocationMock.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(true);
    LocationMock.stopLocationUpdatesAsync.mockRejectedValueOnce(new Error(
      "TaskNotFoundException: Task 'WAYPER_ACTIVE_RUN_LOCATION' not found"
    ));

    await expect(service.stopBackgroundLocationUpdates({
      reason: "notification_pause",
    })).resolves.toBe(true);
  });

  test("runtime reconcile reidrata RUNNING e preserva task background existente", async () => {
    await service.startActiveRun({
      activeRunId: "run-runtime-reconcile",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);

    service.__resetActiveRunRuntimeForTests();
    locationStarted = true;

    const result = await runtimeService.hydrateActiveRunFromRuntime("test_reentry", {
      userId: "user-1",
      restartTracking: true,
    });

    expect(result.snapshot.activeRunId).toBe("run-runtime-reconcile");
    expect(result.snapshot.status).toBe(ACTIVE_RUN_STATUS.RUNNING);
    expect(result.snapshot.trustedPath.length).toBeGreaterThanOrEqual(1);
    expect(LocationMock.hasStartedLocationUpdatesAsync).toHaveBeenCalled();
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  test("runtime deriva usuario do snapshot ao reconciliar acao sem sessao de UI", async () => {
    await service.startActiveRun({
      activeRunId: "run-runtime-derived-user",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.flushPendingActiveRunCheckpoint({ reason: "test", force: true });

    service.__resetActiveRunRuntimeForTests();
    const result = await runtimeService.hydrateActiveRunFromRuntime("notification_action:pause", {
      restartTracking: false,
    });

    expect(result.snapshot).toMatchObject({
      activeRunId: "run-runtime-derived-user",
      userId: "user-1",
      status: ACTIVE_RUN_STATUS.RUNNING,
    });
  });

  test("runtime nao retorna IDLE quando ha evidencia ativa sem snapshot legivel", async () => {
    service.setRunRuntimeSurfaceState({
      backgroundTaskStatus: "started",
      notificationStatus: "active",
    });

    const result = await runtimeService.reconcileActiveRunState("active_evidence_without_snapshot", {
      restartTracking: false,
    });

    expect(result.snapshot).toMatchObject({
      status: ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
    });
    expect(result.canShowStartButton).toBe(false);
    expect(result.runtime.canShowStartButton).toBe(false);
  });

  test("startActiveRun nao substitui uma corrida viva existente", async () => {
    await service.startActiveRun({
      activeRunId: "run-original",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });

    const protectedSnapshot = await service.startActiveRun({
      activeRunId: "run-duplicate",
      userId: "user-1",
      startedAtMs: BASE_TIME + 10_000,
    });

    expect(protectedSnapshot.activeRunId).toBe("run-original");
    expect(protectedSnapshot.meta.protectedFromReplace).toBe(true);
    const raw = JSON.parse(storage.get(ACTIVE_RUN_STORAGE_KEY));
    expect(raw.activeRunId).toBe("run-original");
  });

  test("inicios concorrentes sao serializados e preservam a primeira corrida", async () => {
    const [first, second] = await Promise.all([
      service.startActiveRun({
        activeRunId: "run-concurrent-first",
        userId: "user-1",
        startedAtMs: BASE_TIME,
      }),
      service.startActiveRun({
        activeRunId: "run-concurrent-second",
        userId: "user-1",
        startedAtMs: BASE_TIME + 1000,
      }),
    ]);

    expect(first.activeRunId).toBe("run-concurrent-first");
    expect(second.activeRunId).toBe("run-concurrent-first");
    expect(second.meta.protectedFromReplace).toBe(true);
    expect(getStoredActiveRun().activeRunId).toBe("run-concurrent-first");
  });

  test("falha ao iniciar servico fica persistida para recuperacao", async () => {
    LocationMock.startLocationUpdatesAsync.mockRejectedValueOnce(new Error("foreground service unavailable"));

    await service.startActiveRun({
      activeRunId: "run-service-start-failed",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.__flushActiveRunBackgroundLifecycleForTests();

    const snapshot = await service.getActiveRunSnapshot();
    expect(snapshot).toMatchObject({
      activeRunId: "run-service-start-failed",
      recoveryPending: true,
      meta: {
        backgroundTrackingStarted: false,
        backgroundTrackingStatus: "start_failed",
      },
      lastError: {
        source: "startBackgroundLocationUpdates",
      },
    });
    expect(getStoredActiveRun().lastError.source).toBe("startBackgroundLocationUpdates");
  });

  test("pause e resume duplicados sao idempotentes", async () => {
    await service.startActiveRun({
      activeRunId: "run-idempotent",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });

    const paused = await service.pauseActiveRun({ endedAtMs: BASE_TIME + 5000 });
    const pausedAgain = await service.pauseActiveRun({ endedAtMs: BASE_TIME + 7000 });
    expect(pausedAgain.status).toBe(ACTIVE_RUN_STATUS.PAUSED);
    expect(pausedAgain.segments).toEqual(paused.segments);

    const resumed = await service.resumeActiveRun({ startedAtMs: BASE_TIME + 9000 });
    const resumedAgain = await service.resumeActiveRun({ startedAtMs: BASE_TIME + 11_000 });
    expect(resumedAgain.status).toBe(ACTIVE_RUN_STATUS.RUNNING);
    expect(resumedAgain.segments).toEqual(resumed.segments);
  });

  test("retomada imediata desconta a pausa aberta antes do primeiro novo ponto", async () => {
    await service.startActiveRun({
      activeRunId: "run-resume-open-pause",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    const paused = await service.pauseActiveRun({ endedAtMs: BASE_TIME + 10_000 });

    expect(paused).toMatchObject({
      status: ACTIVE_RUN_STATUS.PAUSED,
      durationSeconds: 10,
      pausedAtMs: BASE_TIME + 10_000,
    });

    const resumed = await service.resumeActiveRun({
      startedAtMs: BASE_TIME + 70_000,
    });

    expect(resumed).toMatchObject({
      status: ACTIVE_RUN_STATUS.RUNNING,
      durationSeconds: 10,
      pausedDurationMs: 60_000,
      totalPausedMs: 60_000,
    });
    expect(service.getCurrentDurationSeconds(BASE_TIME + 71_000)).toBe(11);
  });

  test("retomadas sucessivas acumulam somente cada intervalo pausado", async () => {
    await service.startActiveRun({
      activeRunId: "run-multiple-pauses",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.pauseActiveRun({ endedAtMs: BASE_TIME + 10_000 });
    await service.resumeActiveRun({ startedAtMs: BASE_TIME + 70_000 });
    await service.recordLocation({
      ...nextPoint(2),
      timestamp: BASE_TIME + 72_000,
    }, { source: "foreground" });
    await service.pauseActiveRun({ endedAtMs: BASE_TIME + 80_000 });

    const resumed = await service.resumeActiveRun({
      startedAtMs: BASE_TIME + 110_000,
    });

    expect(resumed.pausedDurationMs).toBe(90_000);
    expect(resumed.totalPausedMs).toBe(90_000);
    expect(resumed.durationSeconds).toBe(20);
  });

  test("hidrata snapshot canonico preservando pausa, path e segmentos", async () => {
    const hydrated = await service.hydrateActiveRunSnapshot({
      activeRunId: "run-hydrated",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.PAUSED,
      startedAtMs: BASE_TIME,
      lastUpdatedAtMs: BASE_TIME + 6000,
      trustedPath: [nextPoint(1), nextPoint(2)],
      rawPath: [nextPoint(1), nextPoint(2)],
      segments: [
        {
          index: 0,
          startedAt: BASE_TIME,
          endedAt: BASE_TIME + 6000,
          trustedPath: [nextPoint(1), nextPoint(2)],
          rawPath: [nextPoint(1), nextPoint(2)],
        },
      ],
    }, { restartTracking: false });

    expect(hydrated.status).toBe(ACTIVE_RUN_STATUS.PAUSED);
    expect(hydrated.trustedPath).toHaveLength(2);
    expect(hydrated.segments).toHaveLength(1);

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });
    expect(restored.activeRunId).toBe("run-hydrated");
    expect(restored.status).toBe(ACTIVE_RUN_STATUS.PAUSED);
    expect(restored.trustedPath).toHaveLength(2);
    await __flushLogWritesForTests();
    const logs = await getLogs({ runId: "run-hydrated" });
    expect(logs.map((log) => log.event)).toContain("RECOVERY_COMPLETED");
  });

  test("serializa ingestao e checkpoints concorrentes sem snapshot antigo vencer", async () => {
    let writesInFlight = 0;
    let maxWritesInFlight = 0;
    AsyncStorageMock.setItem.mockImplementation(async (key, value) => {
      writesInFlight += 1;
      maxWritesInFlight = Math.max(maxWritesInFlight, writesInFlight);
      await Promise.resolve();
      storage.set(key, value);
      writesInFlight -= 1;
    });

    await service.startActiveRun({
      activeRunId: "run-concurrent-checkpoints",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await Promise.all(Array.from({ length: 10 }, (_, index) =>
      service.recordLocation(nextPoint(index + 1), { source: index % 2 ? "background" : "foreground" })
    ));
    await Promise.all([
      service.flushPendingActiveRunCheckpoint({ reason: "concurrent-a", force: true }),
      service.flushPendingActiveRunCheckpoint({ reason: "concurrent-b", force: true }),
    ]);

    const restoredBeforeReset = await service.getActiveRunSnapshot();
    expect(restoredBeforeReset.trustedPath).toHaveLength(10);
    expect(maxWritesInFlight).toBe(1);

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });
    expect(restored.trustedPath).toHaveLength(10);
  });

  test("corrida longa regrava somente o chunk aberto no checkpoint incremental", async () => {
    const points = Array.from({ length: 260 }, (_, index) => nextPoint(index + 1));
    await service.hydrateActiveRunSnapshot({
      activeRunId: "run-incremental-chunks",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: BASE_TIME,
      lastUpdatedAtMs: BASE_TIME + 520_000,
      trustedPath: points,
      rawPath: points,
      segments: [{
        index: 0,
        startedAt: BASE_TIME,
        trustedPath: points,
        rawPath: points,
      }],
    }, { restartTracking: false });

    service.__resetActiveRunRuntimeForTests();
    AsyncStorageMock.setItem.mockClear();
    const restored = await service.restoreActiveRun({ restartTracking: false });
    const chunkWritesDuringRecovery = AsyncStorageMock.setItem.mock.calls
      .map(([key]) => key)
      .filter((key) => key.includes(":routeChunk:"));
    expect(restored.trustedPath).toHaveLength(260);
    expect(chunkWritesDuringRecovery).toHaveLength(0);

    AsyncStorageMock.setItem.mockClear();
    const countersBefore =
      service.__getActiveRunCheckpointWorkCountersForTests();
    await service.recordLocation(nextPoint(261), {
      source: "foreground",
      deferCheckpoint: true,
    });
    await service.flushPendingActiveRunCheckpoint({ reason: "long_run_incremental", force: true });
    const countersAfter =
      service.__getActiveRunCheckpointWorkCountersForTests();

    const chunkWriteKeys = AsyncStorageMock.setItem.mock.calls
      .map(([key]) => key)
      .filter((key) => key.includes(":routeChunk:"));
    expect(chunkWriteKeys).toHaveLength(1);
    expect(chunkWriteKeys[0]).toMatch(/:1$/);
    expect(countersAfter.normalizedPersistCalls).toBe(
      countersBefore.normalizedPersistCalls
    );
    expect(countersAfter.committedCheckpointWrites).toBe(
      countersBefore.committedCheckpointWrites + 1
    );
    expect(
      countersAfter.routeChunkPointsSanitized -
      countersBefore.routeChunkPointsSanitized
    ).toBe(((points.length % service.ACTIVE_RUN_ROUTE_CHUNK_SIZE) + 1) * 2);
  });

  test("indice de chunks incoerente nao semeia cache incremental", async () => {
    const points = Array.from({ length: 260 }, (_, index) => nextPoint(index + 1));
    await service.hydrateActiveRunSnapshot({
      activeRunId: "run-inconsistent-chunk-index",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: BASE_TIME,
      lastUpdatedAtMs: BASE_TIME + 520_000,
      trustedPath: points,
      rawPath: points,
      segments: [{
        index: 0,
        startedAt: BASE_TIME,
        trustedPath: points,
        rawPath: points,
      }],
    }, { restartTracking: false });

    for (const key of [
      ACTIVE_RUN_STORAGE_KEY,
      service.ACTIVE_RUN_BACKUP_STORAGE_KEY,
    ]) {
      const envelope = JSON.parse(storage.get(key));
      envelope.routeChunksIndex.chunks[0].closed = false;
      storage.set(key, JSON.stringify(envelope));
    }

    service.__resetActiveRunRuntimeForTests();
    AsyncStorageMock.setItem.mockClear();
    const restored = await service.restoreActiveRun({ restartTracking: false });
    const chunkWriteKeys = AsyncStorageMock.setItem.mock.calls
      .map(([key]) => key)
      .filter((key) => key.includes(":routeChunk:"));

    expect(restored.trustedPath).toHaveLength(260);
    expect(chunkWriteKeys).toHaveLength(2);
  });

  test("deduplica o mesmo ponto vindo do watcher e da task background", async () => {
    await service.startActiveRun({
      activeRunId: "run-cross-source-dedup",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    const duplicate = nextPoint(1);
    await service.recordLocation(duplicate, { source: "foreground" });
    await service.handleActiveRunLocationTask({
      data: {
        locations: [{ coords: duplicate, timestamp: duplicate.timestamp }],
      },
    });

    const snapshot = await service.getActiveRunSnapshot();
    expect(snapshot.trustedPath).toHaveLength(1);
    expect(snapshot.rawPath).toHaveLength(1);
  });

  test("task headless recupera storage e persiste lote sem MapScreen montado", async () => {
    await service.startActiveRun({
      activeRunId: "run-headless-recovery",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    service.__resetActiveRunRuntimeForTests();
    await service.restoreActiveRun({ restartTracking: false });
    await expect(service.startBackgroundLocationUpdates({
      expectedRunId: "run-headless-recovery",
      reason: "headless_process_recovery_claim",
      ownerClaim: {
        mode: "process_recovery",
        reason: "canonical_snapshot_revalidated",
      },
    })).resolves.toBe(true);

    await expect(backgroundTaskHandler({
      data: {
        locations: [
          { coords: nextPoint(1), timestamp: nextPoint(1).timestamp },
          { coords: nextPoint(2), timestamp: nextPoint(2).timestamp },
        ],
      },
    })).resolves.toMatchObject({
      activeRunId: "run-headless-recovery",
      source: "background",
    });

    service.__resetActiveRunRuntimeForTests();
    const restored = await service.restoreActiveRun({ restartTracking: false });
    expect(restored.trustedPath).toHaveLength(2);
  });

  test("task headless trata snapshot canonico e backup corrompidos sem derrubar", async () => {
    storage.set(ACTIVE_RUN_STORAGE_KEY, "{broken-current");
    storage.set(service.ACTIVE_RUN_BACKUP_STORAGE_KEY, "{broken-backup");
    service.__resetActiveRunRuntimeForTests();

    await expect(backgroundTaskHandler({
      data: {
        locations: [{ coords: nextPoint(1), timestamp: nextPoint(1).timestamp }],
      },
    })).resolves.toBeNull();
    expect(storage.has(service.ACTIVE_RUN_CORRUPT_STORAGE_KEY)).toBe(true);
  });

  test("estado FINISHING e persistido e impede nova corrida silenciosa", async () => {
    await service.startActiveRun({
      activeRunId: "run-finishing-protected",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    const finishing = await service.markActiveRunFinishing({ nowMs: BASE_TIME + 5000 });

    expect(finishing.status).toBe(ACTIVE_RUN_STATUS.FINISHING);
    expect(getStoredActiveRun().status).toBe(ACTIVE_RUN_STATUS.FINISHING);
    expect(finishing.recoveryPending).toBe(true);

    const protectedSnapshot = await service.startActiveRun({
      activeRunId: "run-should-not-replace",
      userId: "user-1",
      startedAtMs: BASE_TIME + 10_000,
    });
    expect(protectedSnapshot.activeRunId).toBe("run-finishing-protected");
  });

  test("finalizar durante pausa acumula a pausa aberta antes de congelar o tempo", async () => {
    await service.startActiveRun({
      activeRunId: "run-finish-while-paused",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.pauseActiveRun({ endedAtMs: BASE_TIME + 10_000 });

    const finishing = await service.markActiveRunFinishing({
      nowMs: BASE_TIME + 70_000,
      reason: "test_finish_while_paused",
    });
    const finished = await service.finishActiveRun({
      finishedAtMs: BASE_TIME + 70_000,
    });

    expect(finishing).toMatchObject({
      status: ACTIVE_RUN_STATUS.FINISHING,
      pausedDurationMs: 60_000,
      totalPausedMs: 60_000,
    });
    expect(finished.durationSeconds).toBe(10);
    expect(finished.totalPausedMs).toBe(60_000);
  });

  test("snapshot FINISHED sem save confirmado impede nova corrida silenciosa", async () => {
    await service.startActiveRun({
      activeRunId: "run-finished-protected",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
    await service.finishActiveRun({ finishedAtMs: BASE_TIME + 5000 });

    const protectedSnapshot = await service.startActiveRun({
      activeRunId: "run-new-before-history-save",
      userId: "user-1",
      startedAtMs: BASE_TIME + 10_000,
    });

    expect(protectedSnapshot.activeRunId).toBe("run-finished-protected");
    expect(protectedSnapshot.status).toBe(ACTIVE_RUN_STATUS.FINISHED);
    expect(protectedSnapshot.meta.protectedFromReplace).toBe(true);
    expect(getStoredActiveRun().activeRunId).toBe("run-finished-protected");
  });
});
