import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let mockedRuns = [];
let mockedTerritories = [];
let mockedProgress = {};
let mockedAchievements = [];

jest.unstable_mockModule("../runRepository.js", () => ({
  default: {
    list: jest.fn(async () => ({ data: mockedRuns, source: "local", error: null })),
  },
  list: jest.fn(async () => ({ data: mockedRuns, source: "local", error: null })),
}));

jest.unstable_mockModule("../territoryRepository.js", () => ({
  default: {
    list: jest.fn(async () => ({ data: mockedTerritories, source: "local", error: null })),
  },
  list: jest.fn(async () => ({ data: mockedTerritories, source: "local", error: null })),
}));

jest.unstable_mockModule("../progressionRepository.js", () => ({
  getUserProgress: jest.fn(async () => mockedProgress),
}));

jest.unstable_mockModule("../achievementRepository.js", () => ({
  listAchievements: jest.fn(async () => mockedAchievements),
}));

const statsRepository = await import("../profileStats.js");

const finishedRun = (patch = {}) => ({
  id: "run-1",
  localRunId: "run-1",
  userId: "user-1",
  status: "completed",
  offlineStatus: "PENDING_SYNC",
  mode: "free",
  distance: 1000,
  distanceMeters: 1000,
  duration: 600,
  durationSeconds: 600,
  date: "2026-06-10T10:00:00.000Z",
  ...patch,
});

describe("profileStats", () => {
  beforeEach(() => {
    mockedRuns = [];
    mockedTerritories = [];
    mockedProgress = {
      userId: "user-1",
      totalXp: 200,
      xp: 100,
      level: 2,
      nextLevelXp: 150,
      progressToNextLevelPct: 67,
    };
    mockedAchievements = [];
    jest.clearAllMocks();
  });

  test("calcula estatisticas locais reais sem duplicar corridas sincronizadas", async () => {
    mockedRuns = [
      finishedRun({ localRunId: "local-1", remoteRunId: "remote-1" }),
      finishedRun({ id: "remote-1", localRunId: null, remoteRunId: "remote-1", distance: 900 }),
      finishedRun({
        id: "zone-1",
        localRunId: "zone-1",
        mode: "zones",
        distance: 500,
        distanceMeters: 500,
        duration: 300,
        durationSeconds: 300,
        areaM2: 700,
        offlineStatus: "SYNCED",
      }),
      finishedRun({ id: "active", localRunId: "active", status: "RUNNING" }),
      finishedRun({ id: "finishing", localRunId: "finishing", offlineStatus: "FINISHING" }),
      finishedRun({ id: "other-user", localRunId: "other-user", userId: "user-2" }),
    ];
    mockedTerritories = [
      { id: "territory-1", ownerId: "user-1", areaM2: 1000, cellIds: ["a", "b"], syncStatus: "PENDING" },
      { id: "territory-2", ownerId: "user-2", areaM2: 9000, cellIds: ["x"] },
    ];
    mockedAchievements = [
      { id: "first_run_completed", userId: "user-1", unlocked: true, unlockedAt: "2026-06-10T12:00:00.000Z" },
      { id: "total_distance_5k", userId: "user-1", unlocked: false },
    ];

    const stats = await statsRepository.getLocalProfileStats({
      userId: "user-1",
      now: new Date("2026-06-15T12:00:00.000Z"),
    });

    expect(stats).toMatchObject({
      source: "local",
      totalRuns: 2,
      freeRuns: 1,
      zoneRuns: 1,
      totalDistanceMeters: 1500,
      totalDurationSeconds: 900,
      averagePaceSecondsPerKm: 600,
      totalTerritoryAreaM2: 1000,
      totalZones: 1,
      totalCapturedCells: 2,
      duplicateRunCount: 1,
      pendingRunSyncCount: 1,
      pendingTerritorySyncCount: 1,
      totalXp: 200,
      level: 2,
      achievementsUnlocked: 1,
      achievementsTotal: 2,
    });
  });

  test("estado vazio local fica controlado", async () => {
    mockedProgress = { userId: "user-1", totalXp: 0, xp: 0, level: 1, nextLevelXp: 100 };

    const stats = await statsRepository.getLocalProfileStats({ userId: "user-1" });

    expect(stats).toMatchObject({
      source: "local",
      hasLocalData: false,
      totalRuns: 0,
      totalDistanceMeters: 0,
      totalTerritoryAreaM2: 0,
      achievementsUnlocked: 0,
    });
  });
});
