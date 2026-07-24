import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const recordRunEvent = jest.fn();
const recordRunSnapshotEvent = jest.fn();

jest.unstable_mockModule("../../diagnostics/runDiagnosticsService.js", () => ({
  recordRunEvent,
  recordRunSnapshotEvent,
}));

const finalization = await import("../runFinalizationService.js");

const {
  RUN_MINIMUM_SAVE_SCHEMA_VERSION,
  buildMinimumSavedRun,
  resolveFinalRunTiming,
  freezeActiveRunForFinalization,
  persistMinimumFinishedRun,
  enqueuePostRunProcessing,
  __resetRunFinalizationForTests,
} = finalization;

function makeRun(overrides = {}) {
  return {
    id: "run-1",
    localRunId: "run-1",
    userId: "user-1",
    status: "completed",
    mode: "free",
    distanceMeters: 1250,
    durationSeconds: 420,
    finishedAt: "2026-07-24T12:00:00.000Z",
    trustedPath: [
      { latitude: -30, longitude: -51, timestamp: 1 },
      { latitude: -30.001, longitude: -51.001, timestamp: 2 },
    ],
    segments: [],
    ...overrides,
  };
}

function makePersistenceDependencies(overrides = {}) {
  const order = [];
  const dependencies = {
    findLocalRunById: jest.fn(async () => null),
    persistFinishedRunDraft: jest.fn(async (run) => {
      order.push("draft");
      return run;
    }),
    saveLocalRun: jest.fn(async (run) => {
      order.push("save");
      return run;
    }),
    scheduleRunsSync: jest.fn(() => {
      order.push("schedule_sync");
    }),
    markRecoveredRunLocallySaved: jest.fn(async () => {
      order.push("cleanup");
      return { ok: true };
    }),
    ...overrides,
  };
  return { dependencies, order };
}

describe("runFinalizationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetRunFinalizationForTests();
  });

  test("formaliza o registro minimo com semente persistente da Expedicao", () => {
    const result = buildMinimumSavedRun(makeRun(), {
      preparedAt: "2026-07-24T12:00:01.000Z",
    });

    expect(result).toMatchObject({
      id: "run-1",
      localRunId: "run-1",
      status: "completed",
      synced: false,
      pendingSync: true,
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      minimumSavedRunVersion: RUN_MINIMUM_SAVE_SCHEMA_VERSION,
      minimumSavedAt: "2026-07-24T12:00:01.000Z",
      finalizationStatus: "MINIMUM_SAVED",
      expeditionProcessingStatus: "PENDING",
      expeditionProcessing: {
        schemaVersion: 1,
        runId: "run-1",
        status: "pending",
      },
    });
  });

  test("injeta usuario conhecido ao formalizar corrida offline sem userId", () => {
    const result = buildMinimumSavedRun(makeRun({ userId: undefined }), {
      userId: "user-from-session",
      preparedAt: "2026-07-24T12:00:01.000Z",
    });

    expect(result.userId).toBe("user-from-session");
  });

  test("calcula duracao final descontando pausa mesmo com UI inflada", () => {
    const startedAtMs = 1_700_000_000_000;
    const result = resolveFinalRunTiming({
      startedAtMs,
      finishedAt: new Date(startedAtMs + 120_000).toISOString(),
      totalPausedMs: 60_000,
      durationSeconds: 120,
      trustedPath: [
        { timestamp: startedAtMs },
        { timestamp: new Date(startedAtMs + 60_000).toISOString() },
      ],
      segments: [{
        startedAt: startedAtMs,
        endedAt: startedAtMs + 60_000,
        endReason: "pause",
      }],
    }, {
      uiDurationMs: 120_000,
    });

    expect(result).toMatchObject({
      durationMs: 60_000,
      durationSeconds: 60,
      totalPausedMs: 60_000,
      pausedDurationSeconds: 60,
      usedPauseTimeline: true,
    });
  });

  test("sem evidencia de pausa preserva o maior fallback seguro de duracao", () => {
    const startedAtMs = 1_700_000_000_000;
    const result = resolveFinalRunTiming({
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAtMs: startedAtMs + 70_000,
      durationSeconds: 65,
      trustedPath: [{ timestamp: startedAtMs + 60_000 }],
    }, {
      uiDurationMs: 80_000,
    });

    expect(result.durationSeconds).toBe(80);
    expect(result.usedPauseTimeline).toBe(false);
  });

  test("confirma save antes de limpar a corrida ativa", async () => {
    const { dependencies, order } = makePersistenceDependencies();

    const result = await persistMinimumFinishedRun(makeRun(), {
      ...dependencies,
      preparedAt: "2026-07-24T12:00:01.000Z",
      timeouts: {
        LOCAL_SAVE_MS: 1000,
        CLEANUP_MS: 1000,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.savedLocalRun.minimumSavedRunVersion).toBe(1);
    expect(order.indexOf("save")).toBeLessThan(order.indexOf("cleanup"));
    expect(dependencies.persistFinishedRunDraft).not.toHaveBeenCalled();
    expect(dependencies.markRecoveredRunLocallySaved).toHaveBeenCalledTimes(1);
    expect(dependencies.markRecoveredRunLocallySaved).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRunId: "run-1",
      })
    );
    expect(recordRunEvent).toHaveBeenCalledWith(
      "RUN_FINISH_LOCAL_MIN_SAVE_COMPLETED",
      expect.objectContaining({ runId: "run-1" })
    );
  });

  test("nao limpa snapshot quando o save minimo falha", async () => {
    const saveError = new Error("storage unavailable");
    const { dependencies } = makePersistenceDependencies({
      saveLocalRun: jest.fn(async () => {
        throw saveError;
      }),
    });

    await expect(persistMinimumFinishedRun(makeRun(), {
      ...dependencies,
      timeouts: { LOCAL_SAVE_MS: 1000 },
    })).rejects.toMatchObject({
      code: "RUN_MINIMUM_SAVE_FAILED",
      recoverable: true,
    });

    expect(dependencies.markRecoveredRunLocallySaved).not.toHaveBeenCalled();
    expect(dependencies.persistFinishedRunDraft).toHaveBeenCalledTimes(1);
  });

  test("rascunho recuperavel so e gravado como fallback do historico", async () => {
    const returnedWithoutIdentity = {
      id: "fallback-generated-id",
      status: "completed",
      finishedAt: "2026-07-24T12:00:00.000Z",
    };
    const { dependencies, order } = makePersistenceDependencies({
      saveLocalRun: jest.fn(async () => {
        order.push("save");
        return returnedWithoutIdentity;
      }),
    });

    await expect(persistMinimumFinishedRun(makeRun(), {
      ...dependencies,
      timeouts: {
        LOCAL_SAVE_MS: 1000,
        DRAFT_SAVE_MS: 1000,
      },
    })).rejects.toMatchObject({
      code: "RUN_MINIMUM_SAVE_NOT_CONFIRMED",
    });

    expect(order).toEqual(["save", "draft"]);
    expect(dependencies.markRecoveredRunLocallySaved).not.toHaveBeenCalled();
  });

  test("deduplica finalizacoes concorrentes no servico, sem depender da tela", async () => {
    let releaseSave;
    const saveGate = new Promise((resolve) => {
      releaseSave = resolve;
    });
    const { dependencies } = makePersistenceDependencies({
      saveLocalRun: jest.fn(async (run) => {
        await saveGate;
        return run;
      }),
    });
    const options = {
      ...dependencies,
      timeouts: { LOCAL_SAVE_MS: 1000, CLEANUP_MS: 1000 },
    };

    const first = persistMinimumFinishedRun(makeRun(), options);
    const second = persistMinimumFinishedRun(makeRun(), options);
    expect(second).toBe(first);
    releaseSave();
    const [left, right] = await Promise.all([first, second]);

    expect(left.savedLocalRun.id).toBe("run-1");
    expect(right.savedLocalRun.id).toBe("run-1");
    expect(dependencies.saveLocalRun).toHaveBeenCalledTimes(1);
    expect(dependencies.markRecoveredRunLocallySaved).toHaveBeenCalledTimes(1);
  });

  test("forceWrite permite atualizar detalhes de corrida ja salva", async () => {
    const existing = buildMinimumSavedRun(makeRun({ title: "Antes" }), {
      preparedAt: "2026-07-24T12:00:01.000Z",
    });
    const { dependencies } = makePersistenceDependencies({
      findLocalRunById: jest.fn(async () => existing),
    });

    const result = await persistMinimumFinishedRun(makeRun({ title: "Depois" }), {
      ...dependencies,
      forceWrite: true,
      timeouts: { LOCAL_SAVE_MS: 1000, CLEANUP_MS: 1000 },
    });

    expect(result.alreadySaved).toBe(false);
    expect(dependencies.saveLocalRun).toHaveBeenCalledTimes(1);
    expect(dependencies.saveLocalRun).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Depois" })
    );
  });

  test("reentrada com minimo ja confirmado nao regrava a corrida", async () => {
    const existing = buildMinimumSavedRun(makeRun(), {
      preparedAt: "2026-07-24T12:00:01.000Z",
    });
    const { dependencies } = makePersistenceDependencies({
      findLocalRunById: jest.fn(async () => existing),
    });

    const result = await persistMinimumFinishedRun(makeRun(), {
      ...dependencies,
      timeouts: { CLEANUP_MS: 1000 },
    });

    expect(result.alreadySaved).toBe(true);
    expect(dependencies.persistFinishedRunDraft).not.toHaveBeenCalled();
    expect(dependencies.saveLocalRun).not.toHaveBeenCalled();
    expect(dependencies.markRecoveredRunLocallySaved).toHaveBeenCalledTimes(1);
  });

  test("congela checkpoint e snapshot fora do ciclo de vida da UI", async () => {
    const order = [];
    const snapshot = { activeRunId: "run-freeze", status: "FINISHED" };
    const trackingService = {
      markActiveRunFinishing: jest.fn(async () => {
        order.push("mark_finishing");
      }),
      finishActiveRun: jest.fn(async () => {
        order.push("finish_snapshot");
        return snapshot;
      }),
      getActiveRunSnapshot: jest.fn(async () => snapshot),
    };
    const flushCheckpoint = jest.fn(async () => {
      order.push("checkpoint");
    });

    const result = await freezeActiveRunForFinalization({
      runId: "run-freeze",
      finishedAtMs: 1000,
      trackingService,
      flushCheckpoint,
      timeouts: {
        CHECKPOINT_MS: 1000,
        SNAPSHOT_MS: 1000,
      },
    });

    expect(result.snapshot).toBe(snapshot);
    expect(order).toEqual(["mark_finishing", "checkpoint", "finish_snapshot"]);
  });

  test("enqueue derivado e falha neutra ficam fora do save minimo", async () => {
    const queueRepository = {
      enqueuePostRun: jest.fn(async () => ({
        data: { queued: [{ runId: "run-1", type: "RUN_XP_UPDATE" }] },
        queueStatus: "queued",
        error: null,
      })),
    };

    const success = await enqueuePostRunProcessing(makeRun(), {
      queueRepository,
      timeouts: { QUEUE_MS: 1000 },
    });
    expect(success).toMatchObject({ ok: true, runId: "run-1" });

    queueRepository.enqueuePostRun.mockRejectedValueOnce(new Error("queue unavailable"));
    const failure = await enqueuePostRunProcessing(makeRun({ id: "run-2", localRunId: "run-2" }), {
      queueRepository,
      timeouts: { QUEUE_MS: 1000 },
    });
    expect(failure.ok).toBe(false);
    expect(failure.queued).toEqual([]);
  });
});
