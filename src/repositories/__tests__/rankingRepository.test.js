import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
const fetchAllRanking = jest.fn(async () => []);
const fetchMonthlyRanking = jest.fn(async () => []);
const fetchWeeklyRanking = jest.fn(async () => []);
const fetchLocalLeadersRanking = jest.fn(async () => []);
const loadLocalTerritoryLeaderboards = jest.fn(async () => []);
const normalizeLocalLeaderRanking = jest.fn((leaderboards = []) =>
  leaderboards.map((item, index) => ({
    id: item.leaderUserId || `leader-${index}`,
    cellsLedCount: 1,
    leaderAreaM2: item.leaderAreaM2 || 0,
    rank: index + 1,
  }))
);
const saveProfile = jest.fn(async (patch) => patch);
const loadProfile = jest.fn(async () => ({
  uid: "user-1",
  displayName: "Local User",
  username: "local",
  avatar: "file://avatar.jpg",
}));
const getLocalProfileStats = jest.fn(async () => ({
  source: "local",
  userId: "user-1",
  hasLocalData: false,
  totalRuns: 0,
  totalDistanceMeters: 0,
  monthlyDistanceMeters: 0,
  totalTerritoryAreaM2: 0,
  monthlyAreaM2: 0,
  totalCapturedCells: 0,
  totalXp: 0,
  xp: 0,
  level: 1,
  pendingSyncCount: 0,
  progress: { userId: "user-1", totalXp: 0, xp: 0, level: 1 },
}));
const setDoc = jest.fn(async () => {});

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: jest.fn(async (key) => storage.get(key) ?? null),
    setItem: jest.fn(async (key, value) => storage.set(key, value)),
    removeItem: jest.fn(async (key) => storage.delete(key)),
  },
}));

jest.unstable_mockModule("../../firebaseConfig.js", () => ({
  auth: { currentUser: { uid: "user-1" } },
  db: {},
}));

jest.unstable_mockModule("firebase/firestore", () => ({
  doc: jest.fn((...parts) => ({ path: parts.join("/") })),
  serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
  setDoc,
}));

jest.unstable_mockModule("../../services/ranking/index.js", () => ({
  fetchAllRanking,
  fetchMonthlyRanking,
  fetchWeeklyRanking,
  fetchLocalLeadersRanking,
}));

jest.unstable_mockModule("../../services/ranking/constants.js", () => ({
  getRankingMonthKey: jest.fn(() => "2026-06"),
}));

jest.unstable_mockModule("../../services/ranking/ranking.localLeaders.js", () => ({
  normalizeLocalLeaderRanking,
}));

jest.unstable_mockModule("../../services/territory/index.js", () => ({
  loadLocalTerritoryLeaderboards,
}));

jest.unstable_mockModule("../../services/profile/profileService.js", () => ({
  loadProfile,
  saveProfile,
}));

jest.unstable_mockModule("../profileStats.js", () => ({
  getLocalProfileStats,
}));

const repository = await import("../rankingRepository.js");

describe("rankingRepository", () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
    fetchAllRanking.mockResolvedValue([]);
    fetchMonthlyRanking.mockResolvedValue([]);
    fetchWeeklyRanking.mockResolvedValue([]);
    fetchLocalLeadersRanking.mockResolvedValue([]);
    loadLocalTerritoryLeaderboards.mockResolvedValue([]);
    setDoc.mockResolvedValue(undefined);
    loadProfile.mockResolvedValue({
      uid: "user-1",
      displayName: "Local User",
      username: "local",
      avatar: "file://avatar.jpg",
    });
    getLocalProfileStats.mockResolvedValue({
      source: "local",
      userId: "user-1",
      hasLocalData: false,
      totalRuns: 0,
      totalDistanceMeters: 0,
      monthlyDistanceMeters: 0,
      totalTerritoryAreaM2: 0,
      monthlyAreaM2: 0,
      totalCapturedCells: 0,
      totalXp: 0,
      xp: 0,
      level: 1,
      pendingSyncCount: 0,
      progress: { userId: "user-1", totalXp: 0, xp: 0, level: 1 },
    });
    delete globalThis.__DEV__;
  });

  test("retorna ranking remoto e grava cache identificado", async () => {
    fetchMonthlyRanking.mockResolvedValue([{ id: "user-1", monthlyArea: 100 }]);

    const result = await repository.listRanking({
      period: "monthly",
      mode: "area",
      criterion: "area",
    });

    expect(fetchMonthlyRanking).toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "remote",
      data: [{ id: "user-1", monthlyArea: 100 }],
    });
    expect(storage.size).toBe(1);
  });

  test("usa cache quando remoto volta vazio e cache existe", async () => {
    fetchMonthlyRanking.mockResolvedValue([{ id: "cached-user", monthlyArea: 90 }]);
    await repository.listRanking({ period: "monthly", mode: "area", criterion: "area" });
    fetchMonthlyRanking.mockResolvedValue([]);

    const result = await repository.listRanking({ period: "monthly", mode: "area", criterion: "area" });

    expect(result.source).toBe("cache");
    expect(result.data).toEqual([{ id: "cached-user", monthlyArea: 90 }]);
    expect(result.updatedAt).toBeTruthy();
  });

  test("nao retorna demo/mock como ranking real", async () => {
    const result = await repository.listRanking({
      period: "monthly",
      mode: "area",
      criterion: "area",
      allowCache: false,
    });

    expect(result.source).toBe("empty");
    expect(result.data).toEqual([]);
  });

  test("lideres locais usam leaderboards locais quando remoto vazio", async () => {
    loadLocalTerritoryLeaderboards.mockResolvedValue([
      { cellId: "cell-1", leaderUserId: "leader-1", leaderAreaM2: 123 },
    ]);

    const result = await repository.listRanking({
      mode: "localLeaders",
      criterion: "localLeaders",
      period: "all",
    });

    expect(fetchLocalLeadersRanking).toHaveBeenCalled();
    expect(normalizeLocalLeaderRanking).toHaveBeenCalled();
    expect(result.source).toBe("local");
    expect(result.data[0]).toMatchObject({
      id: "leader-1",
      cellsLedCount: 1,
    });
  });

  test("usa ranking local por XP quando remoto e cache nao existem", async () => {
    getLocalProfileStats.mockResolvedValue({
      source: "local",
      userId: "user-1",
      hasLocalData: true,
      totalRuns: 2,
      totalDistanceMeters: 1500,
      totalTerritoryAreaM2: 0,
      totalCapturedCells: 0,
      totalXp: 180,
      xp: 80,
      level: 2,
      updatedAt: "2026-06-15T10:00:00.000Z",
      progress: { userId: "user-1", totalXp: 180, xp: 80, level: 2 },
    });

    const result = await repository.listRanking({
      period: "all",
      mode: "xp",
      criterion: "xp",
      allowCache: false,
    });

    expect(result.source).toBe("local");
    expect(result.limited).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        id: "user-1",
        name: "Local User",
        totalXp: 180,
        totalRuns: 2,
        localOnly: true,
      }),
    ]);
  });

  test("cache remoto preserva outros usuarios e atualiza linha local sem duplicar", async () => {
    fetchAllRanking.mockResolvedValue([
      { id: "user-1", totalXp: 20, xp: 20 },
      { id: "other", totalXp: 40, xp: 40 },
    ]);
    await repository.listRanking({ period: "all", mode: "xp", criterion: "xp" });
    fetchAllRanking.mockResolvedValue([]);
    getLocalProfileStats.mockResolvedValue({
      source: "local",
      userId: "user-1",
      hasLocalData: true,
      totalRuns: 3,
      totalDistanceMeters: 2000,
      totalTerritoryAreaM2: 0,
      totalCapturedCells: 0,
      totalXp: 90,
      xp: 90,
      level: 2,
      updatedAt: "2026-06-15T10:00:00.000Z",
      progress: { userId: "user-1", totalXp: 90, xp: 90, level: 2 },
    });

    const result = await repository.listRanking({ period: "all", mode: "xp", criterion: "xp" });

    expect(result.source).toBe("cache");
    expect(result.localOverlay).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data.find((item) => item.id === "user-1")).toMatchObject({
      totalXp: 90,
      localOverlay: true,
    });
  });

  test("demo so aparece quando pedido explicitamente em dev", async () => {
    globalThis.__DEV__ = true;

    const result = await repository.listRanking({
      period: "all",
      mode: "distance",
      criterion: "distance",
      allowCache: false,
      allowDemo: true,
    });

    expect(result.source).toBe("demo");
    expect(result.data.every((item) => item.demo === true && item.source === "demo")).toBe(true);
  });

  test("persistMyMonthlyPreview salva local antes do remoto", async () => {
    const result = await repository.persistMyMonthlyPreview(
      [{ id: "user-1", rank: 3 }],
      { uid: "user-1", period: "monthly", mode: "distance" }
    );

    expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      bestMonthlyRankDistance: 3,
      bestMonthlyRank: 3,
      rankingMonth: "2026-06",
    }));
    expect(setDoc).toHaveBeenCalled();
    expect(result.source).toBe("remote");
  });
});
