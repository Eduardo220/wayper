import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDiagnosticsConfig } from "../../config/diagnosticsConfig.js";

export const DIAGNOSTIC_LOGS_STORAGE_KEY = "wayper:diagnosticLogs:v1";
export const DIAGNOSTIC_ROOT_DIRECTORY = "wayper-diagnostics";

const DEFAULT_FLUSH_DELAY_MS = 750;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_RECENT_RUNS = 12;
const CHANNEL_FILES = Object.freeze({
  events: "events.ndjson",
  gps: "gps.ndjson",
  storage: "storage.ndjson",
  lifecycle: "lifecycle.ndjson",
  notification: "notification.ndjson",
});

const isTestEnvironment =
  typeof process !== "undefined" && process.env?.NODE_ENV === "test";

let testStorage = isTestEnvironment ? AsyncStorage : null;
let writeQueue = Promise.resolve();
let lastStorageError = null;
let pendingLogs = [];
let pendingResolvers = [];
let pendingMaxStoredLogs = null;
let flushTimer = null;
let recentLogsCache = [];
let cacheLoaded = false;
let nativeFileSystemPromise = null;
let directoriesPromise = null;
let logDirectoryCache = new Map();
let flushCount = 0;

function normalizeLimit(limit, fallback) {
  const value = Number(limit);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sanitizeRunId(runId) {
  return String(runId || "global")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120) || "global";
}

function matchesFilters(log = {}, filters = {}) {
  if (filters.level && log.level !== filters.level) return false;
  if (filters.category && log.category !== filters.category) return false;
  if (filters.sessionId && log.sessionId !== filters.sessionId) return false;
  if (filters.runId) {
    const ids = [log.runId, log.localRunId, log.context?.runId, log.context?.localRunId]
      .filter(Boolean)
      .map(String);
    if (!ids.includes(String(filters.runId))) return false;
  }
  if (filters.localRunId) {
    const ids = [log.localRunId, log.runId, log.context?.localRunId, log.context?.runId]
      .filter(Boolean)
      .map(String);
    if (!ids.includes(String(filters.localRunId))) return false;
  }
  if (filters.minLevel) {
    const priority = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
    if ((priority[log.level] ?? 0) < (priority[filters.minLevel] ?? 0)) return false;
  }
  if (filters.since && Date.parse(log.timestamp) < Date.parse(filters.since)) return false;
  if (filters.until && Date.parse(log.timestamp) > Date.parse(filters.until)) return false;
  if (filters.search) {
    const needle = String(filters.search).toLowerCase();
    const haystack = `${log.event || ""} ${log.message || ""} ${JSON.stringify(log.context || {})}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function parseNdjson(raw = "") {
  return String(raw || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function resolveRunId(log = {}) {
  return log.runId || log.localRunId || log.context?.runId || log.context?.localRunId || null;
}

function getChannelsForLog(log = {}) {
  const channels = new Set(["events"]);
  const category = String(log.category || "").toUpperCase();
  const event = String(log.event || "").toUpperCase();

  if (category === "LOCATION" || event.includes("GPS") || event.includes("LOCATION_POINT")) {
    channels.add("gps");
  }
  if (
    category === "STORAGE" ||
    event.includes("STORAGE") ||
    event.includes("CHUNK") ||
    event.includes("CHECKPOINT") ||
    event.includes("FLUSH")
  ) {
    channels.add("storage");
  }
  if (
    category === "APP_STATE" ||
    category === "BACKGROUND" ||
    category === "RUN_RECOVERY" ||
    event.includes("WATCHER") ||
    event.includes("BACKGROUND_TASK") ||
    event.includes("RECONCILE") ||
    event.includes("APP_ACTIVE") ||
    event.includes("APP_BACKGROUND") ||
    event.includes("SCREEN_FOCUS") ||
    event.includes("SCREEN_BLUR")
  ) {
    channels.add("lifecycle");
  }
  if (category === "NOTIFICATION" || event.includes("NOTIFICATION")) {
    channels.add("notification");
  }
  return [...channels];
}

async function getNativeFileSystem() {
  if (!nativeFileSystemPromise) {
    nativeFileSystemPromise = import("expo-file-system").then((module) => ({
      Directory: module.Directory,
      File: module.File,
      Paths: module.Paths,
    }));
  }
  return nativeFileSystemPromise;
}

async function getDirectories() {
  if (!directoriesPromise) {
    directoriesPromise = (async () => {
      const { Directory, Paths } = await getNativeFileSystem();
      const root = new Directory(Paths.document, DIAGNOSTIC_ROOT_DIRECTORY);
      root.create({ intermediates: true, idempotent: true });
      const runs = new Directory(root, "runs");
      runs.create({ intermediates: true, idempotent: true });
      const global = new Directory(root, "global");
      global.create({ intermediates: true, idempotent: true });
      return { root, runs, global };
    })().catch((error) => {
      directoriesPromise = null;
      throw error;
    });
  }
  return directoriesPromise;
}

async function getLogDirectory(runId = null) {
  const { Directory } = await getNativeFileSystem();
  const directories = await getDirectories();
  if (!runId) return directories.global;
  const key = sanitizeRunId(runId);
  const cached = logDirectoryCache.get(key);
  if (cached?.exists) return cached;
  const runDirectory = new Directory(directories.runs, key);
  runDirectory.create({ intermediates: true, idempotent: true });
  logDirectoryCache.set(key, runDirectory);
  return runDirectory;
}

function encodeUtf8(value) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);
  return Uint8Array.from(String(value), (character) => character.charCodeAt(0));
}

async function rotateFileIfNeeded(directory, filename, incomingBytes) {
  const { File } = await getNativeFileSystem();
  const current = new File(directory, filename);
  if (!current.exists || current.size + incomingBytes <= MAX_FILE_BYTES) return current;

  const rotated = new File(directory, filename.replace(/\.ndjson$/, ".1.ndjson"));
  if (rotated.exists) rotated.delete();
  current.move(rotated);
  return new File(directory, filename);
}

async function appendText(directory, filename, text) {
  const bytes = encodeUtf8(text);
  const file = await rotateFileIfNeeded(directory, filename, bytes.length);
  if (!file.exists) file.create({ intermediates: true });
  const handle = file.open();
  try {
    handle.offset = handle.size || 0;
    handle.writeBytes(bytes);
  } finally {
    handle.close();
  }
}

async function writeBatchToFiles(batch = []) {
  const grouped = new Map();
  for (const log of batch) {
    const runId = resolveRunId(log);
    for (const channel of getChannelsForLog(log)) {
      const key = `${runId || "global"}::${channel}`;
      const current = grouped.get(key) || { runId, channel, lines: [] };
      current.lines.push(`${JSON.stringify(log)}\n`);
      grouped.set(key, current);
    }
  }

  for (const group of grouped.values()) {
    const directory = await getLogDirectory(group.runId);
    await appendText(directory, CHANNEL_FILES[group.channel], group.lines.join(""));
  }
}

async function readTestLogs() {
  if (!testStorage) return [];
  try {
    const raw = await testStorage.getItem(DIAGNOSTIC_LOGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    lastStorageError = error;
    return [];
  }
}

async function writeTestLogs(logs = []) {
  try {
    await testStorage.setItem(DIAGNOSTIC_LOGS_STORAGE_KEY, JSON.stringify(logs));
    return true;
  } catch (error) {
    lastStorageError = error;
    return false;
  }
}

function sortDirectoryItemsByModified(items = []) {
  return [...items].sort((left, right) => {
    const leftTime = Number(left.modificationTime || left.info?.()?.modificationTime || 0);
    const rightTime = Number(right.modificationTime || right.info?.()?.modificationTime || 0);
    return rightTime - leftTime;
  });
}

async function listRunDirectories() {
  const { Directory } = await getNativeFileSystem();
  const { runs } = await getDirectories();
  return sortDirectoryItemsByModified(runs.list().filter((item) => item instanceof Directory));
}

async function readChannelFromDirectory(directory, channel = "events") {
  const { File } = await getNativeFileSystem();
  const filename = CHANNEL_FILES[channel] || CHANNEL_FILES.events;
  const rotated = new File(directory, filename.replace(/\.ndjson$/, ".1.ndjson"));
  const current = new File(directory, filename);
  const parts = [];
  if (rotated.exists) parts.push(await rotated.text());
  if (current.exists) parts.push(await current.text());
  return parts.filter(Boolean).join(parts.length > 1 ? "\n" : "");
}

async function loadRecentLogsFromFiles() {
  const config = getDiagnosticsConfig();
  const limit = normalizeLimit(config.maxStoredLogs, 1000);
  const { global } = await getDirectories();
  const runDirectories = (await listRunDirectories()).slice(0, MAX_RECENT_RUNS);
  const all = [];

  for (const directory of [...runDirectories.reverse(), global]) {
    all.push(...parseNdjson(await readChannelFromDirectory(directory, "events")));
  }

  return all
    .sort((left, right) => Date.parse(left.timestamp || 0) - Date.parse(right.timestamp || 0))
    .slice(-limit);
}

async function ensureCacheLoaded() {
  if (cacheLoaded) return recentLogsCache;
  const storedLogs = testStorage ? await readTestLogs() : await loadRecentLogsFromFiles();
  const byId = new Map();
  [...storedLogs, ...recentLogsCache].forEach((log) => {
    byId.set(log.id || `${log.timestamp}:${log.event}:${byId.size}`, log);
  });
  const limit = normalizeLimit(getDiagnosticsConfig().maxStoredLogs, 1000);
  recentLogsCache = [...byId.values()]
    .sort((left, right) => Date.parse(left.timestamp || 0) - Date.parse(right.timestamp || 0))
    .slice(-limit);
  cacheLoaded = true;
  return recentLogsCache;
}

function resolvePendingResolvers(value) {
  const resolvers = pendingResolvers;
  pendingResolvers = [];
  resolvers.forEach((resolve) => {
    try {
      resolve(value);
    } catch {}
  });
}

export function appendLog(log = {}, options = {}) {
  pendingLogs.push(log);
  const config = getDiagnosticsConfig();
  const maxStoredLogs = normalizeLimit(options.maxStoredLogs, config.maxStoredLogs || 1000);
  pendingMaxStoredLogs = pendingMaxStoredLogs == null
    ? maxStoredLogs
    : Math.min(pendingMaxStoredLogs, maxStoredLogs);
  const flushPromise = new Promise((resolve) => pendingResolvers.push(resolve));
  const flushDelayMs = ["warn", "error", "fatal"].includes(log.level)
    ? 0
    : normalizeLimit(options.flushDelayMs, DEFAULT_FLUSH_DELAY_MS);

  if (flushDelayMs === 0 && flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
    flushPendingLogs();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPendingLogs();
    }, flushDelayMs);
  }

  return flushPromise;
}

function flushPendingLogs() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const batch = pendingLogs;
  const requestedMaxStoredLogs = pendingMaxStoredLogs;
  pendingLogs = [];
  pendingMaxStoredLogs = null;
  if (batch.length === 0) {
    resolvePendingResolvers(null);
    return writeQueue;
  }

  const task = async () => {
    try {
      const config = getDiagnosticsConfig();
      const maxStoredLogs = normalizeLimit(requestedMaxStoredLogs, config.maxStoredLogs || 1000);
      const current = testStorage ? await ensureCacheLoaded() : recentLogsCache;
      const next = [...current, ...batch].slice(-maxStoredLogs);
      const saved = testStorage
        ? await writeTestLogs(next)
        : await writeBatchToFiles(batch).then(() => true);

      if (saved) {
        recentLogsCache = next;
        if (testStorage) cacheLoaded = true;
        flushCount += 1;
      }
      const result = saved ? batch[batch.length - 1] : null;
      resolvePendingResolvers(result);
      return result;
    } catch (error) {
      lastStorageError = error;
      resolvePendingResolvers(null);
      return null;
    }
  };

  writeQueue = writeQueue.then(task, task).catch((error) => {
    lastStorageError = error;
    resolvePendingResolvers(null);
    return null;
  });
  return writeQueue;
}

export async function getLogs(filters = {}) {
  if (pendingLogs.length > 0) await flushPendingLogs();
  await writeQueue.catch(() => null);
  const logs = await ensureCacheLoaded();
  const filtered = logs.filter((log) => matchesFilters(log, filters));
  const limit = normalizeLimit(filters.limit, 0);
  return limit > 0 ? filtered.slice(-limit) : filtered;
}

export async function getDiagnosticNdjson(options = {}) {
  if (pendingLogs.length > 0) await flushPendingLogs();
  await writeQueue.catch(() => null);
  const channels = Object.keys(CHANNEL_FILES);

  if (testStorage) {
    const logs = await getLogs(options.runId ? { runId: options.runId } : {});
    return Object.fromEntries(channels.map((channel) => {
      const selected = channel === "events"
        ? logs
        : logs.filter((log) => getChannelsForLog(log).includes(channel));
      return [CHANNEL_FILES[channel], selected.map((log) => JSON.stringify(log)).join("\n")];
    }));
  }

  const { global } = await getDirectories();
  let directories = [];
  if (options.runId) {
    directories = [await getLogDirectory(options.runId)];
  } else if (options.includeAllRecent) {
    directories = [...(await listRunDirectories()).slice(0, MAX_RECENT_RUNS).reverse(), global];
  } else {
    const latest = (await listRunDirectories())[0];
    directories = latest ? [latest] : [global];
  }

  const output = {};
  for (const channel of channels) {
    const contents = [];
    for (const directory of directories) {
      const value = await readChannelFromDirectory(directory, channel);
      if (value) contents.push(value);
    }
    output[CHANNEL_FILES[channel]] = contents.join("\n");
  }
  return output;
}

export async function getRecentDiagnosticRunIds(limit = MAX_RECENT_RUNS) {
  if (testStorage) {
    const logs = await getLogs();
    return [...new Set(logs.map(resolveRunId).filter(Boolean))].slice(-limit).reverse();
  }
  const directories = await listRunDirectories();
  return directories.slice(0, normalizeLimit(limit, MAX_RECENT_RUNS)).map((directory) => directory.name);
}

export async function getLastDiagnosticRunId() {
  const [runId] = await getRecentDiagnosticRunIds(1);
  return runId || null;
}

export async function getDiagnosticStorageHealth() {
  let location = null;
  try {
    if (!testStorage) {
      const { root } = await getDirectories();
      location = root.uri;
    }
  } catch (error) {
    lastStorageError = error;
  }
  return {
    backend: testStorage ? "test-storage" : "file-system",
    location,
    pendingLogs: pendingLogs.length,
    flushCount,
    lastStorageError: lastStorageError?.message || null,
    maxFileBytes: MAX_FILE_BYTES,
    maxRecentRuns: MAX_RECENT_RUNS,
  };
}

export async function clearOldLogs(options = {}) {
  if (testStorage) return clearLogs();
  if (pendingLogs.length > 0) await flushPendingLogs();
  await writeQueue.catch(() => null);

  const maxAgeDays = normalizeLimit(options.maxAgeDays, 14);
  const keepRecentRuns = normalizeLimit(options.keepRecentRuns, 3);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const directories = await listRunDirectories();
  let removed = 0;

  directories.forEach((directory, index) => {
    const modifiedAt = Number(directory.modificationTime || directory.info?.()?.modificationTime || 0);
    if (index >= keepRecentRuns && (!modifiedAt || modifiedAt < cutoff)) {
      directory.delete();
      removed += 1;
    }
  });

  recentLogsCache = [];
  cacheLoaded = false;
  return { removed, kept: Math.max(0, directories.length - removed) };
}

export async function clearLogs() {
  pendingLogs = [];
  pendingMaxStoredLogs = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  resolvePendingResolvers(null);

  writeQueue = writeQueue.then(async () => {
    try {
      if (testStorage) {
        await testStorage.removeItem(DIAGNOSTIC_LOGS_STORAGE_KEY);
      } else {
        const { Directory, Paths } = await getNativeFileSystem();
        const root = new Directory(Paths.document, DIAGNOSTIC_ROOT_DIRECTORY);
        if (root.exists) root.delete();
        directoriesPromise = null;
        logDirectoryCache = new Map();
        await getDirectories();
      }
      recentLogsCache = [];
      cacheLoaded = true;
      return true;
    } catch (error) {
      lastStorageError = error;
      return false;
    }
  }, async () => false);
  return writeQueue;
}

export async function exportLogs(filters = {}) {
  return JSON.stringify(await getLogs(filters), null, 2);
}

export function getRecentLogs(limit = 100) {
  return getLogs({ limit });
}

export function getLogsByRunId(runId) {
  return getLogs({ runId });
}

export function getLogsByCategory(category) {
  return getLogs({ category });
}

export function getErrorLogs() {
  return getLogs({ minLevel: "error" });
}

export async function getLogsSummary() {
  const logs = await getLogs();
  const byLevel = logs.reduce((acc, log) => {
    acc[log.level] = (acc[log.level] || 0) + 1;
    return acc;
  }, {});
  const byCategory = logs.reduce((acc, log) => {
    acc[log.category] = (acc[log.category] || 0) + 1;
    return acc;
  }, {});
  return {
    count: logs.length,
    byLevel,
    byCategory,
    lastLogAt: logs[logs.length - 1]?.timestamp || null,
    ...(await getDiagnosticStorageHealth()),
  };
}

export function __setLogStorageBackendForTests(nextStorage) {
  testStorage = nextStorage || AsyncStorage;
  cacheLoaded = false;
  recentLogsCache = [];
}

export function __resetLogStorageForTests() {
  testStorage = AsyncStorage;
  writeQueue = Promise.resolve();
  lastStorageError = null;
  pendingLogs = [];
  pendingResolvers = [];
  pendingMaxStoredLogs = null;
  recentLogsCache = [];
  cacheLoaded = false;
  directoriesPromise = null;
  logDirectoryCache = new Map();
  flushCount = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export async function __flushLogWritesForTests() {
  if (pendingLogs.length > 0) await flushPendingLogs();
  await writeQueue.catch(() => null);
}

export default {
  DIAGNOSTIC_LOGS_STORAGE_KEY,
  DIAGNOSTIC_ROOT_DIRECTORY,
  appendLog,
  clearLogs,
  clearOldLogs,
  exportLogs,
  getDiagnosticNdjson,
  getDiagnosticStorageHealth,
  getErrorLogs,
  getLastDiagnosticRunId,
  getLogs,
  getLogsByCategory,
  getLogsByRunId,
  getLogsSummary,
  getRecentDiagnosticRunIds,
  getRecentLogs,
};
