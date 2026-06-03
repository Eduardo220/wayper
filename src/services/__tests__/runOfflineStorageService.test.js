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

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
}));

const {
  ACTIVE_RUN_MAX_POINTS,
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_SYNC_STATUS,
  clearActiveRun,
  createActiveRun,
  finishActiveRun,
  loadActiveRun,
  saveActiveRunSnapshot,
  shouldRestoreActiveRun,
} = await import("../runOfflineStorageService.js");

describe("runOfflineStorageService", () => {
  beforeEach(async () => {
    storage.clear();
    jest.clearAllMocks();
    await clearActiveRun();
  });

  test("cria e carrega corrida ativa offline-first", async () => {
    const startedAt = "2026-06-03T10:00:00.000Z";
    const created = await createActiveRun({
      localRunId: "run-1",
      userId: "user-1",
      mode: "zones",
      startedAt,
    });

    const loaded = await loadActiveRun();

    expect(created).toMatchObject({
      localRunId: "run-1",
      userId: "user-1",
      mode: "territory",
      status: ACTIVE_RUN_STATUS.RUNNING,
      syncStatus: ACTIVE_RUN_SYNC_STATUS.LOCAL_ONLY,
    });
    expect(loaded.startedAt).toBe(startedAt);
    expect(shouldRestoreActiveRun(loaded)).toBe(true);
  });

  test("snapshot salva pontos e limita volume local", async () => {
    await createActiveRun({ localRunId: "run-2", userId: "user-1", mode: "free" });
    const points = Array.from({ length: ACTIVE_RUN_MAX_POINTS + 4 }, (_, index) => ({
      latitude: -30 + index * 0.00001,
      longitude: -51,
      timestamp: Date.now() + index,
      segmentId: index > 3 ? 1 : 0,
    }));

    const saved = await saveActiveRunSnapshot({
      points,
      durationMs: 12000,
      distanceMeters: 42,
      segments: [
        { index: 0, startedAt: Date.now(), reason: "START" },
        { index: 1, startedAt: Date.now() + 4000, reason: "PAUSE_RESUME" },
      ],
    });

    expect(saved.points).toHaveLength(ACTIVE_RUN_MAX_POINTS);
    expect(saved.distanceMeters).toBe(42);
    expect(saved.segments).toHaveLength(2);
  });

  test("finishActiveRun guarda rascunho final recuperavel", async () => {
    const finished = await finishActiveRun({
      id: "run-3",
      userId: "user-1",
      mode: "free",
      duration: 30,
      distance: 100,
      path: [
        { latitude: -30, longitude: -51, timestamp: 1000 },
        { latitude: -30.0005, longitude: -51, timestamp: 2000 },
      ],
      date: "2026-06-03T10:05:00.000Z",
    });

    const loaded = await loadActiveRun();

    expect(finished).toMatchObject({
      localRunId: "run-3",
      status: ACTIVE_RUN_STATUS.FINISHED,
      syncStatus: ACTIVE_RUN_SYNC_STATUS.LOCAL_ONLY,
      durationMs: 30000,
      distanceMeters: 100,
    });
    expect(loaded.finalRunData.id).toBe("run-3");
    expect(shouldRestoreActiveRun(loaded)).toBe(true);
  });
});
