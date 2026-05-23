import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: jest.fn(async (key) => storage.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      storage.set(key, value);
    }),
    removeItem: jest.fn(async (key) => {
      storage.delete(key);
    }),
  },
}));

jest.unstable_mockModule("../../../firebaseConfig.js", () => ({
  auth: { currentUser: { uid: "current-user" } },
  db: {},
}));

const {
  buildTerritoryFromLegacyZone,
  migrateLegacyZonesToTerritories,
} = await import("../territoryMigrationService.js");
const {
  loadLocalTerritories,
  TERRITORIES_STORAGE_KEY,
} = await import("../territoryStorageService.js");

const legacyZone = {
  id: "zone-1",
  userId: "owner-1",
  area: 1500,
  date: "2026-01-01T10:00:00.000Z",
  coords: [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.004 },
    { latitude: 0.004, longitude: 0.004 },
    { latitude: 0.004, longitude: 0 },
  ],
};

describe("territoryMigrationService", () => {
  beforeEach(() => {
    storage.clear();
  });

  test("buildTerritoryFromLegacyZone cria territory valido", () => {
    const result = buildTerritoryFromLegacyZone(legacyZone);

    expect(result.ok).toBe(true);
    expect(result.territory).toMatchObject({
      ownerId: "owner-1",
      migratedFromZoneId: "zone-1",
      status: "active",
      source: "closed_loop",
      visibility: "followers",
      version: 1,
    });
    expect(result.territory.geometry.type).toBe("Polygon");
    expect(result.territory.areaM2).toBeGreaterThan(50);
    expect(result.territory.cellIds.length).toBeGreaterThan(0);
  });

  test("migrateLegacyZonesToTerritories dryRun nao salva", async () => {
    const result = await migrateLegacyZonesToTerritories({
      dryRun: true,
      includeRemote: false,
      legacyZones: [legacyZone],
    });

    expect(result).toMatchObject({
      dryRun: true,
      scanned: 1,
      migrated: 1,
      skipped: 0,
    });
    expect(await loadLocalTerritories()).toEqual([]);
  });

  test("migrateLegacyZonesToTerritories salva quando dryRun false", async () => {
    const result = await migrateLegacyZonesToTerritories({
      dryRun: false,
      includeRemote: false,
      legacyZones: [legacyZone],
    });

    const saved = await loadLocalTerritories();

    expect(result.migrated).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].migratedFromZoneId).toBe("zone-1");
    expect(storage.get(TERRITORIES_STORAGE_KEY)).toBeTruthy();
  });

  test("migracao evita duplicidade por zone id", async () => {
    await migrateLegacyZonesToTerritories({
      dryRun: false,
      includeRemote: false,
      legacyZones: [legacyZone],
    });

    const second = await migrateLegacyZonesToTerritories({
      dryRun: false,
      includeRemote: false,
      legacyZones: [legacyZone],
    });

    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await loadLocalTerritories()).toHaveLength(1);
  });

  test("migracao pula zona invalida", async () => {
    const result = await migrateLegacyZonesToTerritories({
      dryRun: true,
      includeRemote: false,
      legacyZones: [{ id: "bad", coords: [{ latitude: null, longitude: null }] }],
    });

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedDetails[0].reason).toBe("invalid_coords");
  });
});
