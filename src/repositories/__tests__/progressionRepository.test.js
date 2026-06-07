import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
let mockedRuns = [];

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

jest.unstable_mockModule("../runRepository.js", () => ({
  default: {
    list: jest.fn(async () => ({ data: mockedRuns, source: "local", error: null })),
  },
  list: jest.fn(async () => ({ data: mockedRuns, source: "local", error: null })),
}));

const progression = await import("../progressionRepository.js");
const achievements = await import("../achievementRepository.js");

const validRun = (patch = {}) => ({
  id: "run-1",
  localRunId: "run-1",
  userId: "user-1",
  status: "completed",
  mode: "free",
  distance: 1000,
  distanceMeters: 1000,
  duration: 600,
  durationSeconds: 600,
  date: "2026-06-06T10:00:00.000Z",
  trustedPath: [
    { latitude: -23.56, longitude: -46.64, timestamp: 1 },
    { latitude: -23.561, longitude: -46.64, timestamp: 2 },
  ],
  ...patch,
});

describe("progressionRepository", () => {
  beforeEach(() => {
    storage.clear();
    mockedRuns = [];
    jest.clearAllMocks();
  });

  test("storage vazio retorna progresso inicial controlado", async () => {
    const progress = await progression.getUserProgress({ userId: "user-1" });

    expect(progress).toMatchObject({
      userId: "user-1",
      totalXp: 0,
      level: 1,
      totalRuns: 0,
      syncStatus: "PENDING",
    });
  });

  test("calcula nivel com formula estavel", () => {
    expect(progression.getLevelInfo(0)).toMatchObject({ level: 1, xp: 0, nextLevelXp: 100 });
    expect(progression.getLevelInfo(100)).toMatchObject({ level: 2, xp: 0, nextLevelXp: 150 });
    expect(progression.getLevelInfo(249)).toMatchObject({ level: 2, xp: 149, progressToNextLevelPct: 99 });
    expect(progression.getLevelInfo(250)).toMatchObject({ level: 3, xp: 0, nextLevelXp: 250 });
  });

  test("corrida finalizada gera XP e eventos locais", async () => {
    const result = await progression.addXpFromRun(validRun(), { userId: "user-1" });
    const events = await progression.listXpEvents({ userId: "user-1", sourceRunId: "run-1" });

    expect(result.applied).toBe(true);
    expect(result.xpAwarded).toBe(26);
    expect(result.progress).toMatchObject({
      totalXp: 26,
      totalRuns: 1,
      totalDistanceMeters: 1000,
      totalDurationSeconds: 600,
      freeRuns: 1,
    });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "RUN_COMPLETED",
      "DISTANCE_RUN",
      "DURATION_RUN",
      "FIRST_RUN",
    ]));
    expect(events.every((event) => event.localId && event.sourceRunId === "run-1")).toBe(true);
  });

  test("mesma corrida nao duplica XP", async () => {
    const first = await progression.addXpFromRun(validRun(), { userId: "user-1" });
    const second = await progression.addXpFromRun(validRun(), { userId: "user-1" });
    const progress = await progression.getUserProgress({ userId: "user-1" });

    expect(first.applied).toBe(true);
    expect(second).toMatchObject({ applied: false, reason: "already_processed" });
    expect(progress.totalXp).toBe(26);
    expect(progress.totalRuns).toBe(1);
  });

  test("corrida ativa e FINISHING nao geram XP", async () => {
    const active = await progression.addXpFromRun(validRun({ id: "active", localRunId: "active", status: "RUNNING" }), { userId: "user-1" });
    const finishing = await progression.addXpFromRun(validRun({ id: "finishing", localRunId: "finishing", status: "completed", offlineStatus: "FINISHING" }), { userId: "user-1" });
    const progress = await progression.getUserProgress({ userId: "user-1" });

    expect(active.reason).toBe("active_or_finishing_run");
    expect(finishing.reason).toBe("active_or_finishing_run");
    expect(progress.totalXp).toBe(0);
  });

  test("corrida invalida ou curta nao gera XP", async () => {
    const invalid = await progression.addXpFromRun(validRun({ id: "bad", localRunId: "bad", status: "invalid" }), { userId: "user-1" });
    const shortDistance = await progression.addXpFromRun(validRun({ id: "short", localRunId: "short", distance: 50, distanceMeters: 50 }), { userId: "user-1" });

    expect(invalid.reason).toBe("invalid_run");
    expect(shortDistance.reason).toBe("distance_too_short");
  });

  test("corrida livre nao recebe XP territorial mesmo com area no payload", async () => {
    const result = await progression.addXpFromRun(validRun({
      area: 2000,
      areaM2: 2000,
      capturedCells: ["cell-a"],
      mode: "free",
    }), { userId: "user-1" });

    expect(result.events.map((event) => event.type)).not.toContain("TERRITORY_CAPTURED");
    expect(result.progress.totalTerritoryAreaM2).toBe(0);
  });

  test("corrida por zonas gera XP territorial valido", async () => {
    const result = await progression.addXpFromRun(validRun({
      id: "zone-run",
      localRunId: "zone-run",
      mode: "zones",
      areaM2: 1200,
      territoryId: "territory-1",
      capturedCells: ["a", "b", "b"],
      captureResult: {
        ok: true,
        capturedAreaM2: 1200,
        cellIds: ["a", "b"],
      },
    }), { userId: "user-1" });

    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "ZONE_RUN_COMPLETED",
      "TERRITORY_CAPTURED",
    ]));
    expect(result.progress).toMatchObject({
      zoneRuns: 1,
      territoryCaptures: 1,
      totalTerritoryAreaM2: 1200,
      totalCapturedCells: 2,
    });
  });

  test("desbloqueia conquistas iniciais a partir do progresso real", async () => {
    await progression.addXpFromRun(validRun(), { userId: "user-1" });
    const unlocked = await achievements.listUnlockedAchievements({ userId: "user-1" });
    const ids = unlocked.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining(["first_run_completed", "total_distance_1k"]));
  });

  test("recalculo local e incremental e idempotente", async () => {
    mockedRuns = [
      validRun({ id: "run-a", localRunId: "run-a", date: "2026-06-06T10:00:00.000Z" }),
      validRun({ id: "run-b", localRunId: "run-b", date: "2026-06-06T11:00:00.000Z", distance: 500, distanceMeters: 500 }),
    ];

    const first = await progression.recalculateProgressFromLocalRuns({ userId: "user-1" });
    const second = await progression.recalculateProgressFromLocalRuns({ userId: "user-1" });

    expect(first.applied).toHaveLength(2);
    expect(second.applied).toHaveLength(0);
    expect(second.progress.totalRuns).toBe(2);
  });

  test("markProgress synced e failed funcionam sem rede", async () => {
    await progression.addXpFromRun(validRun(), { userId: "user-1" });

    const synced = await progression.markProgressSynced({ userId: "user-1", remoteId: "remote-progress" });
    expect(synced).toMatchObject({
      remoteId: "remote-progress",
      syncStatus: "SYNCED",
      offlineStatus: "SYNCED",
    });

    const failed = await progression.markProgressSyncFailed("offline", { userId: "user-1" });
    expect(failed).toMatchObject({
      syncStatus: "FAILED",
      offlineStatus: "SYNC_FAILED",
      syncError: "offline",
    });
  });

  test("storage corrompido nao quebra app", async () => {
    storage.set(progression.USER_PROGRESS_STORAGE_KEY, "{bad-json");
    storage.set(progression.XP_EVENTS_STORAGE_KEY, "{bad-json");

    const progress = await progression.getUserProgress({ userId: "user-1" });
    const result = await progression.addXpFromRun(validRun(), { userId: "user-1" });

    expect(progress.totalXp).toBe(0);
    expect(result.applied).toBe(true);
  });
});
