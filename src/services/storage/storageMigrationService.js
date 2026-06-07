import {
  hasMigrationRun,
  markLegacyStorage,
  markMigrationRun,
  setDomainSchemaVersion,
} from "../../repositories/localMetadataRepository.js";

export const LOCAL_FIRST_REPOSITORY_MIGRATION_ID = "local-first-repositories-v1";

export const LEGACY_STORAGE_MARKERS = [
  {
    key: "wayper_unsynced_runs_v2",
    domain: "runs",
    replacement: "runs",
    reason: "runService.js legacy queue; official run sync queue uses the runs key via sync.js",
  },
  {
    key: "wayper_runs_cache_v2",
    domain: "runs",
    replacement: "runs",
    reason: "runService.js legacy cache; official history uses sync.loadLocalRunHistory",
  },
  {
    key: "wayper_active_run_v1",
    domain: "activeRun",
    replacement: "wayper:activeRun:v2",
    reason: "legacy active run state from runService.js",
  },
  {
    key: "wayper_active_offline_run_v1",
    domain: "activeRun",
    replacement: "wayper:activeRun:v2",
    reason: "compatibility checkpoint only; recovery migrates live state to the canonical snapshot",
  },
  ...[
    { key: "zones", domain: "territory", replacement: "wayper_territories_v1" },
    { key: "@wayper_zones", domain: "territory", replacement: "wayper_territories_v1" },
  ].map((item) => ({
    ...item,
    reason: "legacy zones storage; territoryRepository keeps current territories separate from explicit legacy migration",
  })),
];

export async function runLocalMigrationsOnce() {
  const alreadyRan = await hasMigrationRun(LOCAL_FIRST_REPOSITORY_MIGRATION_ID);
  if (alreadyRan) {
    return {
      id: LOCAL_FIRST_REPOSITORY_MIGRATION_ID,
      skipped: true,
      changed: false,
    };
  }

  const domains = [
    ["runs", 2, { source: "runs", repository: "RunRepository" }],
    ["activeRun", 2, { source: "wayper:activeRun:v2", repository: "activeRunTrackingService" }],
    ["territory", 1, { source: "wayper_territories_v1", repository: "TerritoryRepository" }],
    ["profile", 3, { source: "wayper_profile_v3", repository: "UserProfileRepository" }],
    ["ranking", 1, { source: "remote-or-cache", repository: "RankingRepository" }],
    ["progression", 1, { source: "wayper_user_progress_v1", repository: "ProgressionRepository" }],
    ["achievements", 1, { source: "wayper_achievements_v1", repository: "AchievementRepository" }],
  ];

  for (const [domain, version, patch] of domains) {
    await setDomainSchemaVersion(domain, version, patch);
  }

  for (const marker of LEGACY_STORAGE_MARKERS) {
    await markLegacyStorage(marker);
  }

  await markMigrationRun(LOCAL_FIRST_REPOSITORY_MIGRATION_ID, {
    domains: domains.map(([domain]) => domain),
    legacyStorages: LEGACY_STORAGE_MARKERS.map((item) => item.key),
  });

  return {
    id: LOCAL_FIRST_REPOSITORY_MIGRATION_ID,
    skipped: false,
    changed: true,
    domains: domains.map(([domain]) => domain),
    legacyStorages: LEGACY_STORAGE_MARKERS.map((item) => item.key),
  };
}

export default {
  LOCAL_FIRST_REPOSITORY_MIGRATION_ID,
  LEGACY_STORAGE_MARKERS,
  runLocalMigrationsOnce,
};
