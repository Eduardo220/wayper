// Temporary, best-effort recorder. Never await it from tracking or checkpoint code.
import { encodeUtf8, getNativeFileSystem } from "./logStorageService.js";
const DIRECTORY = "active-run-flight-recorder";
const MAX_RUN_FILES = 8;
const GPS_FLUSH_MS = 500;
const processId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const isTest = typeof process !== "undefined" && process.env?.NODE_ENV === "test";

let pending = [];
let timer = null;
let gpsTimer = false;
let queue = Promise.resolve();
let directoryPromise = null;
let lastError = null;
let testEntries = [];
let testWriteFailure = false;
let testFileSystem = null;
const prunedIds = new Set();

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pointMetrics(point) {
  if (!point) return null;
  const coords = point.coords || point;
  return {
    timestamp: numberOrNull(point.timestamp),
    accuracy: numberOrNull(coords.accuracy),
    speed: numberOrNull(coords.speed),
    bearing: numberOrNull(coords.heading ?? coords.bearing),
  };
}

async function directory() {
  if (!directoryPromise) directoryPromise = (async () => {
    const { Directory, File, Paths } = testFileSystem || await getNativeFileSystem();
    const root = new Directory(Paths.document, DIRECTORY);
    root.create({ intermediates: true, idempotent: true });
    return { root, File };
  })().catch((error) => {
    directoryPromise = null;
    throw error;
  });
  return directoryPromise;
}

async function appendBatch(batch) {
  if (isTest && !testFileSystem) {
    if (testWriteFailure) throw new Error("test_flight_write_failure");
    testEntries.push(...batch);
    return;
  }
  const { root, File } = await directory();
  const grouped = new Map();
  for (const entry of batch) {
    const lines = grouped.get(entry.localRunId) || [];
    lines.push(`${JSON.stringify(entry).replace(/[^\x00-\x7F]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`);
    grouped.set(entry.localRunId, lines);
  }
  for (const [id, lines] of grouped) {
    const file = new File(root, `${safeId(id)}.jsonl`);
    if (!file.exists) file.create({ intermediates: true });
    const handle = file.open();
    try {
      handle.offset = handle.size || 0;
      handle.writeBytes(encodeUtf8(lines.join("")));
    } finally {
      handle.close();
    }
  }
  const newIds = [...grouped.keys()].filter((id) => !prunedIds.has(id));
  if (newIds.length) {
    const files = root.list().filter((item) => item instanceof File && item.name.endsWith(".jsonl"));
    files.sort((a, b) => Number(b.modificationTime || 0) - Number(a.modificationTime || 0));
    const activeIds = new Set(batch.map((item) => `${safeId(item.localRunId)}.jsonl`));
    files.slice(MAX_RUN_FILES).forEach((file) => {
      if (!activeIds.has(file.name)) file.delete();
    });
    newIds.forEach((id) => prunedIds.add(id));
  }
}

function drain() {
  if (timer) clearTimeout(timer);
  timer = null;
  gpsTimer = false;
  const batch = pending;
  pending = [];
  if (!batch.length) return queue;
  const write = () => appendBatch(batch).then(() => {
    lastError = null;
  }).catch((error) => {
    lastError = error?.message || String(error);
    pending = [...batch, ...pending].slice(-2000);
  });
  queue = queue.then(write, write);
  return queue;
}

export function recordFlightEvent(event, context = {}) {
  try {
    const snapshot = context.snapshot || null;
    const localRunId = safeId(context.localRunId || snapshot?.localRunId || snapshot?.activeRunId || context.runId);
    if (!localRunId) return;
    const now = numberOrNull(context.wallMs) ?? Date.now();
    pending.push({
      event,
      wallTime: new Date(now).toISOString(),
      wallMs: now,
      monotonicMs: numberOrNull(context.monotonicMs) ?? (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : null),
      processId,
      localRunId,
      source: context.source || null,
      writer: context.writer || null,
      appState: context.appState || null,
      runState: snapshot?.status || context.runState || null,
      paused: snapshot?.status === "PAUSED" || context.paused === true,
      elapsedMs: numberOrNull(context.elapsedMs),
      distanceMeters: numberOrNull(snapshot?.distanceMeters ?? context.distanceMeters),
      point: pointMetrics(context.point),
      lastRaw: pointMetrics(context.lastRaw || snapshot?.lastRawPoint),
      lastAccepted: pointMetrics(context.lastAccepted || snapshot?.currentLocation),
      lastCheckpointAt: context.lastCheckpointAt || null,
      reason: context.reason || null,
      count: numberOrNull(context.count),
    });
    const highFrequency = event.startsWith("GPS_") || event === "HEADLESS_TASK_LOCATION";
    if (timer && gpsTimer && !highFrequency) {
      clearTimeout(timer);
      timer = null;
    }
    if (!timer) {
      gpsTimer = highFrequency;
      timer = setTimeout(drain, highFrequency ? GPS_FLUSH_MS : 0);
    }
  } catch {
    // Diagnostic work must never affect a run.
  }
}

export async function flushFlightRecorder() {
  await drain();
  return { lastError };
}

export async function getFlightRecorderFile(runId) {
  await flushFlightRecorder();
  if (lastError) throw new Error(`flight_recorder_write_failed: ${lastError}`);
  const { root, File } = await directory();
  const file = new File(root, `${safeId(runId)}.jsonl`);
  return file.exists ? file : null;
}

export async function getLastFlightRecorderFile() {
  return (await getRecentFlightRecorderFiles())[0] || null;
}

export async function getRecentFlightRecorderFiles() {
  await flushFlightRecorder();
  if (lastError) throw new Error(`flight_recorder_write_failed: ${lastError}`);
  const { root, File } = await directory();
  return root.list()
    .filter((item) => item instanceof File && item.name.endsWith(".jsonl"))
    .sort((a, b) => Number(b.modificationTime || 0) - Number(a.modificationTime || 0));
}

export async function __getFlightEntriesForTests() {
  await flushFlightRecorder();
  return [...testEntries];
}

export function __resetFlightRecorderForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  gpsTimer = false;
  pending = [];
  testEntries = [];
  queue = Promise.resolve();
  lastError = null;
  testWriteFailure = false;
  testFileSystem = null;
  directoryPromise = null;
  prunedIds.clear();
}

export function __setFlightWriteFailureForTests(value) {
  testWriteFailure = value === true;
}

export function __setFlightFileSystemForTests(value) {
  testFileSystem = value;
  directoryPromise = null;
}
