import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const BASE_TIME = 1_700_000_000_000;

let currentSnapshot = null;
const snapshotListeners = new Set();
const errorListeners = new Set();

const activeRunTrackingService = {
  getActiveRunSnapshot: jest.fn(async () => currentSnapshot),
  onActiveRunSnapshot: jest.fn((callback) => {
    snapshotListeners.add(callback);
    return () => snapshotListeners.delete(callback);
  }),
  onActiveRunError: jest.fn((callback) => {
    errorListeners.add(callback);
    return () => errorListeners.delete(callback);
  }),
};

const NetInfoMock = {
  fetch: jest.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
  })),
};

const saveActiveRunSnapshot = jest.fn(async (checkpoint) => checkpoint);

const ACTIVE_RUN_STATUS = {
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  FINISHED: "FINISHED",
  PENDING_SYNC: "PENDING_SYNC",
  SYNC_FAILED: "SYNC_FAILED",
};

const ACTIVE_RUN_SYNC_STATUS = {
  LOCAL_ONLY: "LOCAL_ONLY",
  PENDING: "PENDING",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
};

jest.unstable_mockModule("@react-native-community/netinfo", () => ({
  default: NetInfoMock,
}));

jest.unstable_mockModule("../../runTracking/activeRunTrackingService.js", () => ({
  default: activeRunTrackingService,
  ...activeRunTrackingService,
}));

jest.unstable_mockModule("../../runOfflineStorageService.js", () => ({
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_SYNC_STATUS,
  saveActiveRunSnapshot,
  toAppRunMode: (mode = "free") => (mode === "territory" ? "zones" : "free"),
}));

const {
  buildOfflineCheckpointFromTrackingSnapshot,
  checkpointOnLocationError,
  forceCheckpointForAppState,
  startActiveRunAutoCheckpointing,
  stopActiveRunAutoCheckpointing,
} = await import("../runAutoSaveService.js");

function iso(ms) {
  return new Date(ms).toISOString();
}

function makeSnapshot(overrides = {}) {
  return {
    activeRunId: "run-autosave",
    localRunId: "run-autosave",
    userId: "user-1",
    mode: "free",
    status: "RUNNING",
    startedAtMs: BASE_TIME,
    startedAt: iso(BASE_TIME),
    lastUpdatedAtMs: BASE_TIME,
    lastUpdatedAt: iso(BASE_TIME),
    trustedPath: [
      { latitude: -23.56, longitude: -46.64, timestamp: BASE_TIME },
    ],
    rawPath: [
      { latitude: -23.56, longitude: -46.64, timestamp: BASE_TIME },
    ],
    renderPath: [
      { latitude: -23.56, longitude: -46.64, timestamp: BASE_TIME },
    ],
    segments: [
      { index: 0, startedAt: iso(BASE_TIME), trustedPath: [] },
    ],
    distanceMeters: 12,
    ...overrides,
  };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe("runAutoSaveService", () => {
  beforeEach(() => {
    currentSnapshot = makeSnapshot();
    snapshotListeners.clear();
    errorListeners.clear();
    jest.clearAllMocks();
    stopActiveRunAutoCheckpointing();
  });

  afterEach(() => {
    stopActiveRunAutoCheckpointing();
    jest.useRealTimers();
  });

  test("checkpoint periodico atualiza o mesmo estado ativo com duracao viva", async () => {
    jest.useFakeTimers({ now: BASE_TIME + 5000 });
    startActiveRunAutoCheckpointing({
      minIntervalMs: 0,
      periodicIntervalMs: 1000,
    });

    await jest.advanceTimersByTimeAsync(1000);

    expect(saveActiveRunSnapshot).toHaveBeenCalledTimes(1);
    expect(saveActiveRunSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      localRunId: "run-autosave",
      checkpointAtMs: BASE_TIME + 6000,
      durationMs: 6000,
      status: ACTIVE_RUN_STATUS.RUNNING,
    }));
  });

  test("checkpoint de erro de localizacao e limitado para nao escrever em excesso", async () => {
    jest.useFakeTimers({ now: BASE_TIME + 1000 });

    await checkpointOnLocationError(new Error("gps unavailable"), {
      minIntervalMs: 10000,
    });
    await checkpointOnLocationError(new Error("gps unavailable"), {
      minIntervalMs: 10000,
    });

    expect(saveActiveRunSnapshot).toHaveBeenCalledTimes(1);

    jest.setSystemTime(BASE_TIME + 12000);
    await checkpointOnLocationError(new Error("gps unavailable"), {
      minIntervalMs: 10000,
    });

    expect(saveActiveRunSnapshot).toHaveBeenCalledTimes(2);
  });

  test("erro emitido pelo tracking gera checkpoint consolidado", async () => {
    startActiveRunAutoCheckpointing({
      minIntervalMs: 0,
      periodicIntervalMs: 0,
    });

    const listener = Array.from(errorListeners)[0];
    listener?.({
      error: new Error("record location failed"),
      context: { fn: "recordLocation" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveActiveRunSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      localRunId: "run-autosave",
      appState: null,
    }));
  });

  test("AppState background e inactive gravam checkpoints explicitos", async () => {
    await forceCheckpointForAppState("background");
    await forceCheckpointForAppState("inactive");

    expect(saveActiveRunSnapshot).toHaveBeenCalledTimes(2);
    expect(saveActiveRunSnapshot.mock.calls[0][0]).toMatchObject({
      localRunId: "run-autosave",
      appState: "background",
    });
    expect(saveActiveRunSnapshot.mock.calls[1][0]).toMatchObject({
      localRunId: "run-autosave",
      appState: "inactive",
    });
  });

  test("cleanup remove listeners e timer para evitar subscriptions duplicadas", async () => {
    jest.useFakeTimers({ now: BASE_TIME });
    startActiveRunAutoCheckpointing({
      minIntervalMs: 0,
      periodicIntervalMs: 1000,
    });

    expect(snapshotListeners.size).toBe(1);
    expect(errorListeners.size).toBe(1);

    stopActiveRunAutoCheckpointing();
    await jest.advanceTimersByTimeAsync(2000);

    expect(snapshotListeners.size).toBe(0);
    expect(errorListeners.size).toBe(0);
    expect(saveActiveRunSnapshot).not.toHaveBeenCalled();
  });

  test("evento emitido pela propria persistencia nao cria ciclo de autosave", async () => {
    startActiveRunAutoCheckpointing({
      minIntervalMs: 0,
      periodicIntervalMs: 0,
    });
    saveActiveRunSnapshot.mockImplementationOnce(async (checkpoint) => {
      snapshotListeners.forEach((listener) => listener({
        event: "run_checkpoint_saved",
        snapshot: currentSnapshot,
      }));
      return checkpoint;
    });

    snapshotListeners.forEach((listener) => listener({
      event: "run_started",
      snapshot: currentSnapshot,
    }));
    await flushPromises();

    expect(saveActiveRunSnapshot).toHaveBeenCalledTimes(1);
  });

  test("snapshot finishing vira rascunho finalizado, nao checkpoint running", () => {
    const checkpoint = buildOfflineCheckpointFromTrackingSnapshot(makeSnapshot({
      status: "FINISHING",
    }), {
      checkpointAtMs: BASE_TIME + 3000,
    });

    expect(checkpoint.status).toBe(ACTIVE_RUN_STATUS.FINISHED);
    expect(checkpoint.localRunId).toBe("run-autosave");
  });

  test("checkpoint periodico nao regrava snapshot terminal como corrida ativa", async () => {
    currentSnapshot = makeSnapshot({
      status: "FINISHED",
      finishedAtMs: BASE_TIME + 12_000,
      finishedAt: iso(BASE_TIME + 12_000),
    });
    jest.useFakeTimers({ now: BASE_TIME + 15_000 });

    startActiveRunAutoCheckpointing({
      minIntervalMs: 0,
      periodicIntervalMs: 1000,
    });
    await jest.advanceTimersByTimeAsync(1000);

    expect(saveActiveRunSnapshot).not.toHaveBeenCalled();
  });
});
