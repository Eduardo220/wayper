import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: jest.fn(async (key) => storage.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      storage.set(key, value);
    }),
    removeItem: jest.fn(async (key) => {
      storage.delete(key);
    }),
  },
}));

let currentSnapshot = null;
const trackingService = {
  getActiveRunSnapshot: jest.fn(async () => currentSnapshot),
  restoreActiveRun: jest.fn(async () => currentSnapshot),
  hydrateActiveRunSnapshot: jest.fn(async (snapshot) => {
    currentSnapshot = snapshot;
    return snapshot;
  }),
  markActiveRunLocallySaved: jest.fn(async () => {
    currentSnapshot = null;
    return true;
  }),
};

jest.unstable_mockModule("../../runTracking/activeRunTrackingService.js", () => ({
  default: trackingService,
  ...trackingService,
}));

const {
  RUN_RECOVERY_SOURCE,
  RUN_RECOVERY_STATUS,
  buildActiveSnapshotFromOfflineRun,
  buildRecoverySummary,
  buildRunDataFromRecoveredRun,
  createRecoveryCandidate,
  findRecoverableRunForUser,
  hydrateRecoverableRunCandidate,
  isLiveRecovery,
  markRecoveredRunLocallySaved,
  normalizeRecoveryStatus,
  resolveRecoveryConflict,
  validateRecoverableRun,
} = await import("../runRecoveryService.js");
const {
  ACTIVE_RUN_STORAGE_KEY,
  ACTIVE_RUN_STATUS,
} = await import("../../runOfflineStorageService.js");

const BASE_RUN = {
  activeRunId: "run-recovery-1",
  userId: "user-1",
  mode: "free",
  status: "RUNNING",
  startedAt: "2026-06-03T10:00:00.000Z",
  lastUpdatedAt: "2026-06-03T10:03:00.000Z",
  durationSeconds: 180,
  distanceMeters: 420,
  trustedPath: [
    { latitude: -23.56, longitude: -46.64, timestamp: 1000 },
    { latitude: -23.5605, longitude: -46.6404, timestamp: 2000 },
  ],
};

describe("runRecoveryService", () => {
  beforeEach(() => {
    storage.clear();
    currentSnapshot = null;
    Object.values(trackingService).forEach((fn) => fn.mockClear?.());
    trackingService.getActiveRunSnapshot.mockImplementation(async () => currentSnapshot);
    trackingService.restoreActiveRun.mockImplementation(async () => currentSnapshot);
    trackingService.hydrateActiveRunSnapshot.mockImplementation(async (snapshot) => {
      currentSnapshot = snapshot;
      return snapshot;
    });
    trackingService.markActiveRunLocallySaved.mockImplementation(async () => {
      currentSnapshot = null;
      return true;
    });
  });

  test("detecta corrida running recuperavel", () => {
    const candidate = createRecoveryCandidate(RUN_RECOVERY_SOURCE.TRACKING, BASE_RUN, {
      userId: "user-1",
    });

    expect(candidate.recoverable).toBe(true);
    expect(candidate.status).toBe(RUN_RECOVERY_STATUS.RUNNING);
    expect(candidate.pointsCount).toBe(2);
    expect(buildRecoverySummary(candidate).distanceMeters).toBe(420);
  });

  test("corrida viva sem ponto aceito ainda e recuperavel pelo snapshot local", () => {
    const candidate = createRecoveryCandidate(
      RUN_RECOVERY_SOURCE.TRACKING,
      {
        activeRunId: "run-sem-ponto-ainda",
        userId: "user-1",
        mode: "free",
        status: "RUNNING",
        startedAt: "2026-06-03T10:00:00.000Z",
        trustedPath: [],
        distanceMeters: 0,
        durationSeconds: 0,
      },
      { userId: "user-1" }
    );

    expect(candidate.recoverable).toBe(true);
    expect(candidate.status).toBe(RUN_RECOVERY_STATUS.RUNNING);
    expect(candidate.pointsCount).toBe(0);
  });

  test("detecta corrida paused recuperavel", () => {
    const candidate = createRecoveryCandidate(
      RUN_RECOVERY_SOURCE.OFFLINE,
      {
        ...BASE_RUN,
        activeRunId: undefined,
        localRunId: "offline-paused",
        status: "PAUSED",
        schemaVersion: 1,
      },
      { userId: "user-1" }
    );

    expect(candidate.recoverable).toBe(true);
    expect(candidate.status).toBe(RUN_RECOVERY_STATUS.PAUSED);
  });

  test("mantem corrida finished pendingSync como recuperavel para sincronizacao", () => {
    const candidate = createRecoveryCandidate(
      RUN_RECOVERY_SOURCE.OFFLINE,
      {
        ...BASE_RUN,
        activeRunId: undefined,
        localRunId: "offline-finished",
        status: "PENDING_SYNC",
        pendingSync: true,
        schemaVersion: 1,
      },
      { userId: "user-1" }
    );

    expect(candidate.recoverable).toBe(true);
    expect(candidate.status).toBe(RUN_RECOVERY_STATUS.PENDING_SYNC);
    expect(candidate.pendingSync).toBe(true);
  });

  test("corrida finishing nao volta como active no recovery", async () => {
    const candidate = createRecoveryCandidate(RUN_RECOVERY_SOURCE.TRACKING, {
      ...BASE_RUN,
      activeRunId: "run-finishing",
      status: "FINISHING",
      finishedAt: null,
    }, { userId: "user-1" });

    expect(normalizeRecoveryStatus("FINISHING")).toBe(RUN_RECOVERY_STATUS.FINISHED);
    expect(candidate.recoverable).toBe(true);
    expect(candidate.status).toBe(RUN_RECOVERY_STATUS.FINISHED);
    expect(isLiveRecovery(candidate)).toBe(false);
    await expect(hydrateRecoverableRunCandidate(candidate, {
      userId: "user-1",
      restartTracking: false,
    })).resolves.toBeNull();
  });

  test("recovery usa estado canonico quando ele e valido", async () => {
    currentSnapshot = {
      ...BASE_RUN,
      activeRunId: "canonical-live",
      lastUpdatedAt: "2026-06-03T10:03:00.000Z",
      trustedPath: BASE_RUN.trustedPath,
      segments: [{ index: 0, startedAt: BASE_RUN.startedAt, trustedPath: BASE_RUN.trustedPath }],
    };
    storage.set(ACTIVE_RUN_STORAGE_KEY, JSON.stringify({
      localRunId: "legacy-live",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAt: BASE_RUN.startedAt,
      updatedAt: "2026-06-03T10:01:00.000Z",
      points: BASE_RUN.trustedPath.slice(0, 1),
      schemaVersion: 1,
    }));

    const recovery = await findRecoverableRunForUser("user-1");

    expect(recovery.source).toBe(RUN_RECOVERY_SOURCE.TRACKING);
    expect(recovery.id).toBe("canonical-live");
  });

  test("recovery migra legado vivo quando so legado existe", async () => {
    const legacyRun = {
      localRunId: "legacy-paused",
      userId: "user-1",
      mode: "territory",
      status: ACTIVE_RUN_STATUS.PAUSED,
      startedAt: BASE_RUN.startedAt,
      updatedAt: BASE_RUN.lastUpdatedAt,
      durationMs: 180000,
      distanceMeters: 420,
      points: BASE_RUN.trustedPath,
      rawPoints: BASE_RUN.trustedPath.concat({ latitude: -23.561, longitude: -46.641, timestamp: 3000 }),
      segments: [
        { index: 0, startedAt: BASE_RUN.startedAt, endedAt: BASE_RUN.lastUpdatedAt, reason: "START" },
      ],
      syncStatus: "LOCAL_ONLY",
      schemaVersion: 1,
    };
    storage.set(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(legacyRun));

    const recovery = await findRecoverableRunForUser("user-1");
    const hydrated = await hydrateRecoverableRunCandidate(recovery, {
      userId: "user-1",
      restartTracking: false,
    });

    expect(recovery.source).toBe(RUN_RECOVERY_SOURCE.OFFLINE);
    expect(hydrated.snapshot.activeRunId).toBe("legacy-paused");
    expect(hydrated.snapshot.status).toBe("PAUSED");
    expect(hydrated.snapshot.mode).toBe("zones");
    expect(hydrated.snapshot.trustedPath).toHaveLength(2);
    expect(hydrated.snapshot.rawPath).toHaveLength(3);
    expect(hydrated.snapshot.segments).toHaveLength(1);
    expect(hydrated.snapshot.localRunId).toBe("legacy-paused");
    expect(hydrated.snapshot.syncStatus).toBe("LOCAL_ONLY");
    expect(trackingService.hydrateActiveRunSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      activeRunId: "legacy-paused",
      status: "PAUSED",
    }), expect.objectContaining({
      replaceExisting: true,
      restartTracking: false,
    }));
  });

  test("recovery repetido mantem mesmo localRunId sem duplicar migracao", async () => {
    const legacyRun = {
      localRunId: "legacy-repeat",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAt: BASE_RUN.startedAt,
      updatedAt: BASE_RUN.lastUpdatedAt,
      durationMs: 180000,
      distanceMeters: 420,
      points: BASE_RUN.trustedPath,
      rawPoints: BASE_RUN.trustedPath,
      segments: [{ index: 0, startedAt: BASE_RUN.startedAt, reason: "START" }],
      syncStatus: "LOCAL_ONLY",
      schemaVersion: 1,
    };
    storage.set(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(legacyRun));

    const firstRecovery = await findRecoverableRunForUser("user-1");
    const firstHydrated = await hydrateRecoverableRunCandidate(firstRecovery, {
      userId: "user-1",
      restartTracking: false,
    });
    const secondRecovery = await findRecoverableRunForUser("user-1");

    expect(firstHydrated.snapshot.localRunId).toBe("legacy-repeat");
    expect(secondRecovery.source).toBe(RUN_RECOVERY_SOURCE.TRACKING);
    expect(secondRecovery.id).toBe("legacy-repeat");
    expect(trackingService.hydrateActiveRunSnapshot).toHaveBeenCalledTimes(1);
  });

  test("resolve conflito entre canonico e legado pelo checkpoint mais recente", async () => {
    currentSnapshot = {
      ...BASE_RUN,
      activeRunId: "same-run",
      lastUpdatedAt: "2026-06-03T10:01:00.000Z",
      trustedPath: BASE_RUN.trustedPath.slice(0, 1),
    };
    storage.set(ACTIVE_RUN_STORAGE_KEY, JSON.stringify({
      localRunId: "same-run",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAt: BASE_RUN.startedAt,
      checkpointAt: "2026-06-03T10:04:00.000Z",
      durationMs: 240000,
      distanceMeters: 600,
      points: BASE_RUN.trustedPath,
      segments: [{ index: 0, startedAt: BASE_RUN.startedAt, reason: "START" }],
      schemaVersion: 1,
    }));

    const recovery = await findRecoverableRunForUser("user-1");

    expect(recovery.source).toBe(RUN_RECOVERY_SOURCE.OFFLINE);
    expect(recovery.id).toBe("same-run");
    expect(recovery.pointsCount).toBe(2);
  });

  test("corrida finalizada nao vence como ativa nem ressuscita legado running do mesmo id", async () => {
    const finishedCandidate = createRecoveryCandidate(RUN_RECOVERY_SOURCE.TRACKING, {
      ...BASE_RUN,
      activeRunId: "finished-run",
      status: "FINISHED",
      finishedAt: "2026-06-03T10:05:00.000Z",
      lastUpdatedAt: "2026-06-03T10:05:00.000Z",
    }, { userId: "user-1" });
    const staleLiveCandidate = createRecoveryCandidate(RUN_RECOVERY_SOURCE.OFFLINE, {
      ...BASE_RUN,
      activeRunId: undefined,
      localRunId: "finished-run",
      status: "RUNNING",
      updatedAt: "2026-06-03T10:04:00.000Z",
      schemaVersion: 1,
    }, { userId: "user-1" });

    const selected = resolveRecoveryConflict([staleLiveCandidate, finishedCandidate]);

    expect(selected.status).toBe(RUN_RECOVERY_STATUS.FINISHED);
  });

  test("snapshot finishing vence legado running do mesmo id", () => {
    const finishingCandidate = createRecoveryCandidate(RUN_RECOVERY_SOURCE.TRACKING, {
      ...BASE_RUN,
      activeRunId: "same-finishing-run",
      status: "FINISHING",
      lastUpdatedAt: "2026-06-03T10:05:00.000Z",
    }, { userId: "user-1" });
    const staleLiveCandidate = createRecoveryCandidate(RUN_RECOVERY_SOURCE.OFFLINE, {
      ...BASE_RUN,
      activeRunId: undefined,
      localRunId: "same-finishing-run",
      status: "RUNNING",
      updatedAt: "2026-06-03T10:04:00.000Z",
      schemaVersion: 1,
    }, { userId: "user-1" });

    const selected = resolveRecoveryConflict([staleLiveCandidate, finishingCandidate]);

    expect(selected.status).toBe(RUN_RECOVERY_STATUS.FINISHED);
    expect(isLiveRecovery(selected)).toBe(false);
  });

  test("estado corrompido e descartado sem candidato recuperavel", async () => {
    storage.set(ACTIVE_RUN_STORAGE_KEY, JSON.stringify({
      localRunId: "broken",
      userId: "user-1",
      status: "RUNNING",
      startedAt: "not-a-date",
      points: [{ latitude: "x", longitude: null }],
      schemaVersion: 1,
    }));

    const recovery = await findRecoverableRunForUser("user-1");

    expect(recovery).toBeNull();
  });

  test("snapshot canonico construido do legado preserva paths, segments e ids", () => {
    const snapshot = buildActiveSnapshotFromOfflineRun({
      localRunId: "legacy-paths",
      remoteRunId: "remote-1",
      userId: "user-1",
      mode: "free",
      status: "RUNNING",
      startedAt: BASE_RUN.startedAt,
      updatedAt: BASE_RUN.lastUpdatedAt,
      durationMs: 180000,
      distanceMeters: 420,
      points: BASE_RUN.trustedPath,
      rawPoints: BASE_RUN.trustedPath.concat({ latitude: -23.561, longitude: -46.641, timestamp: 3000 }),
      segments: [{ index: 0, startedAt: BASE_RUN.startedAt, reason: "START" }],
      syncStatus: "LOCAL_ONLY",
    }, { userId: "user-1" });

    expect(snapshot.activeRunId).toBe("legacy-paths");
    expect(snapshot.localRunId).toBe("legacy-paths");
    expect(snapshot.remoteRunId).toBe("remote-1");
    expect(snapshot.trustedPath).toHaveLength(2);
    expect(snapshot.rawPath).toHaveLength(3);
    expect(snapshot.segments).toHaveLength(1);
    expect(snapshot.syncStatus).toBe("LOCAL_ONLY");
  });

  test("runData recuperado usa localRunId estavel e status pendente para fila", () => {
    const runData = buildRunDataFromRecoveredRun(createRecoveryCandidate(RUN_RECOVERY_SOURCE.TRACKING, {
      ...BASE_RUN,
      activeRunId: "canonical-to-queue",
      localRunId: "canonical-to-queue",
      status: "FINISHED",
      finishedAt: "2026-06-03T10:05:00.000Z",
      syncStatus: "LOCAL_ONLY",
    }, { userId: "user-1" }));

    expect(runData.id).toBe("canonical-to-queue");
    expect(runData.localRunId).toBe("canonical-to-queue");
    expect(runData.syncStatus).toBe("PENDING");
    expect(runData.offlineStatus).toBe("PENDING_SYNC");
    expect(runData.trustedPath).toHaveLength(2);
  });

  test("limpeza apos save local remove snapshot canonico e legado", async () => {
    currentSnapshot = { ...BASE_RUN, activeRunId: "clean-me" };
    storage.set(ACTIVE_RUN_STORAGE_KEY, JSON.stringify({
      localRunId: "clean-me",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAt: BASE_RUN.startedAt,
      points: BASE_RUN.trustedPath,
      schemaVersion: 1,
    }));

    const result = await markRecoveredRunLocallySaved({ reason: "test" });

    expect(result.ok).toBe(true);
    expect(trackingService.markActiveRunLocallySaved).toHaveBeenCalled();
    expect(storage.has(ACTIVE_RUN_STORAGE_KEY)).toBe(false);
  });

  test("falha ao limpar canonico nao apaga checkpoint legado", async () => {
    currentSnapshot = { ...BASE_RUN, activeRunId: "keep-recovery" };
    storage.set(ACTIVE_RUN_STORAGE_KEY, JSON.stringify({
      localRunId: "keep-recovery",
      userId: "user-1",
      mode: "free",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAt: BASE_RUN.startedAt,
      points: BASE_RUN.trustedPath,
      schemaVersion: 1,
    }));
    trackingService.markActiveRunLocallySaved.mockResolvedValueOnce(false);

    const result = await markRecoveredRunLocallySaved({ reason: "cleanup_failed" });

    expect(result.ok).toBe(false);
    expect(storage.has(ACTIVE_RUN_STORAGE_KEY)).toBe(true);
  });

  test("recusa recovery de outro usuario", () => {
    const validation = validateRecoverableRun(BASE_RUN, {
      source: RUN_RECOVERY_SOURCE.TRACKING,
      userId: "user-2",
    });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain("user_mismatch");
  });

  test("dados corrompidos nao quebram e oferecem razoes claras", () => {
    const validation = validateRecoverableRun(
      {
        localRunId: "broken",
        userId: "user-1",
        status: "RUNNING",
        startedAt: "not-a-date",
        points: [{ latitude: "x", longitude: null }],
        schemaVersion: 1,
      },
      { source: RUN_RECOVERY_SOURCE.OFFLINE, userId: "user-1" }
    );

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toEqual(expect.arrayContaining(["invalid_started_at", "empty_payload"]));
  });
});
