import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
const loadLocalTerritories = jest.fn(async () => []);
const saveLocalTerritory = jest.fn(async (territory) => territory);
const loadLocalTerritoryEvents = jest.fn(async () => []);
const loadLocalTerritoryLeaderboards = jest.fn(async () => []);
const migrateLegacyZonesToTerritories = jest.fn(async () => ({ migrated: 0, skipped: 0 }));
const loadLocalZones = jest.fn(async () => []);
const saveLocalTerritoryEvent = jest.fn(async (event) => event);
const saveLocalTerritoryLeaderboard = jest.fn(async (leaderboard) => leaderboard);
const saveLocalTerritoryLeaderboards = jest.fn(async (leaderboards) => leaderboards);
const scheduleTerritoriesSync = jest.fn();
const scheduleTerritoryEventsSync = jest.fn();

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: jest.fn(async (key) => storage.get(key) ?? null),
    setItem: jest.fn(async (key, value) => storage.set(key, value)),
    removeItem: jest.fn(async (key) => storage.delete(key)),
  },
}));

jest.unstable_mockModule("../../utils/sync.js", () => ({
  loadLocalZones,
  scheduleTerritoriesSync,
  scheduleTerritoryEventsSync,
}));

jest.unstable_mockModule("../../services/territory/index.js", () => ({
  loadLocalTerritories,
  saveLocalTerritory,
  saveLocalTerritories: jest.fn(async (items) => items),
  removeLocalTerritory: jest.fn(async (id) => ({ id, status: "deleted" })),
  loadLocalTerritoryEvents,
  saveLocalTerritoryEvent,
  saveLocalTerritoryEvents: jest.fn(async (events) => events),
  loadLocalTerritoryLeaderboards,
  saveLocalTerritoryLeaderboard,
  saveLocalTerritoryLeaderboards,
  migrateLegacyZonesToTerritories,
  normalizeTerritoryPayload: jest.fn((territory) => ({
    status: "active",
    pendingSync: true,
    synced: false,
    version: 1,
    ...territory,
  })),
  normalizeTerritoryEventPayload: jest.fn((event) => ({
    type: "capture",
    pendingSync: true,
    synced: false,
    version: 1,
    ...event,
  })),
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
    scheduleTerritoriesSync.mockClear();
    scheduleTerritoryEventsSync.mockClear();
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

    expect(saveLocalTerritory).toHaveBeenCalledWith(
      expect.objectContaining({
        ...territory,
        localId: "territory-1",
        syncStatus: "PENDING",
        offlineStatus: "PENDING_SYNC",
      }),
      {}
    );
    expect(result.data).toMatchObject({
      id: "territory-1",
      geometry: { type: "Polygon" },
      zoneCoords: [{ latitude: 1, longitude: 2 }],
      areaM2: 300,
      localId: "territory-1",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
    });
  });

  test("atualiza territorio e agenda sync sem criar storage paralelo", async () => {
    loadLocalTerritories.mockResolvedValue([
      { id: "territory-1", geometry: { type: "Polygon" }, areaM2: 120, pendingSync: false, synced: true },
    ]);

    const result = await repository.update("territory-1", { areaM2: 180 });

    expect(saveLocalTerritory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "territory-1",
        areaM2: 180,
        pendingSync: true,
        synced: false,
      }),
      expect.objectContaining({ scheduleSync: true })
    );
    expect(scheduleTerritoriesSync).toHaveBeenCalled();
    expect(result.data.areaM2).toBe(180);
  });

  test("lista e salva eventos territoriais com identidade local", async () => {
    loadLocalTerritoryEvents.mockResolvedValue([
      { id: "event-1", territoryId: "territory-1", type: "capture", runId: "run-1" },
    ]);

    const list = await repository.listTerritoryEvents();
    const saved = await repository.saveTerritoryEvent({ id: "event-2", territoryId: "territory-1" }, { scheduleSync: true });

    expect(list.data[0]).toMatchObject({
      id: "event-1",
      localId: "event-1",
      runLocalId: "run-1",
      syncStatus: "PENDING",
    });
    expect(saved.data).toMatchObject({
      id: "event-2",
      localId: "event-2",
      territoryId: "territory-1",
    });
    expect(scheduleTerritoryEventsSync).toHaveBeenCalled();
  });

  test("lista e salva leaderboard cacheado", async () => {
    loadLocalTerritoryLeaderboards.mockResolvedValue([{ cellId: "cell-1", leaderUserId: "user-1" }]);

    const list = await repository.listLeaderboards();
    const saved = await repository.saveLeaderboardCache({ cellId: "cell-2", leaderUserId: "user-2" });
    const savedMany = await repository.saveLeaderboardCacheMany([{ cellId: "cell-3" }]);

    expect(list.data).toEqual([{ cellId: "cell-1", leaderUserId: "user-1" }]);
    expect(saved.data).toEqual({ cellId: "cell-2", leaderUserId: "user-2" });
    expect(savedMany.data).toEqual([{ cellId: "cell-3" }]);
  });

  test("resumo local soma apenas territorios atuais ativos", async () => {
    loadLocalTerritories.mockResolvedValue([
      { id: "territory-1", ownerId: "user-1", status: "active", areaM2: 100, cellIds: ["a", "b"], pendingSync: true },
      { id: "territory-2", ownerId: "user-1", status: "active", areaM2: 50, cellIds: ["b"], synced: true, pendingSync: false },
      { id: "territory-3", ownerId: "user-2", status: "active", areaM2: 999, cellIds: ["c"] },
      { id: "territory-4", ownerId: "user-1", status: "deleted", areaM2: 999, cellIds: ["d"] },
    ]);
    loadLocalTerritoryEvents.mockResolvedValue([{ id: "event-1" }]);
    loadLocalTerritoryLeaderboards.mockResolvedValue([{ cellId: "a" }]);

    const result = await repository.getLocalTerritorySummary({ userId: "user-1" });

    expect(result.data).toMatchObject({
      territoryCount: 2,
      totalAreaM2: 150,
      cellCount: 2,
      eventCount: 1,
      leaderboardCount: 1,
      pendingSyncCount: 1,
      source: "local",
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
