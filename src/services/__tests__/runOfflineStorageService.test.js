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
  ACTIVE_RUN_STORAGE_KEY,
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_SYNC_STATUS,
  clearActiveRun,
  createActiveRun,
  finishActiveRun,
  loadActiveRun,
  saveActiveRunSnapshot,
  shouldRecoverOfflineRun,
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

  test("finishActiveRun guarda rascunho final recuperavel sem voltar como ativo", async () => {
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
    expect(shouldRestoreActiveRun(loaded)).toBe(false);
    expect(shouldRecoverOfflineRun(loaded)).toBe(true);
  });

  test("checkpoint antigo nao sobrescreve checkpoint mais recente do mesmo run", async () => {
    await createActiveRun({ localRunId: "run-stale", userId: "user-1", mode: "free" });
    const newer = await saveActiveRunSnapshot({
      localRunId: "run-stale",
      status: ACTIVE_RUN_STATUS.RUNNING,
      checkpointAtMs: 3000,
      points: [
        { latitude: -30, longitude: -51, timestamp: 1000 },
        { latitude: -30.0005, longitude: -51, timestamp: 2000 },
      ],
      durationMs: 20_000,
      distanceMeters: 120,
    });
    const stale = await saveActiveRunSnapshot({
      localRunId: "run-stale",
      status: ACTIVE_RUN_STATUS.RUNNING,
      checkpointAtMs: 2000,
      points: [
        { latitude: -30, longitude: -51, timestamp: 1000 },
      ],
      durationMs: 10_000,
      distanceMeters: 10,
    });

    expect(stale).toEqual(newer);
    const loaded = await loadActiveRun();
    expect(loaded.points).toHaveLength(2);
    expect(loaded.distanceMeters).toBe(120);
  });

  test("checkpoint vivo parcial nao sobrescreve pontos, segments e distancia com vazio", async () => {
    await createActiveRun({ localRunId: "run-empty-guard", userId: "user-1", mode: "free" });
    await saveActiveRunSnapshot({
      localRunId: "run-empty-guard",
      status: ACTIVE_RUN_STATUS.RUNNING,
      checkpointAtMs: 3000,
      points: [
        { latitude: -30, longitude: -51, timestamp: 1000, segmentId: 0 },
        { latitude: -30.0005, longitude: -51, timestamp: 2000, segmentId: 0 },
      ],
      segments: [{ index: 0, startedAt: 1000, reason: "START" }],
      durationMs: 20_000,
      distanceMeters: 930,
    });

    const partial = await saveActiveRunSnapshot({
      localRunId: "run-empty-guard",
      status: ACTIVE_RUN_STATUS.RUNNING,
      checkpointAtMs: 4000,
      points: [],
      segments: [],
      durationMs: 22_000,
      distanceMeters: 880,
    });

    expect(partial.points).toHaveLength(2);
    expect(partial.segments).toHaveLength(1);
    expect(partial.distanceMeters).toBe(930);
  });

  test("dados locais corrompidos nao quebram o app", async () => {
    storage.set(ACTIVE_RUN_STORAGE_KEY, "{json-quebrado");

    await expect(loadActiveRun()).resolves.toBeNull();
  });
});
