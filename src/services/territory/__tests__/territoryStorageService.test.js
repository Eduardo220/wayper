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

const {
  TERRITORIES_STORAGE_KEY,
  loadLocalTerritories,
  loadLocalTerritoryEvents,
  normalizeTerritoryForRemote,
  removeLocalTerritory,
  saveLocalTerritory,
  saveLocalTerritoryEvent,
} = await import("../territoryStorageService.js");

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-51.001, -30.001],
      [-51.001, -29.999],
      [-50.999, -29.999],
      [-50.999, -30.001],
      [-51.001, -30.001],
    ],
  ],
};

describe("territoryStorageService", () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
  });

  test("saveLocalTerritory salva territorio", async () => {
    const saved = await saveLocalTerritory({
      id: "territory-1",
      geometry: polygon,
      areaM2: 100,
    });

    expect(saved).toMatchObject({
      id: "territory-1",
      version: 1,
      pendingSync: true,
      status: "active",
    });
    expect(AsyncStorageMock.setItem).toHaveBeenCalled();
  });

  test("loadLocalTerritories retorna territorio salvo", async () => {
    await saveLocalTerritory({ id: "territory-1", geometry: polygon });

    const territories = await loadLocalTerritories();

    expect(territories).toHaveLength(1);
    expect(territories[0].id).toBe("territory-1");
  });

  test("saveLocalTerritory deduplica por id", async () => {
    await saveLocalTerritory({ id: "territory-1", geometry: polygon, areaM2: 100 });
    await saveLocalTerritory({ id: "territory-1", geometry: polygon, areaM2: 150 });

    const territories = await loadLocalTerritories();

    expect(territories).toHaveLength(1);
    expect(territories[0].areaM2).toBe(150);
    expect(territories[0].version).toBe(2);
  });

  test("removeLocalTerritory marca territorio como deleted", async () => {
    await saveLocalTerritory({ id: "territory-1", geometry: polygon });

    const removed = await removeLocalTerritory("territory-1");
    const territories = await loadLocalTerritories();

    expect(removed).toMatchObject({
      id: "territory-1",
      status: "deleted",
      pendingSync: true,
    });
    expect(territories[0].status).toBe("deleted");
  });

  test("saveLocalTerritoryEvent salva evento", async () => {
    const saved = await saveLocalTerritoryEvent({
      id: "event-1",
      territoryId: "territory-1",
      type: "capture",
    });

    expect(saved).toMatchObject({
      id: "event-1",
      territoryId: "territory-1",
      type: "capture",
      pendingSync: true,
    });
  });

  test("loadLocalTerritoryEvents retorna eventos", async () => {
    await saveLocalTerritoryEvent({
      id: "event-1",
      territoryId: "territory-1",
      type: "capture",
    });

    const events = await loadLocalTerritoryEvents();

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("event-1");
  });

  test("funcoes nao quebram com AsyncStorage vazio", async () => {
    await expect(loadLocalTerritories()).resolves.toEqual([]);
    await expect(loadLocalTerritoryEvents()).resolves.toEqual([]);
  });

  test("payload remoto e normalizado antes de salvar", () => {
    const payload = normalizeTerritoryForRemote({
      id: "territory-1",
      geometry: polygon,
      pendingSync: true,
      synced: false,
      syncConflict: true,
    });

    expect(payload).toMatchObject({
      id: "territory-1",
      version: 1,
      status: "active",
      geometry: expect.objectContaining({ type: "Polygon" }),
      bbox: expect.any(Array),
      center: expect.objectContaining({
        latitude: expect.any(Number),
        longitude: expect.any(Number),
      }),
    });
    expect(payload.pendingSync).toBeUndefined();
    expect(payload.synced).toBeUndefined();
    expect(payload.syncConflict).toBeUndefined();
  });

  test("loadLocalTerritories ignora storage corrompido", async () => {
    storage.set(TERRITORIES_STORAGE_KEY, "{bad-json");

    await expect(loadLocalTerritories()).resolves.toEqual([]);
  });
});

