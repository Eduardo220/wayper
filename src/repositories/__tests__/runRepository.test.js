import { describe, expect, jest, test, beforeEach } from "@jest/globals";

const loadLocalRunHistory = jest.fn(async () => []);
const findLocalRunById = jest.fn(async () => null);
const saveLocalRun = jest.fn(async (run) => run);
const deleteLocalRun = jest.fn(async () => ({ deleted: true, remoteDeleted: false }));
const scheduleRunsSync = jest.fn();
const listPending = jest.fn(async () => ({
  data: [{ id: "pending-run", pendingSync: true }],
  source: "local",
  error: null,
}));

jest.unstable_mockModule("../../utils/sync.js", () => ({
  RUN_SYNC_STATUS: {
    PENDING: "PENDING",
    SYNCING: "SYNCING",
    SYNCED: "SYNCED",
    FAILED: "FAILED",
  },
  RUN_OFFLINE_STATUS: {
    PENDING_SYNC: "PENDING_SYNC",
    SYNCING: "SYNCING",
    SYNCED: "SYNCED",
    SYNC_FAILED: "SYNC_FAILED",
  },
  loadLocalRunHistory,
  findLocalRunById,
  saveLocalRun,
  deleteLocalRun,
  scheduleRunsSync,
}));

jest.unstable_mockModule("../runSyncQueueRepository.js", () => ({
  listPending,
}));

const runRepository = await import("../runRepository.js");

describe("runRepository", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadLocalRunHistory.mockResolvedValue([]);
    findLocalRunById.mockResolvedValue(null);
    saveLocalRun.mockImplementation(async (run) => run);
  });

  test("lista historico pela fonte local oficial", async () => {
    loadLocalRunHistory.mockResolvedValue([{ id: "run-1", localRunId: "run-1" }]);

    const result = await runRepository.list();

    expect(loadLocalRunHistory).toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "local",
      data: [{ id: "run-1", localRunId: "run-1" }],
      error: null,
    });
  });

  test("busca por localRunId ou remoteRunId via sync.findLocalRunById", async () => {
    const run = { id: "local-1", localRunId: "local-1", remoteRunId: "remote-1" };
    findLocalRunById.mockResolvedValue(run);

    const result = await runRepository.findById({ remoteRunId: "remote-1" });

    expect(findLocalRunById).toHaveBeenCalledWith({ remoteRunId: "remote-1" });
    expect(result.data).toBe(run);
  });

  test("salva sem perder remoteRunId, status, paths e segmentos", async () => {
    const run = {
      id: "local-1",
      localRunId: "local-1",
      remoteRunId: "remote-1",
      syncStatus: "FAILED",
      offlineStatus: "SYNC_FAILED",
      trustedPath: [{ latitude: 1, longitude: 2 }],
      renderPath: [{ latitude: 1, longitude: 2 }],
      rawPath: [{ latitude: 1, longitude: 2 }],
      segments: [{ points: [{ latitude: 1, longitude: 2 }] }],
    };

    const result = await runRepository.save(run, { scheduleSync: true });

    expect(saveLocalRun).toHaveBeenCalledWith(expect.objectContaining({
      remoteRunId: "remote-1",
      syncStatus: "FAILED",
      offlineStatus: "SYNC_FAILED",
      trustedPath: run.trustedPath,
      renderPath: run.renderPath,
      rawPath: run.rawPath,
      segments: run.segments,
    }));
    expect(scheduleRunsSync).toHaveBeenCalledWith(0);
    expect(result.data.remoteRunId).toBe("remote-1");
  });

  test("markAsPendingSync reaproveita saveLocalRun e agenda fila oficial", async () => {
    findLocalRunById.mockResolvedValue({
      id: "local-1",
      localRunId: "local-1",
      remoteRunId: "remote-1",
      syncStatus: "SYNCED",
    });

    await runRepository.markAsPendingSync({ localRunId: "local-1" });

    expect(saveLocalRun).toHaveBeenCalledWith(expect.objectContaining({
      id: "local-1",
      localRunId: "local-1",
      remoteRunId: "remote-1",
      pendingSync: true,
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
    }));
    expect(scheduleRunsSync).toHaveBeenCalled();
  });

  test("lista pendentes pela facade da fila sem storage paralelo", async () => {
    const result = await runRepository.listPendingSync();

    expect(listPending).toHaveBeenCalled();
    expect(result.data).toEqual([{ id: "pending-run", pendingSync: true }]);
  });
});
