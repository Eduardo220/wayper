import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDiagnosticsConfig } from "../../config/diagnosticsConfig.js";

export const DIAGNOSTIC_LOGS_STORAGE_KEY = "wayper:diagnosticLogs:v1";

let storage = AsyncStorage;
let writeQueue = Promise.resolve();
let lastStorageError = null;

function safeParseLogs(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readLogs() {
  try {
    return safeParseLogs(await storage.getItem(DIAGNOSTIC_LOGS_STORAGE_KEY));
  } catch (error) {
    lastStorageError = error;
    return [];
  }
}

async function writeLogs(logs = []) {
  try {
    await storage.setItem(DIAGNOSTIC_LOGS_STORAGE_KEY, JSON.stringify(logs));
    return true;
  } catch (error) {
    lastStorageError = error;
    return false;
  }
}

function normalizeLimit(limit, fallback) {
  const value = Number(limit);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function matchesFilters(log = {}, filters = {}) {
  if (filters.level && log.level !== filters.level) return false;
  if (filters.category && log.category !== filters.category) return false;
  if (filters.sessionId && log.sessionId !== filters.sessionId) return false;
  if (filters.runId) {
    const ids = [log.runId, log.localRunId, log.context?.runId, log.context?.localRunId].filter(Boolean).map(String);
    if (!ids.includes(String(filters.runId))) return false;
  }
  if (filters.localRunId) {
    const ids = [log.localRunId, log.runId, log.context?.localRunId, log.context?.runId].filter(Boolean).map(String);
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

export function appendLog(log = {}, options = {}) {
  const task = async () => {
    try {
      const config = getDiagnosticsConfig();
      const maxStoredLogs = normalizeLimit(options.maxStoredLogs, config.maxStoredLogs || 1000);
      const current = await readLogs();
      const next = [...current, log].slice(-maxStoredLogs);
      const saved = await writeLogs(next);
      return saved ? log : null;
    } catch (error) {
      lastStorageError = error;
      return null;
    }
  };

  writeQueue = writeQueue.then(task, task).catch((error) => {
    lastStorageError = error;
    return null;
  });
  return writeQueue;
}

export async function getLogs(filters = {}) {
  const logs = await readLogs();
  const filtered = logs.filter((log) => matchesFilters(log, filters));
  const limit = normalizeLimit(filters.limit, 0);
  return limit > 0 ? filtered.slice(-limit) : filtered;
}

export async function clearLogs() {
  writeQueue = writeQueue.then(async () => {
    try {
      await storage.removeItem(DIAGNOSTIC_LOGS_STORAGE_KEY);
      return true;
    } catch (error) {
      lastStorageError = error;
      return false;
    }
  }, async () => false);
  return writeQueue;
}

export async function exportLogs(filters = {}) {
  const logs = await getLogs(filters);
  return JSON.stringify(logs, null, 2);
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
  const logs = await readLogs();
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
    lastStorageError: lastStorageError?.message || null,
  };
}

export function __setLogStorageBackendForTests(nextStorage) {
  storage = nextStorage || AsyncStorage;
}

export function __resetLogStorageForTests() {
  storage = AsyncStorage;
  writeQueue = Promise.resolve();
  lastStorageError = null;
}

export async function __flushLogWritesForTests() {
  await writeQueue.catch(() => null);
}

export default {
  DIAGNOSTIC_LOGS_STORAGE_KEY,
  appendLog,
  clearLogs,
  exportLogs,
  getErrorLogs,
  getLogs,
  getLogsByCategory,
  getLogsByRunId,
  getLogsSummary,
  getRecentLogs,
};
