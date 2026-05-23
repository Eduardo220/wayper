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
