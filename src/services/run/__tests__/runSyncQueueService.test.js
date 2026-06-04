import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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
  beforeEach(() => {
    saveLocalRun.mockClear();
    scheduleRunsSync.mockClear();
    loadLocalRuns.mockClear();
    syncRunsToFirestore.mockClear();
  });

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

  test("reenfileirar a mesma corrida preserva a mesma chave local", async () => {
    await enqueueFinishedRun({
      id: "run-recovery-dedup",
      localRunId: "run-recovery-dedup",
      userId: "user-1",
    }, { schedule: false });
    await enqueueFinishedRun({
      id: "run-recovery-dedup",
      localRunId: "run-recovery-dedup",
      userId: "user-1",
    }, { schedule: false });

    expect(saveLocalRun).toHaveBeenCalledTimes(2);
    expect(saveLocalRun.mock.calls.at(-1)[0]).toMatchObject({
      id: "run-recovery-dedup",
      localRunId: "run-recovery-dedup",
      pendingSync: true,
    });
  });
});
