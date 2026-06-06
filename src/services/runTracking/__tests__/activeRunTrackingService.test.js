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

jest.unstable_mockModule("react-native", () => ({
  NativeModules: {},
  Platform: {
    OS: "android",
    Version: 33,
  },
}));

jest.unstable_mockModule("expo-location", () => LocationMock);

jest.unstable_mockModule("expo-task-manager", () => TaskManagerMock);

const service = await import("../activeRunTrackingService.js");
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

beforeEach(async () => {
  storage.clear();
  locationStarted = false;
  jest.clearAllMocks();
  TaskManagerMock.isTaskDefined.mockReturnValue(false);
  service.__resetActiveRunRuntimeForTests();
  await clearLogs();
});

describe("activeRunTrackingService lifecycle", () => {
  test("persiste snapshot local ao iniciar e a cada ponto aceito", async () => {
    const started = await service.startActiveRun({
      activeRunId: "run-local-snapshot",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });

    expect(started.status).toBe(ACTIVE_RUN_STATUS.RUNNING);
    expect(storage.has(ACTIVE_RUN_STORAGE_KEY)).toBe(true);

    const updated = await service.recordLocation(nextPoint(1), { source: "foreground" });
    const raw = JSON.parse(storage.get(ACTIVE_RUN_STORAGE_KEY));

    expect(updated.activeRunId).toBe("run-local-snapshot");
    expect(raw.activeRunId).toBe("run-local-snapshot");
    expect(raw.trustedPath.length).toBeGreaterThanOrEqual(1);
  });

  test("ponto em background atualiza o snapshot canonico sem duplicar watcher", async () => {
    await service.startActiveRun({
      activeRunId: "run-background-point",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);

    const updated = await service.recordLocation(nextPoint(1), { source: "background" });
    const raw = JSON.parse(storage.get(ACTIVE_RUN_STORAGE_KEY));

    expect(updated.activeRunId).toBe("run-background-point");
    expect(updated.source).toBe("background");
    expect(raw.activeRunId).toBe("run-background-point");
    expect(raw.source).toBe("background");
    expect(raw.trustedPath.length).toBeGreaterThanOrEqual(1);
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

    const raw = JSON.parse(storage.get(ACTIVE_RUN_STORAGE_KEY));
    expect(raw.activeRunId).toBe("run-background-ordered");
    expect(raw.trustedPath.map((point) => point.timestamp)).toEqual([
      BASE_TIME + 2000,
      BASE_TIME + 4000,
    ]);
    expect(raw.trustedPath).toHaveLength(2);
  });

  test("ponto recebido em background durante PAUSED nao soma distancia", async () => {
    await service.startActiveRun({
      activeRunId: "run-paused-background",
      userId: "user-1",
      startedAtMs: BASE_TIME,
    });
    await service.recordLocation(nextPoint(1), { source: "foreground" });
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
});
