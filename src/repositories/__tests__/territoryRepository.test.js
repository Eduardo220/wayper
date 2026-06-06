import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
const loadLocalTerritories = jest.fn(async () => []);
const saveLocalTerritory = jest.fn(async (territory) => territory);
const loadLocalTerritoryEvents = jest.fn(async () => []);
const loadLocalTerritoryLeaderboards = jest.fn(async () => []);
const migrateLegacyZonesToTerritories = jest.fn(async () => ({ migrated: 0, skipped: 0 }));
const loadLocalZones = jest.fn(async () => []);

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: jest.fn(async (key) => storage.get(key) ?? null),
    setItem: jest.fn(async (key, value) => storage.set(key, value)),
    removeItem: jest.fn(async (key) => storage.delete(key)),
  },
}));

jest.unstable_mockModule("../../utils/sync.js", () => ({
  loadLocalZones,
}));

jest.unstable_mockModule("../../services/territory/index.js", () => ({
  loadLocalTerritories,
  saveLocalTerritory,
  saveLocalTerritories: jest.fn(async (items) => items),
  removeLocalTerritory: jest.fn(async (id) => ({ id, status: "deleted" })),
  loadLocalTerritoryEvents,
  saveLocalTerritoryEvent: jest.fn(async (event) => event),
  saveLocalTerritoryEvents: jest.fn(async (events) => events),
  loadLocalTerritoryLeaderboards,
  saveLocalTerritoryLeaderboard: jest.fn(async (leaderboard) => leaderboard),
  migrateLegacyZonesToTerritories,
}));

const repository = await import("../territoryRepository.js");

describe("territoryRepository", () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
    loadLocalTerritories.mockResolvedValue([]);
    loadLocalTerritoryEvents.mockResolvedValue([]);
    loadLocalTerritoryLeaderboards.mockResolvedValue([]);
    loadLocalZones.mockResolvedValue([]);
  });

  test("lista apenas o storage territorial atual", async () => {
    loadLocalTerritories.mockResolvedValue([
      { id: "territory-1", geometry: { type: "Polygon" }, areaM2: 120 },
    ]);
    loadLocalZones.mockResolvedValue([{ id: "legacy-zone" }]);

    const result = await repository.list();

    expect(loadLocalTerritories).toHaveBeenCalled();
    expect(loadLocalZones).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "local",
      data: [{ id: "territory-1", geometry: { type: "Polygon" }, areaM2: 120 }],
    });
  });

  test("legacy zones so entram por chamada explicita e marcada como deprecated", async () => {
    loadLocalZones.mockResolvedValue([{ id: "legacy-zone", zoneCoords: [1, 2, 3] }]);
    storage.set("@wayper_zones", JSON.stringify([{ id: "old-at-wayper" }]));

    const result = await repository.listLegacyZones({ includeAtWayperZones: true });

    expect(result.source).toBe("legacy");
    expect(result.deprecated).toBe(true);
    expect(result.data.map((item) => item.id)).toEqual(["legacy-zone", "old-at-wayper"]);
  });

  test("salva territorio preservando geometria, coords e area", async () => {
    const territory = {
      id: "territory-1",
      geometry: { type: "Polygon" },
      zoneCoords: [{ latitude: 1, longitude: 2 }],
      areaM2: 300,
    };

    const result = await repository.save(territory);

    expect(saveLocalTerritory).toHaveBeenCalledWith(territory, {});
    expect(result.data).toMatchObject({
      id: "territory-1",
      geometry: { type: "Polygon" },
      zoneCoords: [{ latitude: 1, longitude: 2 }],
      areaM2: 300,
    });
  });

  test("migracao legada e explicita e nao apaga storage antigo", async () => {
    migrateLegacyZonesToTerritories.mockResolvedValue({ dryRun: true, migrated: 1, skipped: 0 });

    const result = await repository.migrateLegacy({ dryRun: true, includeRemote: false });

    expect(migrateLegacyZonesToTerritories).toHaveBeenCalledWith({ dryRun: true, includeRemote: false });
    expect(result).toMatchObject({
      source: "legacy",
      deprecated: true,
      data: { dryRun: true, migrated: 1, skipped: 0 },
    });
  });
});
