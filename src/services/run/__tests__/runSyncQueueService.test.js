import { describe, expect, jest, test } from "@jest/globals";

const saveLocalRun = jest.fn(async (run) => run);
const scheduleRunsSync = jest.fn();
const loadLocalRuns = jest.fn(async () => []);
const syncRunsToFirestore = jest.fn(async () => {});

jest.unstable_mockModule("../../../utils/sync.js", () => ({
  saveLocalRun,
  scheduleRunsSync,
  loadLocalRuns,
  syncRunsToFirestore,
}));

const {
  RUN_SYNC_QUEUE_STATUS,
  enqueueFinishedRun,
} = await import("../runSyncQueueService.js");

describe("runSyncQueueService", () => {
  test("enfileira corrida finalizada mantendo runId idempotente", async () => {
    const saved = await enqueueFinishedRun({
      id: "run-idempotente",
      userId: "user-1",
      distance: 1000,
      duration: 300,
    }, { delayMs: 0 });

    expect(saved.id).toBe("run-idempotente");
    expect(saved.localRunId).toBe("run-idempotente");
    expect(saved.pendingSync).toBe(true);
    expect(saved.syncStatus).toBe(RUN_SYNC_QUEUE_STATUS.PENDING);
    expect(saveLocalRun).toHaveBeenCalledWith(expect.objectContaining({
      id: "run-idempotente",
      localRunId: "run-idempotente",
      pendingSync: true,
    }));
    expect(scheduleRunsSync).toHaveBeenCalledWith(0);
  });
});
