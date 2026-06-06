import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: jest.fn(async (key) => storage.get(key) ?? null),
    setItem: jest.fn(async (key, value) => storage.set(key, value)),
    removeItem: jest.fn(async (key) => storage.delete(key)),
  },
}));

const {
  LOCAL_METADATA_STORAGE_KEY,
  loadMetadata,
} = await import("../../../repositories/localMetadataRepository.js");
const {
  LOCAL_FIRST_REPOSITORY_MIGRATION_ID,
  runLocalMigrationsOnce,
} = await import("../storageMigrationService.js");

describe("storageMigrationService", () => {
  beforeEach(() => {
    storage.clear();
    storage.set("runs", JSON.stringify([{ id: "run-1" }]));
    storage.set("wayper_unsynced_runs_v2", JSON.stringify([{ id: "legacy-run" }]));
    jest.clearAllMocks();
  });

  test("migration roda uma vez e atualiza metadata", async () => {
    const first = await runLocalMigrationsOnce();
    const second = await runLocalMigrationsOnce();
    const metadata = await loadMetadata();

    expect(first).toMatchObject({
      id: LOCAL_FIRST_REPOSITORY_MIGRATION_ID,
      skipped: false,
      changed: true,
    });
    expect(second).toMatchObject({
      id: LOCAL_FIRST_REPOSITORY_MIGRATION_ID,
      skipped: true,
      changed: false,
    });
    expect(metadata.migrations[LOCAL_FIRST_REPOSITORY_MIGRATION_ID].completedAt).toBeTruthy();
    expect(metadata.domains.runs).toMatchObject({
      schemaVersion: 2,
      source: "runs",
      repository: "RunRepository",
    });
  });

  test("migration marca storages legados sem apagar dados", async () => {
    await runLocalMigrationsOnce();
    const metadata = await loadMetadata();

    expect(metadata.legacyStorages["wayper_unsynced_runs_v2"]).toMatchObject({
      deprecated: true,
      replacement: "runs",
    });
    expect(metadata.legacyStorages.zones).toMatchObject({
      deprecated: true,
      replacement: "wayper_territories_v1",
    });
    expect(storage.get("runs")).toBe(JSON.stringify([{ id: "run-1" }]));
    expect(storage.get("wayper_unsynced_runs_v2")).toBe(JSON.stringify([{ id: "legacy-run" }]));
    expect(storage.get(LOCAL_METADATA_STORAGE_KEY)).toBeTruthy();
  });
});
