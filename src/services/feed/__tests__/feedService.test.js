import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
let getDocsShouldThrow = false;
let localRuns = [];
let localTerritories = [];

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: jest.fn(async (key) => storage.get(key) ?? null),
    setItem: jest.fn(async (key, value) => storage.set(key, value)),
    removeItem: jest.fn(async (key) => storage.delete(key)),
  },
}));

jest.unstable_mockModule("firebase/firestore", () => ({
  collection: jest.fn((...parts) => ({ path: parts.join("/") })),
  doc: jest.fn((...parts) => ({ path: parts.join("/") })),
  getDoc: jest.fn(async () => ({ exists: () => false, data: () => ({}) })),
  getDocs: jest.fn(async () => {
    if (getDocsShouldThrow) throw new Error("firestore offline");
    return {
      docs: [],
      forEach: jest.fn(),
    };
  }),
  limit: jest.fn((value) => ({ type: "limit", value })),
  orderBy: jest.fn((field, direction) => ({ type: "orderBy", field, direction })),
  query: jest.fn((...args) => args),
  where: jest.fn((field, op, value) => ({ type: "where", field, op, value })),
}));

jest.unstable_mockModule("../../../firebaseConfig.js", () => ({
  auth: {
    currentUser: {
      uid: "user-1",
      displayName: "Ana Local",
      email: "ana@example.com",
      photoURL: null,
    },
  },
  db: {},
}));

jest.unstable_mockModule("../../../utils/sync.js", () => ({
  default: {
    loadLocalRuns: jest.fn(async () => localRuns),
  },
}));

jest.unstable_mockModule("../../territory/territoryStorageService.js", () => ({
  loadLocalTerritories: jest.fn(async () => localTerritories),
}));

jest.unstable_mockModule("../feedPostActionsService.js", () => ({
  getMutedFeedAuthorIds: jest.fn(async () => []),
}));

const { loadHomeFeedData } = await import("../feedService.js");

describe("feedService", () => {
  beforeEach(() => {
    storage.clear();
    delete global.__DEV__;
    getDocsShouldThrow = false;
    localRuns = [];
    localTerritories = [];
    jest.clearAllMocks();
  });

  test("usa territorios locais atuais quando Firestore falha", async () => {
    getDocsShouldThrow = true;
    localTerritories = [
      {
        id: "territory-1",
        ownerId: "user-1",
        areaM2: 120,
        coordsPreview: [
          { latitude: -23.56, longitude: -46.64 },
          { latitude: -23.56, longitude: -46.63 },
          { latitude: -23.55, longitude: -46.63 },
        ],
        createdAt: "2026-06-05T10:00:00.000Z",
      },
    ];

    const result = await loadHomeFeedData({ limit: 10 });

    expect(result.usedFallback).toBe(true);
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]).toMatchObject({
      id: "territory-1",
      type: "zone",
      userId: "user-1",
      areaM2: 120,
    });
    expect(result.activities[0].polygon).toHaveLength(3);
  });

  test("nao cria atividade demo quando remoto e storage local estao vazios", async () => {
    getDocsShouldThrow = true;
    global.__DEV__ = true;

    const result = await loadHomeFeedData({ limit: 10 });

    expect(result.usedFallback).toBe(true);
    expect(result.source).toBe("empty");
    expect(result.activities).toEqual([]);
    expect(result.friends).toEqual([]);
  });
});
