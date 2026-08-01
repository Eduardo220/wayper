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

const service = await import("../activeRunTrackingService.js");
const { ACTIVE_RUN_STATUS } = await import("../activeRunState.js");

const BASE_TIME = 1_700_000_000_000;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settlesWithin(promise, timeoutMs = 250) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`promise did not settle within ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitFor(predicate, timeoutMs = 250) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`condition did not become true within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function lifecycleStatus() {
  return service.getTrackingRuntimeStatus().backgroundLifecycle;
}

async function startRun(runId = "run-lifecycle-a") {
  const snapshot = await service.startActiveRun({
    activeRunId: runId,
    userId: "user-lifecycle",
    startedAtMs: BASE_TIME,
    replaceExisting: true,
  });
  await service.__flushActiveRunBackgroundLifecycleForTests();
  return snapshot;
}

async function prepareStoppedRun(runId = "run-lifecycle-a") {
  await startRun(runId);
  await expect(service.stopBackgroundLocationUpdates({
    expectedRunId: runId,
    reason: "test_prepare_stopped",
  })).resolves.toBe(true);
  return service.getActiveRunSnapshot();
}

beforeEach(() => {
  storage.clear();
  locationStarted = false;
  jest.clearAllMocks();
  AsyncStorageMock.getItem.mockImplementation(
    async (key) => storage.get(key) ?? null
  );
  AsyncStorageMock.setItem.mockImplementation(async (key, value) => {
    storage.set(key, value);
  });
  AsyncStorageMock.removeItem.mockImplementation(async (key) => {
    storage.delete(key);
  });
  LocationMock.hasStartedLocationUpdatesAsync.mockImplementation(
    async () => locationStarted
  );
  LocationMock.startLocationUpdatesAsync.mockImplementation(async () => {
    locationStarted = true;
  });
  LocationMock.stopLocationUpdatesAsync.mockImplementation(async () => {
    locationStarted = false;
  });
  service.__setActiveRunStorageForTests(AsyncStorageMock);
  service.__resetActiveRunRuntimeForTests();
});

afterEach(() => {
  service.__resetActiveRunRuntimeForTests();
});

describe("native lifecycle liveness contract", () => {
  test("01 start resolve e publica owner e generation confirmados", async () => {
    await startRun("run-start-resolves");

    expect(lifecycleStatus()).toMatchObject({
      state: "ACTIVE",
      ownerRunId: "run-start-resolves",
      reconciliationRequired: false,
      logicalQueueReleased: true,
    });
    expect(lifecycleStatus().generation).toBeGreaterThan(0);
    expect(lifecycleStatus().nativeGeneration).toBeGreaterThan(0);
  });

  test("02 rejeicao de start termina como falha recuperavel", async () => {
    await prepareStoppedRun("run-start-rejects");
    LocationMock.startLocationUpdatesAsync.mockRejectedValueOnce(
      new Error("native start rejected")
    );

    await expect(service.startBackgroundLocationUpdates({
      expectedRunId: "run-start-rejects",
      reason: "test_reject",
    })).resolves.toBe(false);
    await service.__flushActiveRunBackgroundLifecycleForTests();

    expect(lifecycleStatus()).toMatchObject({
      state: "FAILED_RECOVERABLE",
      logicalQueueReleased: true,
      lastOperation: { outcome: "start_failed", result: false },
    });
  });

  test("03 start nativo que nunca resolve nao prende o caller", async () => {
    await prepareStoppedRun("run-start-never-resolves");
    const stopCallsBefore = LocationMock.stopLocationUpdatesAsync.mock.calls.length;
    const nativeStart = deferred();
    LocationMock.startLocationUpdatesAsync.mockImplementationOnce(
      () => nativeStart.promise
    );

    try {
      await expect(service.startBackgroundLocationUpdates({
        expectedRunId: "run-start-never-resolves",
        callerTimeoutMs: 5,
      })).resolves.toBe(false);
      expect(lifecycleStatus()).toMatchObject({
        state: "FAILED_RECOVERABLE",
        reconciliationRequired: true,
        logicalQueueReleased: true,
        pendingNativeOperation: { type: "start", outcome: "timeout" },
      });
    } finally {
      nativeStart.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
      expect(locationStarted).toBe(false);
      expect(LocationMock.stopLocationUpdatesAsync).toHaveBeenCalledTimes(
        stopCallsBefore + 1
      );
    }
  });

  test("04 timeout possui outcome explicito para o caller", async () => {
    await prepareStoppedRun("run-caller-timeout");
    const nativeProbe = deferred();
    LocationMock.hasStartedLocationUpdatesAsync.mockImplementationOnce(
      () => nativeProbe.promise
    );

    try {
      const result = await settlesWithin(
        service.startBackgroundLocationUpdates({
          expectedRunId: "run-caller-timeout",
          callerTimeoutMs: 5,
        })
      );
      expect(result).toBe(false);
      expect(lifecycleStatus().lastOperation).toMatchObject({
        type: "start",
        outcome: "timeout",
        timedOut: true,
      });
    } finally {
      nativeProbe.resolve(false);
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
    }

    const publicProbe = deferred();
    const probeCallsBefore =
      LocationMock.hasStartedLocationUpdatesAsync.mock.calls.length;
    LocationMock.hasStartedLocationUpdatesAsync.mockImplementationOnce(
      () => publicProbe.promise
    );
    try {
      const results = await Promise.all([
        service.getBackgroundLocationTaskStatus({ timeoutMs: 5 }),
        service.getBackgroundLocationTaskStatus({ timeoutMs: 5 }),
        service.getBackgroundLocationTaskStatus({ timeoutMs: 5 }),
      ]);
      expect(results.map((entry) => entry.status)).toEqual([
        "probe_timeout",
        "probe_timeout",
        "probe_timeout",
      ]);
      await expect(service.getBackgroundLocationTaskStatus({ timeoutMs: 5 }))
        .resolves.toMatchObject({ status: "probe_timeout" });
      expect(LocationMock.hasStartedLocationUpdatesAsync).toHaveBeenCalledTimes(
        probeCallsBefore + 1
      );
      expect(lifecycleStatus().statusProbe).toMatchObject({
        timedOut: true,
        operationId: expect.any(Number),
      });
    } finally {
      publicProbe.resolve(false);
      await waitFor(() => lifecycleStatus().statusProbe == null);
    }
  });

  test("04b timeout de probe antigo nao rebaixa lifecycle novo", async () => {
    await prepareStoppedRun("run-stale-status-probe");
    const publicProbe = deferred();
    LocationMock.hasStartedLocationUpdatesAsync.mockImplementationOnce(
      () => publicProbe.promise
    );

    const staleProbeResult = service.getBackgroundLocationTaskStatus({
      timeoutMs: 25,
    });
    await waitFor(() => lifecycleStatus().statusProbe != null);

    try {
      await expect(service.startBackgroundLocationUpdates({
        expectedRunId: "run-stale-status-probe",
        callerTimeoutMs: 100,
      })).resolves.toBe(true);
      expect(lifecycleStatus()).toMatchObject({
        state: "ACTIVE",
        ownerRunId: "run-stale-status-probe",
        reconciliationRequired: false,
      });

      await expect(staleProbeResult).resolves.toMatchObject({
        status: "probe_stale",
        started: true,
      });
      expect(lifecycleStatus()).toMatchObject({
        state: "ACTIVE",
        ownerRunId: "run-stale-status-probe",
        reconciliationRequired: false,
      });
    } finally {
      publicProbe.resolve(false);
      await waitFor(() => lifecycleStatus().statusProbe == null);
    }
  });

  test("04c probe iniciado durante stop nao restaura status antigo", async () => {
    await startRun("run-probe-during-stop");
    const nativeStop = deferred();
    LocationMock.stopLocationUpdatesAsync.mockImplementationOnce(async () => {
      await nativeStop.promise;
      locationStarted = false;
    });

    const stopResult = service.stopBackgroundLocationUpdates({
      expectedRunId: "run-probe-during-stop",
      callerTimeoutMs: 100,
    });
    await waitFor(() => lifecycleStatus().state === "STOPPING");
    await waitFor(() => LocationMock.stopLocationUpdatesAsync.mock.calls.length > 0);

    const publicProbe = deferred();
    LocationMock.hasStartedLocationUpdatesAsync.mockImplementationOnce(
      () => publicProbe.promise
    );
    const staleProbeResult = service.getBackgroundLocationTaskStatus({
      timeoutMs: 100,
    });
    expect(lifecycleStatus().statusProbe).toMatchObject({
      lifecycleOperationId: expect.any(Number),
    });

    nativeStop.resolve();
    await expect(stopResult).resolves.toBe(true);
    expect(lifecycleStatus()).toMatchObject({
      state: "IDLE",
      ownerRunId: null,
      reconciliationRequired: false,
    });

    publicProbe.resolve(true);
    await expect(staleProbeResult).resolves.toMatchObject({
      status: "probe_stale",
      started: false,
    });
    expect(service.getTrackingRuntimeStatus()).toMatchObject({
      backgroundStarted: false,
      backgroundTaskStatus: "stopped",
      backgroundLifecycle: {
        state: "IDLE",
        ownerRunId: null,
        reconciliationRequired: false,
      },
    });
  });

  test("04d probe ativo sem owner exige reconciliacao explicita", async () => {
    await startRun("run-probe-owner-unknown");
    service.__resetActiveRunRuntimeForTests();
    expect(locationStarted).toBe(true);

    await expect(service.getBackgroundLocationTaskStatus()).resolves.toMatchObject({
      started: true,
      status: "started_reconciliation_required",
    });
    expect(lifecycleStatus()).toMatchObject({
      state: "FAILED_RECOVERABLE",
      ownerRunId: null,
      reconciliationRequired: true,
    });
  });

  test("04e probe parado com owner preserva identidade e exige reconciliacao", async () => {
    await startRun("run-probe-owner-retained");
    LocationMock.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(false);

    await expect(service.getBackgroundLocationTaskStatus()).resolves.toMatchObject({
      started: false,
      status: "stopped_reconciliation_required",
    });
    expect(lifecycleStatus()).toMatchObject({
      state: "FAILED_RECOVERABLE",
      ownerRunId: "run-probe-owner-retained",
      reconciliationRequired: true,
    });
  });

  test("04f probe ativo com owner confirmado preserva estado consistente", async () => {
    await startRun("run-probe-owner-consistent");

    await expect(service.getBackgroundLocationTaskStatus()).resolves.toMatchObject({
      started: true,
      status: "started",
    });
    expect(lifecycleStatus()).toMatchObject({
      state: "ACTIVE",
      ownerRunId: "run-probe-owner-consistent",
      reconciliationRequired: false,
    });
  });

  test("04g probe parado sem owner preserva estado consistente", async () => {
    await prepareStoppedRun("run-probe-stopped-consistent");

    await expect(service.getBackgroundLocationTaskStatus()).resolves.toMatchObject({
      started: false,
      status: "stopped",
    });
    expect(lifecycleStatus()).toMatchObject({
      state: "IDLE",
      ownerRunId: null,
      reconciliationRequired: false,
    });
  });

  test("04h probe ativo detecta owner diferente do target atual", async () => {
    await startRun("run-probe-target-a");
    await service.startActiveRun({
      activeRunId: "run-probe-target-b",
      userId: "user-lifecycle",
      startedAtMs: BASE_TIME + 1000,
      replaceExisting: true,
    });
    await service.__flushActiveRunBackgroundLifecycleForTests();

    expect(lifecycleStatus()).toMatchObject({
      state: "FAILED_RECOVERABLE",
      ownerRunId: "run-probe-target-a",
      reconciliationRequired: true,
      lastOperation: { outcome: "owner_target_mismatch" },
    });

    await expect(service.getBackgroundLocationTaskStatus()).resolves.toMatchObject({
      started: true,
      status: "started_reconciliation_required",
    });
    await expect(service.getActiveRunSnapshot()).resolves.toMatchObject({
      activeRunId: "run-probe-target-b",
    });
    expect(lifecycleStatus()).toMatchObject({
      state: "FAILED_RECOVERABLE",
      ownerRunId: "run-probe-target-a",
      reconciliationRequired: true,
    });
  });

  test("05 operacao posterior executa sem aguardar Promise antiga", async () => {
    await prepareStoppedRun("run-operation-after-timeout");
    LocationMock.stopLocationUpdatesAsync.mockClear();
    const nativeStart = deferred();
    LocationMock.startLocationUpdatesAsync.mockImplementationOnce(
      () => nativeStart.promise
    );

    try {
      await service.startBackgroundLocationUpdates({
        expectedRunId: "run-operation-after-timeout",
        callerTimeoutMs: 5,
      });
      const timedOutOperationId = lifecycleStatus().lastOperation.operationId;

      await expect(settlesWithin(service.stopBackgroundLocationUpdates({
        expectedRunId: "run-operation-after-timeout",
        callerTimeoutMs: 1000,
      }))).resolves.toBe(false);

      expect(lifecycleStatus().lastOperation).toMatchObject({
        type: "stop",
        outcome: "reconciliation_required",
      });
      expect(lifecycleStatus().lastOperation.operationId)
        .toBeGreaterThan(timedOutOperationId);
      expect(LocationMock.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    } finally {
      nativeStart.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
    }
  });

  test("06 rejeicao nao envenena a fila", async () => {
    await prepareStoppedRun("run-rejection-liveness");
    LocationMock.startLocationUpdatesAsync
      .mockRejectedValueOnce(new Error("first start failed"))
      .mockImplementationOnce(async () => {
        locationStarted = true;
      });

    await expect(service.startBackgroundLocationUpdates({
      expectedRunId: "run-rejection-liveness",
    })).resolves.toBe(false);
    await expect(service.startBackgroundLocationUpdates({
      expectedRunId: "run-rejection-liveness",
    })).resolves.toBe(true);

    expect(lifecycleStatus()).toMatchObject({
      state: "ACTIVE",
      ownerRunId: "run-rejection-liveness",
      logicalQueueReleased: true,
    });
  });

  test("07 timeout nao envenena a tail logica", async () => {
    await prepareStoppedRun("run-timeout-liveness");
    const nativeStart = deferred();
    LocationMock.startLocationUpdatesAsync.mockImplementationOnce(
      () => nativeStart.promise
    );

    try {
      await service.startBackgroundLocationUpdates({
        expectedRunId: "run-timeout-liveness",
        callerTimeoutMs: 5,
      });
      await expect(settlesWithin(service.startBackgroundLocationUpdates({
        expectedRunId: "run-timeout-liveness",
        callerTimeoutMs: 1000,
      }))).resolves.toBe(false);
      expect(lifecycleStatus()).toMatchObject({
        logicalQueueReleased: true,
        lastOperation: { outcome: "reconciliation_required" },
      });
      expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(2);
    } finally {
      nativeStart.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
    }
  });

  test("08 owner igual converge de forma idempotente", async () => {
    await startRun("run-same-owner");
    const callsBefore = LocationMock.startLocationUpdatesAsync.mock.calls.length;

    await expect(service.startBackgroundLocationUpdates({
      expectedRunId: "run-same-owner-alias",
      activeRunId: "run-same-owner",
      localRunId: "run-same-owner-alias",
      reason: "idempotent_reentry",
    })).resolves.toBe(true);

    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(
      callsBefore
    );
    expect(lifecycleStatus()).toMatchObject({
      ownerRunId: "run-same-owner",
      lastOperation: { outcome: "already_active" },
    });
  });

  test("09 owner divergente nao e adotado silenciosamente", async () => {
    await startRun("run-owner-a");

    await expect(service.startBackgroundLocationUpdates({
      expectedRunId: "run-owner-b",
      reason: "invalid_owner_claim",
    })).resolves.toBe(false);

    expect(lifecycleStatus()).toMatchObject({
      ownerRunId: "run-owner-a",
      lastOperation: { outcome: "owner_mismatch" },
    });
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  test("10 handoff ativo e rejeitado", async () => {
    await startRun("run-handoff-a");

    await expect(service.startBackgroundLocationUpdates({
      expectedRunId: "run-handoff-b",
      reason: "explicit_handoff_attempt",
      handoff: {
        from: "run-handoff-a",
        to: "run-handoff-b",
      },
    })).resolves.toBe(false);

    expect(lifecycleStatus()).toMatchObject({
      state: "ACTIVE",
      ownerRunId: "run-handoff-a",
      lastOperation: { outcome: "owner_mismatch" },
    });
  });

  test("11 novo owner so assume depois de stop confirmado", async () => {
    await startRun("run-handoff-confirmed-a");
    const generationA = lifecycleStatus().nativeGeneration;
    service.__resetActiveRunRuntimeForTests();
    await service.restoreActiveRun({ restartTracking: false });
    const startCallsBeforeClaim =
      LocationMock.startLocationUpdatesAsync.mock.calls.length;
    const stopCallsBeforeClaim =
      LocationMock.stopLocationUpdatesAsync.mock.calls.length;

    await expect(service.startBackgroundLocationUpdates({
      expectedRunId: "run-handoff-confirmed-a",
      reason: "implicit_process_recovery_claim_rejected",
    })).resolves.toBe(false);
    expect(lifecycleStatus()).toMatchObject({
      ownerRunId: null,
      reconciliationRequired: true,
      lastOperation: { outcome: "owner_unknown" },
    });
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(
      startCallsBeforeClaim
    );
    expect(LocationMock.stopLocationUpdatesAsync).toHaveBeenCalledTimes(
      stopCallsBeforeClaim
    );

    await expect(service.startBackgroundLocationUpdates({
      expectedRunId: "run-handoff-confirmed-a",
      reason: "explicit_process_recovery_claim",
      ownerClaim: {
        mode: "process_recovery",
        reason: "canonical_snapshot_revalidated",
      },
    })).resolves.toBe(true);
    expect(lifecycleStatus().lastOperation.outcome)
      .toBe("owner_claimed_explicitly");

    await service.stopBackgroundLocationUpdates({
      expectedRunId: "run-handoff-confirmed-a",
      reason: "handoff_release",
    });

    await startRun("run-handoff-confirmed-b");

    expect(lifecycleStatus()).toMatchObject({
      state: "ACTIVE",
      ownerRunId: "run-handoff-confirmed-b",
      reconciliationRequired: false,
    });
    expect(lifecycleStatus().nativeGeneration).toBeGreaterThan(generationA);
  });

  test("11b target alterado durante probe permite liberar owner retido", async () => {
    await startRun("run-probe-inflight-a");
    const nativeProbe = deferred();
    const probeCallsBefore =
      LocationMock.hasStartedLocationUpdatesAsync.mock.calls.length;
    LocationMock.hasStartedLocationUpdatesAsync.mockImplementationOnce(
      () => nativeProbe.promise
    );
    let latestRunId = null;
    const unsubscribe = service.onActiveRunSnapshot(({ snapshot }) => {
      latestRunId = snapshot?.activeRunId || null;
    });

    const startA = service.startBackgroundLocationUpdates({
      expectedRunId: "run-probe-inflight-a",
      callerTimeoutMs: 1000,
    });
    await waitFor(
      () => LocationMock.hasStartedLocationUpdatesAsync.mock.calls.length >
        probeCallsBefore
    );
    const startB = service.startActiveRun({
      activeRunId: "run-probe-inflight-b",
      userId: "user-lifecycle",
      startedAtMs: BASE_TIME + 1000,
      replaceExisting: true,
    });

    try {
      await waitFor(() => latestRunId === "run-probe-inflight-b");
      nativeProbe.resolve(true);
      await expect(startA).resolves.toBe(false);
      await expect(startB).resolves.toMatchObject({
        activeRunId: "run-probe-inflight-b",
      });
      await service.__flushActiveRunBackgroundLifecycleForTests();
      expect(lifecycleStatus()).toMatchObject({
        state: "FAILED_RECOVERABLE",
        ownerRunId: "run-probe-inflight-a",
        reconciliationRequired: true,
      });

      await expect(service.stopBackgroundLocationUpdates({
        expectedRunId: "run-probe-inflight-a",
        reason: "release_retained_native_owner",
      })).resolves.toBe(true);
      expect(lifecycleStatus()).toMatchObject({
        state: "IDLE",
        ownerRunId: null,
        reconciliationRequired: false,
      });

      await expect(service.startBackgroundLocationUpdates({
        expectedRunId: "run-probe-inflight-b",
      })).resolves.toBe(true);
      expect(lifecycleStatus()).toMatchObject({
        state: "ACTIVE",
        ownerRunId: "run-probe-inflight-b",
        reconciliationRequired: false,
      });
    } finally {
      nativeProbe.resolve(true);
      unsubscribe();
    }
  });

  test("11c probe parado libera owner antes de iniciar o target novo", async () => {
    await startRun("run-probe-stopped-a");
    const nativeProbeA = deferred();
    const nativeProbeB = deferred();
    const probeCallsBefore =
      LocationMock.hasStartedLocationUpdatesAsync.mock.calls.length;
    LocationMock.hasStartedLocationUpdatesAsync
      .mockImplementationOnce(() => nativeProbeA.promise)
      .mockImplementationOnce(() => nativeProbeB.promise);
    let latestRunId = null;
    const unsubscribe = service.onActiveRunSnapshot(({ snapshot }) => {
      latestRunId = snapshot?.activeRunId || null;
    });

    const startA = service.startBackgroundLocationUpdates({
      expectedRunId: "run-probe-stopped-a",
      callerTimeoutMs: 1000,
    });
    await waitFor(
      () => LocationMock.hasStartedLocationUpdatesAsync.mock.calls.length >
        probeCallsBefore
    );
    const startB = service.startActiveRun({
      activeRunId: "run-probe-stopped-b",
      userId: "user-lifecycle",
      startedAtMs: BASE_TIME + 1000,
      replaceExisting: true,
    });

    try {
      await waitFor(() => latestRunId === "run-probe-stopped-b");
      locationStarted = false;
      nativeProbeA.resolve(false);
      await expect(startA).resolves.toBe(false);
      await waitFor(
        () => LocationMock.hasStartedLocationUpdatesAsync.mock.calls.length >
          probeCallsBefore + 1
      );
      expect(lifecycleStatus()).toMatchObject({
        state: "STARTING",
        ownerRunId: null,
        reconciliationRequired: true,
        activeOperation: { ownerRunId: "run-probe-stopped-b" },
      });

      nativeProbeB.resolve(false);
      await expect(startB).resolves.toMatchObject({
        activeRunId: "run-probe-stopped-b",
      });
      await service.__flushActiveRunBackgroundLifecycleForTests();
      expect(lifecycleStatus()).toMatchObject({
        state: "ACTIVE",
        ownerRunId: "run-probe-stopped-b",
        reconciliationRequired: false,
      });
    } finally {
      nativeProbeA.resolve(false);
      nativeProbeB.resolve(false);
      unsubscribe();
    }
  });

  test("12 owner antigo nao controla a nova geracao", async () => {
    await startRun("run-old-owner-a");
    await service.stopBackgroundLocationUpdates({
      expectedRunId: "run-old-owner-a",
    });
    await startRun("run-current-owner-b");
    const stopCallsBefore = LocationMock.stopLocationUpdatesAsync.mock.calls.length;

    await expect(service.stopBackgroundLocationUpdates({
      expectedRunId: "run-old-owner-a",
      reason: "stale_owner_stop",
    })).resolves.toBe(false);

    expect(LocationMock.stopLocationUpdatesAsync).toHaveBeenCalledTimes(
      stopCallsBefore
    );
    expect(lifecycleStatus().ownerRunId).toBe("run-current-owner-b");

    const beforeStalePause = await service.getActiveRunSnapshot();
    await expect(service.pauseActiveRun({
      expectedRunId: "run-old-owner-a",
      endedAtMs: BASE_TIME + 20_000,
    })).resolves.toMatchObject({
      activeRunId: beforeStalePause.activeRunId,
      status: ACTIVE_RUN_STATUS.RUNNING,
      trustedPath: beforeStalePause.trustedPath,
      rawPath: beforeStalePause.rawPath,
    });
    expect(LocationMock.stopLocationUpdatesAsync).toHaveBeenCalledTimes(
      stopCallsBefore
    );

    await service.pauseActiveRun({
      expectedRunId: "run-current-owner-b",
      endedAtMs: BASE_TIME + 21_000,
    });
    const pausedCurrentOwner = await service.getActiveRunSnapshot();
    const startCallsBeforeStaleResume =
      LocationMock.startLocationUpdatesAsync.mock.calls.length;
    await expect(service.resumeActiveRun({
      expectedRunId: "run-old-owner-a",
      startedAtMs: BASE_TIME + 22_000,
    })).resolves.toMatchObject({
      activeRunId: pausedCurrentOwner.activeRunId,
      status: ACTIVE_RUN_STATUS.PAUSED,
      trustedPath: pausedCurrentOwner.trustedPath,
      rawPath: pausedCurrentOwner.rawPath,
    });
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(
      startCallsBeforeStaleResume
    );
  });

  test("13 generation cresce monotonicamente", async () => {
    await startRun("run-generation-monotonic");
    const first = lifecycleStatus().generation;
    await service.startBackgroundLocationUpdates({
      expectedRunId: "run-generation-monotonic",
    });
    const second = lifecycleStatus().generation;
    await service.stopBackgroundLocationUpdates({
      expectedRunId: "run-generation-monotonic",
    });
    const third = lifecycleStatus().generation;

    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
  });

  test("14 generation nao regride apos reset process-local", async () => {
    await startRun("run-generation-reset");
    const beforeReset = lifecycleStatus().generation;

    service.__resetActiveRunRuntimeForTests();

    expect(lifecycleStatus().generation).toBeGreaterThan(beforeReset);
    expect(lifecycleStatus().nativeGeneration).toBe(
      lifecycleStatus().generation
    );
  });

  test("15 callback de generation antiga e ignorado", async () => {
    await startRun("run-old-callback");
    const oldGeneration = lifecycleStatus().nativeGeneration;
    await service.stopBackgroundLocationUpdates({
      expectedRunId: "run-old-callback",
    });
    await service.startBackgroundLocationUpdates({
      expectedRunId: "run-old-callback",
    });
    const before = await service.getActiveRunSnapshot();

    await service.handleActiveRunLocationTask({
      data: {
        lifecycleGeneration: oldGeneration,
        expectedRunId: "run-old-callback",
        locations: [{
          coords: {
            latitude: -23.56,
            longitude: -46.64,
            accuracy: 5,
          },
          timestamp: Date.now(),
        }],
      },
    });
    const after = await service.getActiveRunSnapshot();

    expect(after.trustedPath).toEqual(before.trustedPath);
    expect(after.distanceMeters).toBe(before.distanceMeters);
  });

  test("15b erro de callback antigo nao altera runtime nem notificacao", async () => {
    await startRun("run-old-error-callback");
    const oldGeneration = lifecycleStatus().nativeGeneration;
    const errors = [];
    const unsubscribe = service.onActiveRunError((payload) => {
      errors.push(payload);
    });
    service.setRunRuntimeSurfaceState({
      backgroundTaskStatus: "started",
      notificationStatus: "sentinel_notification",
    });

    try {
      await service.stopBackgroundLocationUpdates({
        expectedRunId: "run-old-error-callback",
      });
      await service.startBackgroundLocationUpdates({
        expectedRunId: "run-old-error-callback",
      });
      expect(lifecycleStatus().nativeGeneration).toBeGreaterThan(oldGeneration);
      const before = service.getTrackingRuntimeStatus();

      await service.handleActiveRunLocationTask({
        data: {
          lifecycleGeneration: oldGeneration,
          expectedRunId: "run-old-error-callback",
        },
        error: new Error("stale background callback error"),
      });

      expect(errors).toEqual([]);
      expect(service.getTrackingRuntimeStatus()).toMatchObject({
        backgroundTaskStatus: before.backgroundTaskStatus,
        notificationStatus: "sentinel_notification",
        backgroundLifecycle: {
          state: "ACTIVE",
          ownerRunId: "run-old-error-callback",
        },
      });
    } finally {
      unsubscribe();
    }
  });

  test("16 stop antigo nao alcanca uma nova geracao", async () => {
    await startRun("run-old-stop");
    const nativeStop = deferred();
    LocationMock.stopLocationUpdatesAsync.mockImplementationOnce(async () => {
      await nativeStop.promise;
      locationStarted = false;
    });

    try {
      await service.stopBackgroundLocationUpdates({
        expectedRunId: "run-old-stop",
        callerTimeoutMs: 5,
      });
      const oldGeneration = lifecycleStatus().lastOperation.generation;
      await expect(service.startBackgroundLocationUpdates({
        expectedRunId: "run-old-stop",
      })).resolves.toBe(false);

      nativeStop.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
      await expect(service.startBackgroundLocationUpdates({
        expectedRunId: "run-old-stop",
      })).resolves.toBe(true);

      expect(lifecycleStatus().nativeGeneration).toBeGreaterThan(oldGeneration);
      expect(lifecycleStatus().ownerRunId).toBe("run-old-stop");
      expect(locationStarted).toBe(true);
    } finally {
      nativeStop.resolve();
    }
  });

  test("17 start tardio antigo nao ativa a sessao atual", async () => {
    await prepareStoppedRun("run-late-start-a");
    const stopCallsBefore = LocationMock.stopLocationUpdatesAsync.mock.calls.length;
    const nativeStart = deferred();
    LocationMock.startLocationUpdatesAsync.mockImplementationOnce(async () => {
      await nativeStart.promise;
      locationStarted = true;
    });

    try {
      await service.startBackgroundLocationUpdates({
        expectedRunId: "run-late-start-a",
        callerTimeoutMs: 5,
      });
      await startRun("run-current-after-late-a");
      nativeStart.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);

      const snapshot = await service.getActiveRunSnapshot();
      expect(snapshot.activeRunId).toBe("run-current-after-late-a");
      expect(lifecycleStatus()).toMatchObject({
        ownerRunId: null,
        reconciliationRequired: true,
      });
      expect(locationStarted).toBe(false);
      expect(LocationMock.stopLocationUpdatesAsync).toHaveBeenCalledTimes(
        stopCallsBefore + 1
      );

      const beforeOwnerlessCallback = await service.getActiveRunSnapshot();
      await service.handleActiveRunLocationTask({
        data: {
          locations: [{
            coords: {
              latitude: -23.56,
              longitude: -46.64,
              accuracy: 5,
            },
            timestamp: Date.now(),
          }],
        },
      });
      const afterOwnerlessCallback = await service.getActiveRunSnapshot();
      expect(afterOwnerlessCallback.trustedPath).toEqual(
        beforeOwnerlessCallback.trustedPath
      );
      expect(afterOwnerlessCallback.rawPath).toEqual(
        beforeOwnerlessCallback.rawPath
      );
    } finally {
      nativeStart.resolve();
    }
  });

  test("17b force restart libera owner se target muda apos stop", async () => {
    await startRun("run-force-restart-a");
    const nativeStop = deferred();
    const stopCallsBefore = LocationMock.stopLocationUpdatesAsync.mock.calls.length;
    LocationMock.stopLocationUpdatesAsync.mockImplementationOnce(async () => {
      await nativeStop.promise;
      locationStarted = false;
    });
    let latestRunId = null;
    const unsubscribe = service.onActiveRunSnapshot(({ snapshot }) => {
      latestRunId = snapshot?.activeRunId || null;
    });

    const forceRestartA = service.startBackgroundLocationUpdates({
      expectedRunId: "run-force-restart-a",
      forceRestart: true,
      callerTimeoutMs: 1000,
    });
    await waitFor(
      () => LocationMock.stopLocationUpdatesAsync.mock.calls.length >
        stopCallsBefore
    );
    const startB = service.startActiveRun({
      activeRunId: "run-force-restart-b",
      userId: "user-lifecycle",
      startedAtMs: BASE_TIME + 1000,
      replaceExisting: true,
    });

    try {
      await waitFor(() => latestRunId === "run-force-restart-b");
      nativeStop.resolve();
      await expect(forceRestartA).resolves.toBe(false);
      await expect(startB).resolves.toMatchObject({
        activeRunId: "run-force-restart-b",
      });
      await service.__flushActiveRunBackgroundLifecycleForTests();
      expect(lifecycleStatus()).toMatchObject({
        state: "ACTIVE",
        ownerRunId: "run-force-restart-b",
        reconciliationRequired: false,
      });
      expect(locationStarted).toBe(true);
    } finally {
      nativeStop.resolve();
      unsubscribe();
    }
  });

  test("17c falha de force restart apos troca de target exige reconciliacao", async () => {
    await startRun("run-force-restart-fail-a");
    const nativeStop = deferred();
    const errors = [];
    const unsubscribeError = service.onActiveRunError((payload) => {
      errors.push(payload);
    });
    let latestRunId = null;
    const unsubscribeSnapshot = service.onActiveRunSnapshot(({ snapshot }) => {
      latestRunId = snapshot?.activeRunId || null;
    });
    LocationMock.stopLocationUpdatesAsync.mockImplementationOnce(async () => {
      await nativeStop.promise;
      throw new Error("forced stop failed after target changed");
    });

    const forceRestartA = service.startBackgroundLocationUpdates({
      expectedRunId: "run-force-restart-fail-a",
      forceRestart: true,
      callerTimeoutMs: 1000,
    });
    await waitFor(() => LocationMock.stopLocationUpdatesAsync.mock.calls.length > 0);
    const startB = service.startActiveRun({
      activeRunId: "run-force-restart-fail-b",
      userId: "user-lifecycle",
      startedAtMs: BASE_TIME + 1000,
      replaceExisting: true,
    });

    try {
      await waitFor(() => latestRunId === "run-force-restart-fail-b");
      nativeStop.resolve();
      await expect(forceRestartA).resolves.toBe(false);
      await expect(startB).resolves.toMatchObject({
        activeRunId: "run-force-restart-fail-b",
      });
      await service.__flushActiveRunBackgroundLifecycleForTests();
      expect(errors).toEqual([]);
      expect(lifecycleStatus()).toMatchObject({
        state: "FAILED_RECOVERABLE",
        ownerRunId: "run-force-restart-fail-a",
        reconciliationRequired: true,
      });

      await expect(service.stopBackgroundLocationUpdates({
        expectedRunId: "run-force-restart-fail-a",
        reason: "reconcile_failed_force_restart",
      })).resolves.toBe(true);
      await expect(service.startBackgroundLocationUpdates({
        expectedRunId: "run-force-restart-fail-b",
      })).resolves.toBe(true);
      expect(lifecycleStatus()).toMatchObject({
        state: "ACTIVE",
        ownerRunId: "run-force-restart-fail-b",
        reconciliationRequired: false,
      });
    } finally {
      nativeStop.resolve();
      unsubscribeError();
      unsubscribeSnapshot();
    }
  });

  test("18 rejeicao tardia de stop nao altera owner nem emite erro atual", async () => {
    await startRun("run-late-stop-owner");
    const nativeStop = deferred();
    const errors = [];
    const unsubscribe = service.onActiveRunError((payload) => {
      errors.push(payload);
    });
    LocationMock.stopLocationUpdatesAsync.mockImplementationOnce(async () => {
      await nativeStop.promise;
      throw new Error("late native stop rejected");
    });

    try {
      await service.stopBackgroundLocationUpdates({
        expectedRunId: "run-late-stop-owner",
        callerTimeoutMs: 5,
      });
      await service.startBackgroundLocationUpdates({
        expectedRunId: "run-late-stop-owner",
      });
      nativeStop.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);

      expect(lifecycleStatus().ownerRunId).toBe("run-late-stop-owner");
      expect(lifecycleStatus().lastLateOutcome).toMatchObject({
        type: "stop",
        status: "resolved",
      });
      expect(errors).toEqual([]);
      expect(locationStarted).toBe(true);
    } finally {
      nativeStop.resolve();
      unsubscribe();
    }
  });

  test("18b stop confirmado libera owner antigo apos troca de target", async () => {
    await startRun("run-stop-handoff-a");
    const nativeStop = deferred();
    const stopCallsBefore = LocationMock.stopLocationUpdatesAsync.mock.calls.length;
    let latestRunId = null;
    const unsubscribe = service.onActiveRunSnapshot(({ snapshot }) => {
      latestRunId = snapshot?.activeRunId || null;
    });
    LocationMock.stopLocationUpdatesAsync.mockImplementationOnce(async () => {
      await nativeStop.promise;
      locationStarted = false;
    });

    try {
      const stopA = service.stopBackgroundLocationUpdates({
        expectedRunId: "run-stop-handoff-a",
        callerTimeoutMs: 1000,
      });
      await waitFor(
        () => LocationMock.stopLocationUpdatesAsync.mock.calls.length >
          stopCallsBefore
      );
      const startB = service.startActiveRun({
        activeRunId: "run-stop-handoff-b",
        userId: "user-lifecycle",
        startedAtMs: BASE_TIME + 1000,
        replaceExisting: true,
      });
      await waitFor(() => latestRunId === "run-stop-handoff-b");
      nativeStop.resolve();

      await expect(stopA).resolves.toBe(true);
      await expect(startB).resolves.toMatchObject({
        activeRunId: "run-stop-handoff-b",
      });
      await service.__flushActiveRunBackgroundLifecycleForTests();
      expect(lifecycleStatus()).toMatchObject({
        state: "ACTIVE",
        ownerRunId: "run-stop-handoff-b",
        reconciliationRequired: false,
      });
      expect(locationStarted).toBe(true);
    } finally {
      nativeStop.resolve();
      unsubscribe();
    }
  });

  test("18c falha de stop apos troca de target nao atinge listeners novos", async () => {
    await startRun("run-stop-target-a");
    const nativeStop = deferred();
    const errors = [];
    let latestRunId = null;
    const unsubscribeError = service.onActiveRunError((payload) => {
      errors.push(payload);
    });
    const unsubscribeSnapshot = service.onActiveRunSnapshot(({ snapshot }) => {
      latestRunId = snapshot?.activeRunId || null;
    });
    LocationMock.stopLocationUpdatesAsync.mockImplementationOnce(async () => {
      await nativeStop.promise;
      throw new Error("old stop rejected after target changed");
    });

    try {
      const stopA = service.stopBackgroundLocationUpdates({
        expectedRunId: "run-stop-target-a",
        callerTimeoutMs: 1000,
      });
      await waitFor(() => LocationMock.stopLocationUpdatesAsync.mock.calls.length >= 1);
      const startB = service.startActiveRun({
        activeRunId: "run-stop-target-b",
        userId: "user-lifecycle",
        startedAtMs: BASE_TIME + 1000,
        replaceExisting: true,
      });
      await waitFor(() => latestRunId === "run-stop-target-b");
      nativeStop.resolve();

      await expect(stopA).resolves.toBe(false);
      await expect(startB).resolves.toMatchObject({
        activeRunId: "run-stop-target-b",
      });
      expect(errors).toEqual([]);
      expect(lifecycleStatus()).toMatchObject({
        ownerRunId: "run-stop-target-a",
        reconciliationRequired: true,
      });
    } finally {
      nativeStop.resolve();
      unsubscribeError();
      unsubscribeSnapshot();
    }
  });

  test("18d stop tardio confirmado libera owner sem atingir target novo", async () => {
    await startRun("run-late-stop-release-a");
    const nativeStop = deferred();
    LocationMock.stopLocationUpdatesAsync.mockImplementationOnce(async () => {
      await nativeStop.promise;
      locationStarted = false;
    });

    try {
      await expect(service.stopBackgroundLocationUpdates({
        expectedRunId: "run-late-stop-release-a",
        callerTimeoutMs: 5,
      })).resolves.toBe(false);
      await expect(service.startActiveRun({
        activeRunId: "run-late-stop-release-b",
        userId: "user-lifecycle",
        startedAtMs: BASE_TIME + 1000,
        replaceExisting: true,
      })).resolves.toMatchObject({
        activeRunId: "run-late-stop-release-b",
      });
      expect(lifecycleStatus()).toMatchObject({
        state: "FAILED_RECOVERABLE",
        ownerRunId: "run-late-stop-release-a",
        reconciliationRequired: true,
        pendingNativeOperation: { type: "stop", timedOut: true },
      });

      nativeStop.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
      expect(lifecycleStatus()).toMatchObject({
        ownerRunId: null,
        reconciliationRequired: true,
      });

      await expect(service.startBackgroundLocationUpdates({
        expectedRunId: "run-late-stop-release-b",
      })).resolves.toBe(true);
      expect(lifecycleStatus()).toMatchObject({
        state: "ACTIVE",
        ownerRunId: "run-late-stop-release-b",
        reconciliationRequired: false,
      });
    } finally {
      nativeStop.resolve();
    }
  });

  test("19 start start concorrentes produzem uma unica chamada nativa", async () => {
    await prepareStoppedRun("run-start-start");
    LocationMock.startLocationUpdatesAsync.mockClear();

    const results = await Promise.all([
      service.startBackgroundLocationUpdates({ expectedRunId: "run-start-start" }),
      service.startBackgroundLocationUpdates({ expectedRunId: "run-start-start" }),
    ]);

    expect(results).toEqual([true, true]);
    expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  test("20 stop stop concorrentes convergem idempotentemente", async () => {
    await startRun("run-stop-stop");
    LocationMock.stopLocationUpdatesAsync.mockClear();

    const results = await Promise.all([
      service.stopBackgroundLocationUpdates({ expectedRunId: "run-stop-stop" }),
      service.stopBackgroundLocationUpdates({ expectedRunId: "run-stop-stop" }),
    ]);

    expect(results).toEqual([true, true]);
    expect(LocationMock.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  test("21 start stop nao sobrepoe operacoes nativas incertas", async () => {
    await prepareStoppedRun("run-start-stop");
    const nativeStart = deferred();
    LocationMock.startLocationUpdatesAsync.mockImplementationOnce(
      () => nativeStart.promise
    );

    try {
      const start = service.startBackgroundLocationUpdates({
        expectedRunId: "run-start-stop",
        callerTimeoutMs: 5,
      });
      await waitFor(() => LocationMock.startLocationUpdatesAsync.mock.calls.length >= 2);
      const stop = service.stopBackgroundLocationUpdates({
        expectedRunId: "run-start-stop",
      });

      await expect(Promise.all([start, stop])).resolves.toEqual([false, false]);
      expect(LocationMock.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    } finally {
      nativeStart.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
    }
  });

  test("22 stop start nao sobrepoe operacoes nativas incertas", async () => {
    await startRun("run-stop-start");
    const nativeStop = deferred();
    LocationMock.stopLocationUpdatesAsync.mockImplementationOnce(
      () => nativeStop.promise
    );
    const startCallsBefore = LocationMock.startLocationUpdatesAsync.mock.calls.length;

    try {
      const stop = service.stopBackgroundLocationUpdates({
        expectedRunId: "run-stop-start",
        callerTimeoutMs: 5,
      });
      await waitFor(() => LocationMock.stopLocationUpdatesAsync.mock.calls.length >= 1);
      const start = service.startBackgroundLocationUpdates({
        expectedRunId: "run-stop-start",
      });

      await expect(Promise.all([stop, start])).resolves.toEqual([false, false]);
      expect(LocationMock.startLocationUpdatesAsync).toHaveBeenCalledTimes(
        startCallsBefore
      );
    } finally {
      nativeStop.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
    }
  });

  test("23 multiplas solicitacoes concorrentes assentam sem crescer a fila", async () => {
    await prepareStoppedRun("run-many-intents");
    const nativeStart = deferred();
    LocationMock.startLocationUpdatesAsync.mockImplementationOnce(
      () => nativeStart.promise
    );

    try {
      const results = await settlesWithin(Promise.all([
        service.startBackgroundLocationUpdates({
          expectedRunId: "run-many-intents",
          callerTimeoutMs: 5,
        }),
        service.stopBackgroundLocationUpdates({ expectedRunId: "run-many-intents" }),
        service.startBackgroundLocationUpdates({ expectedRunId: "run-many-intents" }),
        service.stopBackgroundLocationUpdates({ expectedRunId: "run-many-intents" }),
      ]));

      expect(results).toEqual([false, false, false, false]);
      expect(lifecycleStatus()).toMatchObject({
        logicalQueueReleased: true,
        reconciliationRequired: true,
        activeOperation: null,
        pendingNativeOperation: {
          type: "start",
          operationId: expect.any(Number),
        },
        lastOperation: {
          operationId: expect.any(Number),
        },
      });
    } finally {
      nativeStart.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
    }
  });

  test("24 falha da primeira permite sucesso da segunda", async () => {
    await prepareStoppedRun("run-fail-then-success");
    LocationMock.startLocationUpdatesAsync
      .mockRejectedValueOnce(new Error("first failed"))
      .mockImplementationOnce(async () => {
        locationStarted = true;
      });

    const results = await Promise.all([
      service.startBackgroundLocationUpdates({
        expectedRunId: "run-fail-then-success",
      }),
      service.startBackgroundLocationUpdates({
        expectedRunId: "run-fail-then-success",
      }),
    ]);

    expect(results).toEqual([false, true]);
    expect(lifecycleStatus()).toMatchObject({
      state: "ACTIVE",
      ownerRunId: "run-fail-then-success",
    });
  });

  test("25 falha de start nao aguarda a fila de ingestao", async () => {
    await prepareStoppedRun("run-failure-no-ingestion-cycle");
    const nativeStart = deferred();
    LocationMock.startLocationUpdatesAsync.mockImplementationOnce(
      () => nativeStart.promise
    );

    const start = service.startBackgroundLocationUpdates({
      expectedRunId: "run-failure-no-ingestion-cycle",
      callerTimeoutMs: 1000,
    });
    await waitFor(() => LocationMock.startLocationUpdatesAsync.mock.calls.length >= 2);
    const pause = service.pauseActiveRun({
      expectedRunId: "run-failure-no-ingestion-cycle",
      endedAtMs: BASE_TIME + 10_000,
    });
    nativeStart.reject(new Error("start failed while pause owns ingestion"));

    await expect(settlesWithin(start)).resolves.toBe(false);
    await expect(settlesWithin(pause)).resolves.toMatchObject({
      status: ACTIVE_RUN_STATUS.PAUSED,
    });
  });

  test("26 pause nao forma ciclo com start pendurado", async () => {
    await prepareStoppedRun("run-pause-no-cycle");
    const nativeStart = deferred();
    LocationMock.startLocationUpdatesAsync.mockImplementationOnce(
      () => nativeStart.promise
    );

    try {
      const start = service.startBackgroundLocationUpdates({
        expectedRunId: "run-pause-no-cycle",
        callerTimeoutMs: 5,
      });
      await waitFor(() => LocationMock.startLocationUpdatesAsync.mock.calls.length >= 2);
      const pause = service.pauseActiveRun({
        expectedRunId: "run-pause-no-cycle",
        endedAtMs: BASE_TIME + 10_000,
      });

      await expect(settlesWithin(start)).resolves.toBe(false);
      await expect(settlesWithin(pause)).resolves.toMatchObject({
        status: ACTIVE_RUN_STATUS.PAUSED,
      });
      expect(lifecycleStatus()).toMatchObject({
        state: "FAILED_RECOVERABLE",
        reconciliationRequired: true,
        logicalQueueReleased: true,
      });
    } finally {
      nativeStart.resolve();
      await waitFor(() => lifecycleStatus().pendingNativeOperation == null);
    }
  });

  test("27 GPS continua sendo ingerido durante transicao nativa", async () => {
    await prepareStoppedRun("run-gps-during-transition");
    const nativeStart = deferred();
    LocationMock.startLocationUpdatesAsync.mockImplementationOnce(
      () => nativeStart.promise
    );

    try {
      const start = service.startBackgroundLocationUpdates({
        expectedRunId: "run-gps-during-transition",
        callerTimeoutMs: 1000,
      });
      await waitFor(
        () => LocationMock.startLocationUpdatesAsync.mock.calls.length >= 2
      );
      const point = service.recordLocation({
        latitude: -23.56,
        longitude: -46.64,
        accuracy: 5,
        timestamp: BASE_TIME + 2000,
      }, {
        source: "foreground",
        expectedRunId: "run-gps-during-transition",
      });

      await expect(settlesWithin(point)).resolves.toMatchObject({
        trustedPath: [expect.objectContaining({ timestamp: BASE_TIME + 2000 })],
      });
      nativeStart.resolve();
      await expect(start).resolves.toBe(true);
    } finally {
      nativeStart.resolve();
    }
  });

  test("28 callback real em voo nao muta uma nova generation", async () => {
    await startRun("run-old-ingestion");
    const oldGeneration = lifecycleStatus().nativeGeneration;
    const before = await service.getActiveRunSnapshot();
    const blockedWrite = deferred();
    const writesBefore = AsyncStorageMock.setItem.mock.calls.length;
    AsyncStorageMock.setItem.mockImplementationOnce(async (key, value) => {
      await blockedWrite.promise;
      storage.set(key, value);
    });
    const ingestionBlocker = service.flushPendingActiveRunCheckpoint({
      reason: "block_ingestion_for_callback_fence",
      force: true,
    });
    await waitFor(
      () => AsyncStorageMock.setItem.mock.calls.length > writesBefore
    );

    const callback = service.handleActiveRunLocationTask({
      data: {
        locations: [{
          coords: {
            latitude: -23.56,
            longitude: -46.639,
            accuracy: 4,
          },
          timestamp: Date.now(),
        }],
      },
    });
    try {
      await service.stopBackgroundLocationUpdates({
        expectedRunId: "run-old-ingestion",
      });
      await service.startBackgroundLocationUpdates({
        expectedRunId: "run-old-ingestion",
      });
      expect(lifecycleStatus().nativeGeneration).toBeGreaterThan(oldGeneration);

      blockedWrite.resolve();
      await ingestionBlocker;
      await callback;
      const after = await service.getActiveRunSnapshot();

      expect(after.trustedPath).toEqual(before.trustedPath);
      expect(after.rawPath).toEqual(before.rawPath);
      expect(after.distanceMeters).toBe(before.distanceMeters);
      expect(lifecycleStatus().ownerRunId).toBe("run-old-ingestion");
    } finally {
      blockedWrite.resolve();
      await Promise.allSettled([ingestionBlocker, callback]);
    }
  });
});
