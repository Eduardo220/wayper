import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const enqueueFinishedRun = jest.fn(async (run) => ({ ...run, pendingSync: true }));
const loadPendingRuns = jest.fn(async () => [{ id: "pending" }]);
const retryPendingRuns = jest.fn(async () => ({ synced: 1 }));
const schedulePendingRunsSync = jest.fn(async () => true);
const startAutoSync = jest.fn(() => "started");
const stopAutoSync = jest.fn(() => "stopped");

jest.unstable_mockModule("../../services/run/runSyncQueueService.js", () => ({
  enqueueFinishedRun,
  loadPendingRuns,
  retryPendingRuns,
  schedulePendingRunsSync,
}));

jest.unstable_mockModule("../../utils/sync.js", () => ({
  startAutoSync,
  stopAutoSync,
}));

const repository = await import("../runSyncQueueRepository.js");

describe("runSyncQueueRepository", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("enfileira usando runSyncQueueService", async () => {
    const result = await repository.enqueue({ id: "run-1" }, { schedule: false });

    expect(enqueueFinishedRun).toHaveBeenCalledWith({ id: "run-1" }, { schedule: false });
    expect(result).toMatchObject({
      source: "local",
      data: { id: "run-1", pendingSync: true },
      syncStatus: "queued",
    });
  });

  test("retry chama a fila oficial sem criar fila propria", async () => {
    const result = await repository.retry();

    expect(retryPendingRuns).toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "remote",
      data: { synced: 1 },
    });
  });

  test("start/stop auto sync encapsulam sync.js", async () => {
    await repository.startAutoSync();
    await repository.stopAutoSync();

    expect(startAutoSync).toHaveBeenCalled();
    expect(stopAutoSync).toHaveBeenCalled();
  });
});
