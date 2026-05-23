import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
const profile = {
  xp: 0,
  monthlyPoints: 0,
  globalPoints: 0,
};

const AsyncStorageMock = {
  getItem: jest.fn(async (key) => storage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => {
    storage.set(key, value);
  }),
  removeItem: jest.fn(async (key) => {
    storage.delete(key);
  }),
};

const updateTerritoryProfileStats = jest.fn(async () => profile);
const loadProfile = jest.fn(async () => profile);
const saveProfile = jest.fn(async (patch = {}) => {
  Object.assign(profile, patch);
  return profile;
});
const incrementRankingPoints = jest.fn(async (xp = 0) => {
  profile.monthlyPoints += xp;
  profile.globalPoints += xp;
  return profile;
});

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
}));

jest.unstable_mockModule("../../../firebaseConfig.js", () => ({
  auth: { currentUser: { uid: "user-1" } },
  db: {},
}));

jest.unstable_mockModule("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
  setDoc: jest.fn(async () => {}),
  serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
}));

jest.unstable_mockModule("../../profile/profileService.js", () => ({
  updateTerritoryProfileStats,
  loadProfile,
  saveProfile,
  incrementRankingPoints,
  updateProfileStats: jest.fn(async () => profile),
}));

const { awardTerritoryXP } = await import("../xpService.js");

describe("xpService.awardTerritoryXP", () => {
  beforeEach(() => {
    storage.clear();
    profile.xp = 0;
    profile.monthlyPoints = 0;
    profile.globalPoints = 0;
    jest.clearAllMocks();
  });

  test("calcula XP territorial", async () => {
    const result = await awardTerritoryXP({
      capturedAreaM2: 1500,
      newAreaM2: 900,
      runId: "run-1",
      territoryId: "territory-1",
    }, { persist: false });

    expect(result.xp).toBeGreaterThan(0);
    expect(result.computed.components.xpFromArea).toBe(100);
  });

  test("aplica bonus de lideranca", async () => {
    const result = await awardTerritoryXP({
      capturedAreaM2: 150,
      becameLeaderCount: 2,
      runId: "run-2",
      territoryId: "territory-2",
    }, { persist: false });

    expect(result.computed.components.leaderBonus).toBe(240);
  });

  test("aplica bonus de roubo", async () => {
    const result = await awardTerritoryXP({
      capturedAreaM2: 150,
      stolenAreaM2: 400,
      runId: "run-3",
      territoryId: "territory-3",
    }, { persist: false });

    expect(result.computed.components.xpFromStolen).toBe(40);
  });

  test("mantem idempotencia por runId/territoryId", async () => {
    const first = await awardTerritoryXP({
      capturedAreaM2: 1500,
      runId: "run-4",
      territoryId: "territory-4",
    }, { persist: false });
    const second = await awardTerritoryXP({
      capturedAreaM2: 1500,
      runId: "run-4",
      territoryId: "territory-4",
    }, { persist: false });

    expect(first.xp).toBeGreaterThan(0);
    expect(second).toMatchObject({ xp: 0, reason: "already_awarded" });
    expect(updateTerritoryProfileStats).toHaveBeenCalledTimes(1);
  });

  test("respeita limite maximo", async () => {
    const result = await awardTerritoryXP({
      capturedAreaM2: 900000,
      stolenAreaM2: 900000,
      becameLeaderCount: 50,
      conqueredCount: 50,
      runId: "run-5",
      territoryId: "territory-5",
    }, { persist: false });

    expect(result.xp).toBe(20000);
  });

  test("nao quebra com area zero", async () => {
    const result = await awardTerritoryXP({
      capturedAreaM2: 0,
      runId: "run-6",
      territoryId: "territory-6",
    }, { persist: false });

    expect(result.xp).toBe(0);
    expect(result.error).toBeUndefined();
  });
});
