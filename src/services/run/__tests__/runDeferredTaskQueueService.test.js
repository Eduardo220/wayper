import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
let activeSnapshot = null;
let runtimeStatus = {};
const localRuns = new Map();

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

const fetchNetInfo = jest.fn(async () => ({
  isConnected: true,
  isInternetReachable: true,
}));
const netInfoAddEventListener = jest.fn(() => jest.fn());
const appStateAddEventListener = jest.fn(() => ({ remove: jest.fn() }));
const recordRunEvent = jest.fn();
const recordRunSnapshotEvent = jest.fn();
const loggerWarn = jest.fn();
const findLocalRunById = jest.fn(async (lookup = {}) => {
  const ids = [
    lookup.id,
    lookup.localRunId,
    lookup.runId,
    lookup.remoteRunId,
  ].filter(Boolean).map(String);
  return ids.map((id) => localRuns.get(id)).find(Boolean) || null;
});
const loadLocalRuns = jest.fn(async () => Array.from(new Set(localRuns.values())));
const saveLocalRun = jest.fn(async (run = {}) => {
  const saved = {
    ...run,
    id: run.id || run.localRunId,
    localRunId: run.localRunId || run.id,
  };
  [saved.id, saved.localRunId, saved.runId, saved.remoteRunId]
    .filter(Boolean)
    .forEach((id) => localRuns.set(String(id), saved));
  return saved;
});
const scheduleRunsSync = jest.fn();
const syncRunsToFirestore = jest.fn(async () => ({ synced: 1, failed: 0 }));
const addXpFromRun = jest.fn(async () => ({ applied: true }));
const listTerritories = jest.fn(async () => ({ data: [] }));
const processRunTerritoryCapture = jest.fn(async () => ({
  ok: true,
  capturedAreaM2: 120,
  capturedTerritory: { id: "territory-run", areaM2: 120, coordsPreview: [] },
}));
const listRanking = jest.fn(async () => ({ data: [], source: "local" }));
const loadSocialHome = jest.fn(async () => ({ feedItems: [], stories: [], source: "local" }));

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
}));

jest.unstable_mockModule("@react-native-community/netinfo", () => ({
  default: {
    fetch: fetchNetInfo,
    addEventListener: netInfoAddEventListener,
  },
}));

jest.unstable_mockModule("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: appStateAddEventListener,
  },
}));

jest.unstable_mockModule("../../../utils/logger.js", () => ({
  default: {
    warn: loggerWarn,
    info: jest.fn(),
    debug: jest.fn(),
  },
  LOG_CATEGORIES: {
    RUN_SESSION: "RUN_SESSION",
    SYNC: "SYNC",
  },
  sanitizeLogContext: (value) => value,
}));

jest.unstable_mockModule("../../diagnostics/runDiagnosticsService.js", () => ({
  recordRunEvent,
  recordRunSnapshotEvent,
}));

jest.unstable_mockModule("../../runTracking/activeRunTrackingService.js", () => ({
  default: {
    getActiveRunSnapshot: jest.fn(async () => activeSnapshot),
    getTrackingRuntimeStatus: jest.fn(() => runtimeStatus),
  },
}));

jest.unstable_mockModule("../../../utils/sync.js", () => ({
  findLocalRunById,
  loadLocalRuns,
  saveLocalRun,
  scheduleRunsSync,
  syncRunsToFirestore,
}));

jest.unstable_mockModule("../../../repositories/progressionRepository.js", () => ({
  addXpFromRun,
}));

jest.unstable_mockModule("../../../repositories/territoryRepository.js", () => ({
  list: listTerritories,
}));

jest.unstable_mockModule("../../territory/index.js", () => ({
  processRunTerritoryCapture,
}));

jest.unstable_mockModule("../../../firebaseConfig.js", () => ({
  auth: {
    currentUser: {
      uid: "user-1",
      displayName: "Runner",
      photoURL: null,
    },
  },
}));

jest.unstable_mockModule("../../../repositories/rankingRepository.js", () => ({
  listRanking,
}));

jest.unstable_mockModule("../../../repositories/socialHomeRepository.js", () => ({
  loadSocialHome,
}));

const queue = await import("../runDeferredTaskQueueService.js");

const {
  RUN_DEFERRED_TASK_QUEUE_KEY,
  RUN_DEFERRED_TASK_STATUS,
  RUN_DEFERRED_TASK_TYPE,
  EXPEDITION_PROCESSING_STATUS,
  __resetRunDeferredTaskQueueForTests,
  enqueueDefaultPostRunTasks,
  enqueueRunDeferredTasks,
  getRunExpeditionProcessingState,
  loadRunDeferredTasks,
  processRunDeferredTaskQueue,
  reconcilePendingRunExpeditionProcessing,
  recoverStaleRunDeferredTasks,
} = queue;

function makeRun(overrides = {}) {
  return {
    id: "run-1",
    localRunId: "run-1",
    userId: "user-1",
    mode: "free",
    distanceMeters: 1000,
    durationSeconds: 360,
    finishedAt: "2026-06-21T12:00:00.000Z",
    ...overrides,
  };
}

async function replaceStoredTasks(producer) {
  const tasks = JSON.parse(storage.get(RUN_DEFERRED_TASK_QUEUE_KEY) || "[]");
  storage.set(RUN_DEFERRED_TASK_QUEUE_KEY, JSON.stringify(producer(tasks)));
}

describe("runDeferredTaskQueueService", () => {
  beforeEach(async () => {
    activeSnapshot = null;
    runtimeStatus = {};
    localRuns.clear();
    storage.clear();
    jest.clearAllMocks();
    syncRunsToFirestore.mockResolvedValue({ synced: 1, failed: 0 });
    loadLocalRuns.mockImplementation(async () => Array.from(new Set(localRuns.values())));
    addXpFromRun.mockResolvedValue({ applied: true });
    listTerritories.mockResolvedValue({ data: [] });
    processRunTerritoryCapture.mockResolvedValue({
      ok: true,
      capturedAreaM2: 120,
      capturedTerritory: { id: "territory-run", areaM2: 120, coordsPreview: [] },
    });
    await __resetRunDeferredTaskQueueForTests();
  });

  test("enfileira tarefas padrao sem persistir rota bruta no payload", async () => {
    const result = await enqueueDefaultPostRunTasks(makeRun({
      id: "run-route",
      localRunId: "run-route",
      mode: "zones",
      rawPath: [{ latitude: -30, longitude: -51 }],
      trustedPath: [{ latitude: -30, longitude: -51 }],
      routeSegments: [{ trustedPath: [{ latitude: -30, longitude: -51 }] }],
    }), { includeTerritory: true, source: "test" });

    expect(result.queued.map((task) => task.type)).toEqual(expect.arrayContaining([
      RUN_DEFERRED_TASK_TYPE.RUN_FULL_SAVE_FINALIZE,
      RUN_DEFERRED_TASK_TYPE.RUN_TERRITORY_CAPTURE,
      RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE,
      RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC,
      RUN_DEFERRED_TASK_TYPE.RUN_RANKING_UPDATE,
      RUN_DEFERRED_TASK_TYPE.RUN_FEED_UPDATE,
      RUN_DEFERRED_TASK_TYPE.RUN_DIAGNOSTIC_FULL_EXPORT_READY,
      RUN_DEFERRED_TASK_TYPE.RUN_CLEANUP_TEMP_FILES,
    ]));
    const raw = storage.get(RUN_DEFERRED_TASK_QUEUE_KEY);
    expect(raw).not.toContain("trustedPath");
    expect(raw).not.toContain("rawPath");
    expect(raw).not.toContain("routeSegments");
  });

  test("recupera tarefa que ficou running apos restart", async () => {
    await enqueueRunDeferredTasks({
      type: RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE,
      runId: "run-stale",
      status: RUN_DEFERRED_TASK_STATUS.RUNNING,
      lastStartedAt: "2026-06-21T10:00:00.000Z",
    });

    const result = await recoverStaleRunDeferredTasks({
      nowMs: Date.parse("2026-06-21T10:02:00.000Z"),
      force: true,
      trigger: "test",
    });

    expect(result.recovered).toHaveLength(1);
    expect(result.recovered[0].status).toBe(RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE);
    expect(recordRunEvent).toHaveBeenCalledWith("RUN_DEFERRED_QUEUE_RECOVERED_ON_BOOT", expect.objectContaining({
      count: 1,
    }));
  });

  test("nao processa fila enquanto existe corrida ativa", async () => {
    activeSnapshot = { activeRunId: "run-live", status: "RUNNING" };
    await enqueueRunDeferredTasks({
      type: RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC,
      runId: "run-pending",
    });

    const result = await processRunDeferredTaskQueue({ trigger: "test" });

    expect(result).toMatchObject({ skipped: true, reason: "active_run" });
    expect(syncRunsToFirestore).not.toHaveBeenCalled();
  });

  test("marca XP ja processado como sucesso idempotente", async () => {
    localRuns.set("run-xp", makeRun({ id: "run-xp", localRunId: "run-xp" }));
    addXpFromRun.mockResolvedValue({ applied: false, reason: "already_processed" });
    await enqueueRunDeferredTasks({
      type: RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE,
      runId: "run-xp",
    });

    const result = await processRunDeferredTaskQueue({ trigger: "test", ignoreActiveRun: true });
    const tasks = await loadRunDeferredTasks();

    expect(result.processed).toHaveLength(1);
    expect(tasks[0].status).toBe(RUN_DEFERRED_TASK_STATUS.SUCCEEDED);
    expect(recordRunEvent).toHaveBeenCalledWith("RUN_DEFERRED_TASK_ALREADY_DONE", expect.objectContaining({
      type: RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE,
      reason: "xp_already_processed",
    }));
  });

  test("falha offline de sync fica retryable com proxima tentativa", async () => {
    localRuns.set("run-sync", makeRun({ id: "run-sync", localRunId: "run-sync", pendingSync: true }));
    syncRunsToFirestore.mockResolvedValue({ offline: true });
    await enqueueRunDeferredTasks({
      type: RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC,
      runId: "run-sync",
    });

    const result = await processRunDeferredTaskQueue({ trigger: "test", ignoreActiveRun: true });
    const tasks = await loadRunDeferredTasks();

    expect(result.failed).toHaveLength(1);
    expect(tasks[0].status).toBe(RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE);
    expect(tasks[0].lastError.code).toBe("offline");
    expect(Date.parse(tasks[0].nextRunAt)).not.toBeNaN();
  });

  test("captura territorial nao aplicavel vira falha permanente com corrida salva", async () => {
    localRuns.set("run-territory", makeRun({
      id: "run-territory",
      localRunId: "run-territory",
      mode: "zones",
      path: [{ latitude: -30, longitude: -51 }],
    }));
    processRunTerritoryCapture.mockResolvedValue({ ok: false, reason: "not_enough_points" });
    await enqueueRunDeferredTasks({
      type: RUN_DEFERRED_TASK_TYPE.RUN_TERRITORY_CAPTURE,
      runId: "run-territory",
    });

    await processRunDeferredTaskQueue({ trigger: "test", ignoreActiveRun: true });
    const tasks = await loadRunDeferredTasks();

    expect(tasks[0].status).toBe(RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT);
    expect(tasks[0].lastError.reason).toBe("not_enough_points");
    expect(tasks[0].result.run).toEqual(expect.objectContaining({
      runId: "run-territory",
      territoryCaptureStatus: "FAILED",
    }));
    expect(tasks[0].result.run.path).toBeUndefined();
    expect(tasks[0].metadata.lastResult).toBeUndefined();
    expect(saveLocalRun).toHaveBeenCalledWith(expect.objectContaining({
      territoryCaptureStatus: "FAILED",
      territoryCaptureFailedReason: "not_enough_points",
      pendingSync: true,
    }));
  });

  test("tarefa de retry reativa falhas retryable do mesmo run", async () => {
    await enqueueRunDeferredTasks([
      {
        type: RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC,
        runId: "run-retry",
      },
      {
        type: RUN_DEFERRED_TASK_TYPE.RUN_RETRY_FAILED_PROCESSING,
        runId: "run-retry",
        priority: 5,
      },
    ]);
    await replaceStoredTasks((tasks) => tasks.map((task) =>
      task.type === RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC
        ? {
            ...task,
            status: RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE,
            nextRunAt: "2099-01-01T00:00:00.000Z",
            lastError: { message: "offline", code: "offline" },
          }
        : task
    ));

    await processRunDeferredTaskQueue({ trigger: "test", ignoreActiveRun: true, limit: 1 });
    const tasks = await loadRunDeferredTasks();
    const remoteSyncTask = tasks.find((task) => task.type === RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC);
    const retryTask = tasks.find((task) => task.type === RUN_DEFERRED_TASK_TYPE.RUN_RETRY_FAILED_PROCESSING);

    expect(remoteSyncTask.status).toBe(RUN_DEFERRED_TASK_STATUS.PENDING);
    expect(Date.parse(remoteSyncTask.nextRunAt)).toBeLessThan(Date.parse("2099-01-01T00:00:00.000Z"));
    expect(retryTask.status).toBe(RUN_DEFERRED_TASK_STATUS.SUCCEEDED);
  });

  test("persiste resultados por modulo e materializa Expedicao pronta", async () => {
    const run = makeRun({
      id: "run-expedition-ready",
      localRunId: "run-expedition-ready",
      remoteRunId: "remote-expedition-ready",
      minimumSavedRunVersion: 1,
      expeditionProcessingStatus: "PENDING",
    });
    localRuns.set(run.id, run);
    localRuns.set(run.remoteRunId, run);
    await enqueueDefaultPostRunTasks(run, { source: "test" });

    await processRunDeferredTaskQueue({
      trigger: "test",
      ignoreActiveRun: true,
      runId: run.id,
      limit: 8,
    });
    const tasks = await loadRunDeferredTasks();
    const rankingTask = tasks.find(
      (task) => task.type === RUN_DEFERRED_TASK_TYPE.RUN_RANKING_UPDATE
    );
    const state = await getRunExpeditionProcessingState(run.id);
    const stateByRemoteId = await getRunExpeditionProcessingState(run.remoteRunId);
    const persistedRun = localRuns.get(run.id);

    expect(rankingTask.result).toEqual(expect.objectContaining({
      runId: run.id,
    }));
    expect(state.overallStatus).toBe("ready");
    expect(stateByRemoteId).toMatchObject({
      runId: run.localRunId,
      overallStatus: "ready",
    });
    expect(state.modules.metrics.status).toBe(EXPEDITION_PROCESSING_STATUS.READY);
    expect(state.modules.progression.status).toBe(EXPEDITION_PROCESSING_STATUS.READY);
    expect(state.modules.ranking.status).toBe(EXPEDITION_PROCESSING_STATUS.READY);
    expect(state.modules.sync.status).toBe(EXPEDITION_PROCESSING_STATUS.READY);
    expect(state.modules.territory.status).toBe(
      EXPEDITION_PROCESSING_STATUS.NOT_APPLICABLE
    );
    expect(persistedRun.expeditionProcessingStatus).toBe("READY");
    expect(persistedRun.expeditionProcessing.modules.ranking.status).toBe("ready");
  });

  test("resultado parcial preserva falha retryable sem bloquear outros modulos", async () => {
    const run = makeRun({
      id: "run-expedition-partial",
      localRunId: "run-expedition-partial",
      minimumSavedRunVersion: 1,
      expeditionProcessingStatus: "PENDING",
    });
    localRuns.set(run.id, run);
    syncRunsToFirestore.mockResolvedValue({ offline: true });
    await enqueueDefaultPostRunTasks(run, { source: "test" });

    await processRunDeferredTaskQueue({
      trigger: "test",
      ignoreActiveRun: true,
      runId: run.id,
      limit: 8,
    });
    const state = await getRunExpeditionProcessingState(run.id);

    expect(state.overallStatus).toBe("partial");
    expect(state.modules.metrics.status).toBe(EXPEDITION_PROCESSING_STATUS.READY);
    expect(state.modules.progression.status).toBe(EXPEDITION_PROCESSING_STATUS.READY);
    expect(state.modules.sync.status).toBe(
      EXPEDITION_PROCESSING_STATUS.FAILED_RETRYABLE
    );
  });

  test("reconcilia semente salva quando o app reinicia antes do enqueue", async () => {
    const run = makeRun({
      id: "run-reconcile",
      localRunId: "run-reconcile",
      minimumSavedRunVersion: 1,
      minimumSavedAt: "2026-07-24T12:00:00.000Z",
      expeditionProcessingStatus: "PENDING",
      expeditionProcessing: {
        schemaVersion: 1,
        status: "pending",
      },
    });
    localRuns.set(run.id, run);

    const result = await reconcilePendingRunExpeditionProcessing({
      source: "test_restart",
    });
    const tasks = await loadRunDeferredTasks();

    expect(result.reconciled).toHaveLength(1);
    expect(tasks.map((task) => task.type)).toEqual(expect.arrayContaining([
      RUN_DEFERRED_TASK_TYPE.RUN_FULL_SAVE_FINALIZE,
      RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE,
      RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC,
      RUN_DEFERRED_TASK_TYPE.RUN_RANKING_UPDATE,
      RUN_DEFERRED_TASK_TYPE.RUN_FEED_UPDATE,
    ]));
    expect(recordRunEvent).toHaveBeenCalledWith(
      "RUN_EXPEDITION_PROCESSING_RECONCILED",
      expect.objectContaining({ count: 1 })
    );
  });
});
