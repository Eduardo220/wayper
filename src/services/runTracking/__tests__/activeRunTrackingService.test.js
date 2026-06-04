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

jest.unstable_mockModule("expo-task-manager", () => ({
  isTaskDefined: jest.fn(() => false),
  defineTask: jest.fn(),
}));

const service = await import("../activeRunTrackingService.js");
const {
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_STORAGE_KEY,
} = await import("../activeRunState.js");

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

beforeEach(() => {
  storage.clear();
  locationStarted = false;
  jest.clearAllMocks();
  service.__resetActiveRunRuntimeForTests();
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
  });
});
