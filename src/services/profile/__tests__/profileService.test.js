import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.useFakeTimers();

const PROFILE_KEY = "wayper_profile_v3";
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

jest.unstable_mockModule("../../../firebaseConfig.js", () => ({
  auth: { currentUser: { uid: "user-1" } },
  db: {},
}));

jest.unstable_mockModule("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
  setDoc: jest.fn(async () => {}),
  getDoc: jest.fn(async () => ({ exists: () => false })),
  serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
}));

jest.unstable_mockModule("../../../utils/pace.js", () => ({
  calculatePaceSecondsPerKm: jest.fn((seconds, km) => (km > 0 ? seconds / km : null)),
}));

const {
  saveProfile,
  clearProfileState,
  updateTerritoryProfileStats,
} = await import("../profileService.js");

function seedProfile(profile) {
  const now = new Date();
  const rankingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  storage.set(PROFILE_KEY, JSON.stringify({ rankingMonth, ...profile }));
}

describe("profileService.updateTerritoryProfileStats", () => {
  beforeEach(async () => {
    storage.clear();
    jest.clearAllMocks();
    jest.clearAllTimers();
    await clearProfileState();
  });

  test("soma area capturada", async () => {
    seedProfile({ totalArea: 100, monthlyArea: 40, totalZones: 2 });

    const result = await updateTerritoryProfileStats({ capturedAreaM2: 50, isActor: true });

    expect(result.totalArea).toBe(150);
    expect(result.monthlyArea).toBe(90);
  });

  test("soma area roubada", async () => {
    seedProfile({ totalStolenAreaM2: 20 });

    const result = await updateTerritoryProfileStats({ capturedAreaM2: 80, stolenAreaM2: 35, isActor: true });

    expect(result.totalStolenAreaM2).toBe(55);
    expect(result.territoryStealsCount).toBe(1);
  });

  test("soma cellsLedCount", async () => {
    seedProfile({ cellsLedCount: 3 });

    const result = await updateTerritoryProfileStats({ becameLeaderCount: 2, isActor: true });

    expect(result.cellsLedCount).toBe(5);
  });

  test("nao deixa valores negativos", async () => {
    seedProfile({ totalArea: 30, monthlyArea: 10, totalLostAreaM2: 5 });

    const result = await updateTerritoryProfileStats({ lostAreaM2: 80, isActor: false });

    expect(result.totalArea).toBe(0);
    expect(result.monthlyArea).toBe(0);
    expect(result.totalLostAreaM2).toBe(85);
  });

  test("mantem totalArea/monthlyArea compativeis", async () => {
    seedProfile({ totalArea: 20, monthlyArea: 5, totalZones: 1, territoryCapturesCount: 2 });

    const result = await updateTerritoryProfileStats({
      capturedAreaM2: 40,
      conqueredCount: 1,
      isActor: true,
    });

    expect(result.totalArea).toBe(60);
    expect(result.monthlyArea).toBe(45);
    expect(result.totalZones).toBe(2);
    expect(result.territoryCapturesCount).toBe(3);
    expect(result.territoryConqueredCount).toBe(1);
  });
});

test("local profile edit is durable before resolve, keeps username and progression, and propagates storage failure", async () => {
  await clearProfileState();
  seedProfile({ username: "original", xp: 20, level: 3, nextLevelXp: 150, totalRuns: 9, totalDistance: 1234, totalArea: 456, globalPoints: 789 });
  const result = await saveProfile({ displayName: "Novo", city: "Cidade", bio: "A\nB", isPrivate: true, profileVisibility: "private" }, { localOnly: true });
  expect(JSON.parse(storage.get(PROFILE_KEY))).toEqual(result);
  expect(result).toMatchObject({ username: "original", xp: 20, level: 3, totalRuns: 9, totalDistance: 1234, totalArea: 456, globalPoints: 789, city: "Cidade", bio: "A\nB" });
  await expect(saveProfile({ username: "other" })).rejects.toThrow("username_immutable");
  AsyncStorageMock.setItem.mockRejectedValueOnce(new Error("disk full"));
  await expect(saveProfile({ displayName: "Failure" }, { localOnly: true })).rejects.toThrow("disk full");
  expect(JSON.parse(storage.get(PROFILE_KEY)).displayName).toBe("Novo");
});

test("a queued progress flush cannot overwrite an edit awaiting its local write acknowledgement", async () => {
  await clearProfileState();
  jest.clearAllTimers();
  seedProfile({ displayName: "Original", totalRuns: 9 });
  await saveProfile({ totalRuns: 10 });
  let acknowledge;
  AsyncStorageMock.setItem.mockImplementationOnce((key, value) => {
    storage.set(key, value);
    return new Promise((resolve) => { acknowledge = resolve; });
  });
  const editing = saveProfile({ displayName: "Alterado" }, { localOnly: true });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  expect(acknowledge).toBeDefined();
  await jest.advanceTimersByTimeAsync(301);
  acknowledge();
  await editing;
  await jest.runOnlyPendingTimersAsync();
  expect(JSON.parse(storage.get(PROFILE_KEY))).toMatchObject({ displayName: "Alterado", totalRuns: 10 });
});
