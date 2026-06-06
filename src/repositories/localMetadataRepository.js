import AsyncStorage from "@react-native-async-storage/async-storage";

export const LOCAL_METADATA_STORAGE_KEY = "wayper:localMetadata:v1";

const EMPTY_METADATA = {
  schemaVersion: 1,
  domains: {},
  migrations: {},
  legacyStorages: {},
  updatedAt: null,
};

function nowIso() {
  return new Date().toISOString();
}

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function normalizeMetadata(value = {}) {
  return {
    ...EMPTY_METADATA,
    ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
    domains: value?.domains && typeof value.domains === "object" && !Array.isArray(value.domains)
      ? value.domains
      : {},
    migrations: value?.migrations && typeof value.migrations === "object" && !Array.isArray(value.migrations)
      ? value.migrations
      : {},
    legacyStorages: value?.legacyStorages && typeof value.legacyStorages === "object" && !Array.isArray(value.legacyStorages)
      ? value.legacyStorages
      : {},
  };
}

export async function loadMetadata() {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_METADATA_STORAGE_KEY);
    return normalizeMetadata(safeParse(raw) || {});
  } catch {
    return { ...EMPTY_METADATA };
  }
}

export async function saveMetadata(patch = {}) {
  const existing = await loadMetadata();
  const next = normalizeMetadata({
    ...existing,
    ...patch,
    domains: { ...existing.domains, ...(patch.domains || {}) },
    migrations: { ...existing.migrations, ...(patch.migrations || {}) },
    legacyStorages: { ...existing.legacyStorages, ...(patch.legacyStorages || {}) },
    updatedAt: patch.updatedAt || nowIso(),
  });
  await AsyncStorage.setItem(LOCAL_METADATA_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function getDomainMetadata(domain) {
  const metadata = await loadMetadata();
  return metadata.domains?.[domain] || null;
}

export async function setDomainSchemaVersion(domain, schemaVersion, patch = {}) {
  const key = String(domain || "").trim();
  if (!key) throw new Error("missing_domain");

  const metadata = await loadMetadata();
  const now = nowIso();
  return saveMetadata({
    domains: {
      [key]: {
        ...(metadata.domains?.[key] || {}),
        ...patch,
        schemaVersion: Number(schemaVersion || 1),
        updatedAt: now,
      },
    },
  });
}

export async function hasMigrationRun(migrationId) {
  const metadata = await loadMetadata();
  return Boolean(metadata.migrations?.[migrationId]?.completedAt);
}

export async function markMigrationRun(migrationId, patch = {}) {
  const key = String(migrationId || "").trim();
  if (!key) throw new Error("missing_migration_id");

  const metadata = await loadMetadata();
  const now = nowIso();
  return saveMetadata({
    migrations: {
      [key]: {
        ...(metadata.migrations?.[key] || {}),
        ...patch,
        completedAt: patch.completedAt || now,
        updatedAt: now,
      },
    },
  });
}

export async function markLegacyStorage({ key, domain, replacement = null, reason = null } = {}) {
  const storageKey = String(key || "").trim();
  if (!storageKey) throw new Error("missing_legacy_storage_key");

  const metadata = await loadMetadata();
  const now = nowIso();
  return saveMetadata({
    legacyStorages: {
      [storageKey]: {
        ...(metadata.legacyStorages?.[storageKey] || {}),
        key: storageKey,
        domain: domain || "unknown",
        replacement,
        reason,
        deprecated: true,
        deprecatedAt: metadata.legacyStorages?.[storageKey]?.deprecatedAt || now,
        updatedAt: now,
      },
    },
  });
}

export async function listLegacyStorages() {
  const metadata = await loadMetadata();
  return Object.values(metadata.legacyStorages || {});
}

export default {
  LOCAL_METADATA_STORAGE_KEY,
  loadMetadata,
  saveMetadata,
  getDomainMetadata,
  setDomainSchemaVersion,
  hasMigrationRun,
  markMigrationRun,
  markLegacyStorage,
  listLegacyStorages,
};
