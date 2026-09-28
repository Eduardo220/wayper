import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let currentUser = {
  uid: "user-1",
  displayName: "Lara Wayper",
  email: "lara@example.com",
  photoURL: null,
};

const getActiveRunSnapshot = jest.fn(async () => null);
const listRuns = jest.fn(async () => ({ data: [], source: "local", error: null }));
const listTerritories = jest.fn(async () => ({ data: [], source: "local", error: null }));
const getProgressSummary = jest.fn(async () => ({
  userId: "user-1",
  totalXp: 0,
  xp: 0,
  level: 1,
  nextLevelXp: 100,
  progressToNextLevel: 0,
  progressToNextLevelPct: 0,
}));
const getUserProgress = jest.fn(async () => ({
  userId: "user-1",
  totalXp: 0,
  xp: 0,
  level: 1,
  nextLevelXp: 100,
}));
const listAchievements = jest.fn(async () => []);
const listRanking = jest.fn(async () => ({ data: [], source: "empty", error: null }));
const listPending = jest.fn(async () => ({ data: [], source: "local", error: null }));
const retry = jest.fn(async () => ({ data: { processed: 1 }, source: "remote", error: null }));
const loadCurrentProfile = jest.fn(async () => ({
  data: {
    profile: { uid: "user-1", displayName: "Lara Wayper", username: "lara" },
    userDoc: { uid: "user-1", name: "Lara Wayper", username: "lara" },
  },
  source: "local",
  error: null,
}));

jest.unstable_mockModule("../../firebaseConfig.js", () => ({
  auth: {
    get currentUser() {
      return currentUser;
    },
  },
}));

jest.unstable_mockModule("../../services/runTracking/activeRunTrackingService.js", () => ({
  default: {
    getActiveRunSnapshot,
  },
}));

jest.unstable_mockModule("../../services/runTracking/activeRunState.js", () => ({
  ACTIVE_RUN_STATUS: {
    RUNNING: "RUNNING",
    PAUSED: "PAUSED",
    RECOVERING: "RECOVERING",
    ERROR_RECOVERABLE: "ERROR_RECOVERABLE",
  },
}));

jest.unstable_mockModule("../runRepository.js", () => ({
  default: {
    list: listRuns,
  },
  list: listRuns,
}));

jest.unstable_mockModule("../territoryRepository.js", () => ({
  default: {
    list: listTerritories,
  },
  list: listTerritories,
}));

jest.unstable_mockModule("../progressionRepository.js", () => ({
  getProgressSummary,
  getUserProgress,
}));

jest.unstable_mockModule("../achievementRepository.js", () => ({
  listAchievements,
}));

jest.unstable_mockModule("../rankingRepository.js", () => ({
  RANKING_SOURCE: {
    REMOTE: "remote",
    CACHE: "cache",
    LOCAL: "local",
    DEMO: "demo",
    EMPTY: "empty",
  },
  listRanking,
}));

jest.unstable_mockModule("../runSyncQueueRepository.js", () => ({
  default: {
    listPending,
    retry,
  },
  listPending,
  retry,
}));

jest.unstable_mockModule("../userProfileRepository.js", () => ({
  loadCurrentProfile,
}));

const repository = await import("../homeDashboardRepository.js");

const finishedRun = (patch = {}) => ({
  id: "run-1",
  localRunId: "run-1",
  userId: "user-1",
  status: "completed",
  offlineStatus: "LOCAL_ONLY",
  mode: "free",
  distance: 1000,
  distanceMeters: 1000,
  duration: 600,
  durationSeconds: 600,
  date: "2026-06-10T10:00:00.000Z",
  finishedAt: "2026-06-10T10:00:00.000Z",
  ...patch,
});

describe("homeDashboardRepository", () => {
  beforeEach(() => {
    currentUser = {
      uid: "user-1",
      displayName: "Lara Wayper",
      email: "lara@example.com",
      photoURL: null,
    };
    jest.clearAllMocks();

    getActiveRunSnapshot.mockResolvedValue(null);
    listRuns.mockResolvedValue({ data: [], source: "local", error: null });
    listTerritories.mockResolvedValue({ data: [], source: "local", error: null });
    getProgressSummary.mockResolvedValue({
      userId: "user-1",
      totalXp: 0,
      xp: 0,
      level: 1,
      nextLevelXp: 100,
      progressToNextLevel: 0,
      progressToNextLevelPct: 0,
    });
    getUserProgress.mockResolvedValue({
      userId: "user-1",
      totalXp: 0,
      xp: 0,
      level: 1,
      nextLevelXp: 100,
    });
    listAchievements.mockResolvedValue([]);
    listRanking.mockResolvedValue({ data: [], source: "empty", error: null });
    listPending.mockResolvedValue({ data: [], source: "local", error: null });
    retry.mockResolvedValue({ data: { processed: 1 }, source: "remote", error: null });
    loadCurrentProfile.mockResolvedValue({
      data: {
        profile: { uid: "user-1", displayName: "Lara Wayper", username: "lara" },
        userDoc: { uid: "user-1", name: "Lara Wayper", username: "lara" },
      },
      source: "local",
      error: null,
    });
  });

  test("carrega perfil, progresso, estatisticas, territorio, ranking e sync locais", async () => {
    getActiveRunSnapshot.mockResolvedValue({
      activeRunId: "active-1",
      status: "PAUSED",
      mode: "free",
      distanceMeters: 430,
      durationSeconds: 120,
      startedAt: "2026-06-15T08:00:00.000Z",
      updatedAt: "2026-06-15T08:02:00.000Z",
    });
    listRuns.mockResolvedValue({
      data: [
        finishedRun({ id: "active-1", localRunId: "active-1", status: "PAUSED" }),
        finishedRun({
          id: "run-free",
          localRunId: "run-free",
          offlineStatus: "PENDING_SYNC",
          distanceMeters: 1000,
          durationSeconds: 600,
          finishedAt: "2026-06-10T10:00:00.000Z",
        }),
        finishedRun({
          id: "run-zone",
          localRunId: "run-zone",
          mode: "zones",
          syncStatus: "SYNCED",
          offlineStatus: "SYNCED",
          distanceMeters: 2200,
          durationSeconds: 1320,
          areaM2: 450,
          finishedAt: "2026-06-15T10:00:00.000Z",
        }),
        finishedRun({ id: "other-user", localRunId: "other-user", userId: "user-2" }),
      ],
      source: "local",
      error: null,
    });
    listTerritories.mockResolvedValue({
      data: [
        {
          id: "territory-1",
          ownerId: "user-1",
          areaM2: 800,
          cellIds: ["a", "b"],
          syncStatus: "PENDING",
          updatedAt: "2026-06-15T11:00:00.000Z",
        },
        { id: "territory-other", ownerId: "user-2", areaM2: 9000, cellIds: ["x"] },
      ],
      source: "local",
      error: null,
    });
    getProgressSummary.mockResolvedValue({
      userId: "user-1",
      totalXp: 240,
      xp: 40,
      level: 3,
      nextLevelXp: 200,
      progressToNextLevel: 0.2,
      progressToNextLevelPct: 20,
      totalTerritoryAreaM2: 800,
      totalCapturedCells: 2,
    });
    listAchievements.mockResolvedValue([
      {
        id: "first_run_completed",
        userId: "user-1",
        title: "Primeira corrida",
        unlocked: true,
        unlockedAt: "2026-06-15T12:00:00.000Z",
      },
      { id: "total_distance_5k", userId: "user-1", unlocked: false },
    ]);
    listRanking.mockResolvedValue({
      data: [{ id: "user-1", totalXp: 240 }],
      source: "local",
      limited: true,
      error: null,
    });
    listPending.mockResolvedValue({
      data: [{ id: "run-free" }],
      source: "local",
      error: null,
    });

    const result = await repository.loadHomeDashboard({
      now: new Date("2026-06-16T12:00:00.000Z"),
    });

    expect(loadCurrentProfile).toHaveBeenCalled();
    expect(listRanking).toHaveBeenCalledWith(expect.objectContaining({ allowDemo: false }));
    expect(result.profile).toMatchObject({ uid: "user-1", name: "Lara Wayper", username: "lara" });
    expect(result.activeRun).toMatchObject({
      hasActiveRun: true,
      activeRunId: "active-1",
      status: "PAUSED",
      actionLabel: "Retomar corrida",
    });
    expect(result.stats).toMatchObject({
      totalRuns: 2,
      freeRuns: 1,
      zoneRuns: 1,
      totalDistanceMeters: 3200,
      pendingRunSyncCount: 1,
      pendingTerritorySyncCount: 1,
      totalXp: 240,
      level: 3,
      achievementsUnlocked: 1,
    });
    expect(result.lastRun).toMatchObject({
      id: "run-zone",
      mode: "zones",
      territoryAreaM2: 450,
      syncLabel: "Local/sincronizada",
    });
    expect(result.territory).toMatchObject({
      totalAreaM2: 800,
      territoryCount: 1,
      capturedCells: 2,
    });
    expect(result.ranking).toMatchObject({
      source: "local",
      hasRealData: true,
      myRank: 1,
      limited: true,
    });
    expect(result.sync).toMatchObject({
      pendingRuns: 1,
      pendingTerritories: 1,
      pendingTotal: 2,
      queueCount: 1,
      retryAvailable: true,
    });
    expect(result.states).toMatchObject({
      isNewUser: false,
      hasRuns: true,
      hasXp: true,
      hasTerritory: true,
      hasRanking: true,
      hasSyncIssues: true,
    });
  });

  test("mantem dados locais quando perfil remoto ou ranking falham", async () => {
    const profileError = new Error("firestore offline");
    const rankingError = new Error("ranking offline");
    loadCurrentProfile.mockResolvedValue({
      data: {
        profile: { uid: "user-1", displayName: "Perfil Local", username: "local" },
        userDoc: null,
      },
      source: "local",
      error: profileError,
    });
    listRuns.mockResolvedValue({
      data: [finishedRun({ id: "run-local", localRunId: "run-local" })],
      source: "local",
      error: null,
    });
    listRanking.mockRejectedValue(rankingError);

    const result = await repository.loadHomeDashboard();

    expect(result.profile).toMatchObject({ name: "Perfil Local", username: "local" });
    expect(result.profileSource).toBe("local");
    expect(result.stats.totalRuns).toBe(1);
    expect(result.lastRun.id).toBe("run-local");
    expect(result.ranking).toMatchObject({ source: "empty", hasRealData: false });
    expect(result.errors.profile).toBe(profileError);
    expect(result.errors.ranking).toBe(rankingError);
  });

  test("retorna estado vazio util para usuario novo", async () => {
    const result = await repository.loadHomeDashboard();

    expect(result.states).toMatchObject({
      isNewUser: true,
      hasRuns: false,
      hasXp: false,
      hasTerritory: false,
      hasRanking: false,
      hasSyncIssues: false,
    });
    expect(result.lastRun).toBeNull();
    expect(result.territory.totalAreaM2).toBe(0);
    expect(result.ranking.hasRealData).toBe(false);
    expect(result.activeRun.actionLabel).toBe("Iniciar corrida");
  });

  test("nao inventa territorio para corrida livre", async () => {
    listRuns.mockResolvedValue({
      data: [
        finishedRun({
          id: "free-with-legacy-area",
          localRunId: "free-with-legacy-area",
          mode: "free",
          areaM2: 9999,
        }),
      ],
      source: "local",
      error: null,
    });

    const result = await repository.loadHomeDashboard();

    expect(result.stats.totalRuns).toBe(1);
    expect(result.stats.totalTerritoryAreaM2).toBe(0);
    expect(result.territory.totalAreaM2).toBe(0);
    expect(result.lastRun).toMatchObject({
      id: "free-with-legacy-area",
      mode: "free",
      territoryAreaM2: 0,
    });
  });

  test("ranking demo nunca vira dado real da Home", async () => {
    listRanking.mockResolvedValue({
      data: [{ id: "demo-user", totalXp: 999, rank: 1, demo: true }],
      source: "demo",
      demo: true,
      error: null,
    });

    const result = await repository.loadHomeDashboard();

    expect(listRanking).toHaveBeenCalledWith(expect.objectContaining({ allowDemo: false }));
    expect(result.ranking).toMatchObject({
      source: "demo",
      demo: true,
      hasRealData: false,
    });
  });

  test("retry usa somente a fila oficial de sync", async () => {
    await repository.retryHomeRunSync();

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
