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

const repository = await import("../achievementRepository.js");

describe("achievementRepository", () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
  });

  test("lista catalogo local em storage vazio", async () => {
    const achievements = await repository.listAchievements({ userId: "user-1" });

    expect(achievements.length).toBeGreaterThan(0);
    expect(achievements.find((item) => item.id === "first_run_completed")).toMatchObject({
      unlocked: false,
      progress: 0,
      target: 1,
    });
  });

  test("salva progresso parcial de conquista", async () => {
    const progress = await repository.saveAchievementProgress("total_distance_5k", {
      userId: "user-1",
      progress: 1200,
    });

    expect(progress).toMatchObject({
      id: "total_distance_5k",
      progress: 1200,
      target: 5000,
      syncStatus: "PENDING",
    });

    const found = await repository.findAchievementById("total_distance_5k", { userId: "user-1" });
    expect(found.progress).toBe(1200);
  });

  test("desbloqueia conquista sem duplicar", async () => {
    const first = await repository.unlockAchievement("first_run_completed", { userId: "user-1" });
    const second = await repository.unlockAchievement("first_run_completed", { userId: "user-1" });
    const unlocked = await repository.listUnlockedAchievements({ userId: "user-1" });

    expect(first.unlocked).toBe(true);
    expect(second).toMatchObject({ unlocked: false, alreadyUnlocked: true });
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]).toMatchObject({
      id: "first_run_completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
    });
  });

  test("progresso parcial fica isolado por usuario", async () => {
    await repository.saveAchievementProgress("total_distance_5k", {
      userId: "user-1",
      progress: 1200,
    });
    await repository.saveAchievementProgress("total_distance_5k", {
      userId: "user-2",
      progress: 3400,
    });

    const first = await repository.findAchievementById("total_distance_5k", { userId: "user-1" });
    const second = await repository.findAchievementById("total_distance_5k", { userId: "user-2" });

    expect(first.progress).toBe(1200);
    expect(first.localId).toBe("achievement:user-1:total_distance_5k");
    expect(second.progress).toBe(3400);
    expect(second.localId).toBe("achievement:user-2:total_distance_5k");
  });

  test("mark synced e failed preservam entidade local", async () => {
    await repository.unlockAchievement("first_run_completed", { userId: "user-1" });

    const synced = await repository.markAchievementSynced("first_run_completed", "remote-1", { userId: "user-1" });
    expect(synced).toMatchObject({
      remoteId: "remote-1",
      syncStatus: "SYNCED",
      offlineStatus: "SYNCED",
    });

    const failed = await repository.markAchievementSyncFailed("first_run_completed", "offline", { userId: "user-1" });
    expect(failed).toMatchObject({
      syncStatus: "FAILED",
      offlineStatus: "SYNC_FAILED",
      syncError: "offline",
    });
  });

  test("evaluateAchievementsFromProgress desbloqueia apenas conquistas calculaveis", async () => {
    const result = await repository.evaluateAchievementsFromProgress({
      userId: "user-1",
      totalRuns: 1,
      totalDistanceMeters: 1200,
      totalDurationSeconds: 600,
      zoneRuns: 0,
      territoryCaptures: 0,
    });

    const ids = result.newlyUnlocked.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["first_run_completed", "total_distance_1k"]));
    expect(ids).not.toContain("first_zone_run");
  });

  test("storage corrompido retorna estado controlado", async () => {
    storage.set(repository.ACHIEVEMENTS_STORAGE_KEY, "{bad-json");
    storage.set(repository.ACHIEVEMENT_PROGRESS_STORAGE_KEY, "{bad-json");

    const achievements = await repository.listAchievements({ userId: "user-1" });

    expect(achievements.length).toBeGreaterThan(0);
    expect(achievements.every((item) => item.unlocked === false)).toBe(true);
  });
});
