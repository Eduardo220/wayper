import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import logger, { LOG_CATEGORIES, sanitizeLogContext } from "../../utils/logger.js";
import {
  recordRunEvent,
  recordRunSnapshotEvent,
} from "../diagnostics/runDiagnosticsService.js";

export const RUN_DEFERRED_TASK_QUEUE_KEY = "wayper_run_deferred_tasks_v1";
export const RUN_DEFERRED_TASK_SCHEMA_VERSION = 2;
export const EXPEDITION_PROCESSING_SCHEMA_VERSION = 1;

export const RUN_DEFERRED_TASK_TYPE = Object.freeze({
  RUN_FULL_SAVE_FINALIZE: "RUN_FULL_SAVE_FINALIZE",
  RUN_REMOTE_SYNC: "RUN_REMOTE_SYNC",
  RUN_TERRITORY_CAPTURE: "RUN_TERRITORY_CAPTURE",
  RUN_XP_UPDATE: "RUN_XP_UPDATE",
  RUN_RANKING_UPDATE: "RUN_RANKING_UPDATE",
  RUN_FEED_UPDATE: "RUN_FEED_UPDATE",
  RUN_DIAGNOSTIC_FULL_EXPORT_READY: "RUN_DIAGNOSTIC_FULL_EXPORT_READY",
  RUN_CLEANUP_TEMP_FILES: "RUN_CLEANUP_TEMP_FILES",
  RUN_RETRY_FAILED_PROCESSING: "RUN_RETRY_FAILED_PROCESSING",
});

export const RUN_DEFERRED_TASK_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED_RETRYABLE: "failed_retryable",
  FAILED_PERMANENT: "failed_permanent",
  CANCELLED: "cancelled",
});

export const EXPEDITION_PROCESSING_MODULE = Object.freeze({
  METRICS: "metrics",
  TERRITORY: "territory",
  PROGRESSION: "progression",
  RANKING: "ranking",
  SOCIAL: "social",
  SYNC: "sync",
  CHALLENGES: "challenges",
  REWARDS: "rewards",
});

export const EXPEDITION_PROCESSING_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  READY: "ready",
  FAILED_RETRYABLE: "failed_retryable",
  FAILED_PERMANENT: "failed_permanent",
  NOT_APPLICABLE: "not_applicable",
  CANCELLED: "cancelled",
});

const TASK_MODULE_BY_TYPE = Object.freeze({
  [RUN_DEFERRED_TASK_TYPE.RUN_FULL_SAVE_FINALIZE]: EXPEDITION_PROCESSING_MODULE.METRICS,
  [RUN_DEFERRED_TASK_TYPE.RUN_TERRITORY_CAPTURE]: EXPEDITION_PROCESSING_MODULE.TERRITORY,
  [RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE]: EXPEDITION_PROCESSING_MODULE.PROGRESSION,
  [RUN_DEFERRED_TASK_TYPE.RUN_RANKING_UPDATE]: EXPEDITION_PROCESSING_MODULE.RANKING,
  [RUN_DEFERRED_TASK_TYPE.RUN_FEED_UPDATE]: EXPEDITION_PROCESSING_MODULE.SOCIAL,
  [RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC]: EXPEDITION_PROCESSING_MODULE.SYNC,
});

const TERMINAL_STATUSES = new Set([
  RUN_DEFERRED_TASK_STATUS.SUCCEEDED,
  RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT,
  RUN_DEFERRED_TASK_STATUS.CANCELLED,
]);

const READY_STATUSES = new Set([
  RUN_DEFERRED_TASK_STATUS.PENDING,
  RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE,
]);

const LIVE_ACTIVE_RUN_STATUSES = new Set([
  "STARTING",
  "RUNNING",
  "PAUSED",
  "RECOVERING",
  "ERROR_RECOVERABLE",
  "FINISHING",
]);

const ROUTE_PAYLOAD_KEYS = new Set([
  "path",
  "rawPath",
  "rawPoints",
  "trustedPath",
  "filteredPoints",
  "renderPath",
  "displayPath",
  "displayPoints",
  "segments",
  "routeSegments",
  "coords",
  "coordinates",
  "geometry",
  "routeGeometry",
]);

const DEFAULT_MAX_ATTEMPTS = 5;
const RUNNING_RECOVERY_TIMEOUT_MS = 45 * 1000;
const AUTO_PROCESS_INTERVAL_MS = 60 * 1000;
const MAX_STORED_TASKS = 250;

let isProcessingQueue = false;
let autoProcessTimer = null;
let netInfoUnsubscribe = null;
let appStateUnsubscribe = null;

const nowIso = () => new Date().toISOString();

function safeParse(raw, fallback = []) {
  try {
    const parsed = raw ? JSON.parse(raw) : fallback;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function toTimestamp(value, fallback = Date.now()) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function toIso(value, fallback = nowIso()) {
  const timestamp = toTimestamp(value, NaN);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function safeIdPart(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 96);
}

function resolveRunId(input = {}) {
  return String(
    input.runId ||
    input.localRunId ||
    input.id ||
    input.remoteRunId ||
    input.payload?.runId ||
    input.payload?.localRunId ||
    ""
  );
}

function getTaskId(type, runId) {
  return `postrun:${safeIdPart(runId)}:${safeIdPart(type).toLowerCase()}`;
}

function getIdempotencyKey(type, runId) {
  return `${type}:${runId}`;
}

function getDefaultPriority(type) {
  switch (type) {
    case RUN_DEFERRED_TASK_TYPE.RUN_FULL_SAVE_FINALIZE:
      return 10;
    case RUN_DEFERRED_TASK_TYPE.RUN_TERRITORY_CAPTURE:
      return 20;
    case RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE:
      return 30;
    case RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC:
      return 40;
    case RUN_DEFERRED_TASK_TYPE.RUN_RANKING_UPDATE:
    case RUN_DEFERRED_TASK_TYPE.RUN_FEED_UPDATE:
      return 50;
    case RUN_DEFERRED_TASK_TYPE.RUN_DIAGNOSTIC_FULL_EXPORT_READY:
    case RUN_DEFERRED_TASK_TYPE.RUN_CLEANUP_TEMP_FILES:
      return 60;
    default:
      return 100;
  }
}

function getDefaultMaxAttempts(type) {
  if (type === RUN_DEFERRED_TASK_TYPE.RUN_TERRITORY_CAPTURE) return 4;
  if (type === RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC) return 6;
  if (type === RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE) return 4;
  return DEFAULT_MAX_ATTEMPTS;
}

function sanitizeError(error) {
  return sanitizeLogContext({
    message: error?.message || String(error || "unknown_error"),
    code: error?.code || null,
    reason: error?.reason || null,
    retryable: error?.retryable !== false,
    permanent: error?.permanent === true,
  });
}

function summarizeRunForQueueResult(run = {}) {
  return {
    runId: run.runId || run.localRunId || run.id || null,
    localRunId: run.localRunId || run.id || null,
    remoteRunId: run.remoteRunId || null,
    status: run.status || null,
    syncStatus: run.syncStatus || null,
    offlineStatus: run.offlineStatus || null,
    territoryCaptureStatus: run.territoryCaptureStatus || null,
    distanceMeters: Number(run.distanceMeters ?? run.distance ?? 0),
    durationSeconds: Number(run.durationSeconds ?? run.duration ?? 0),
    areaM2: Number(run.areaM2 ?? run.area ?? 0),
    updatedAt: run.updatedAt || null,
  };
}

function sanitizeQueuePayload(payload = {}) {
  const output = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (ROUTE_PAYLOAD_KEYS.has(key)) {
      output[`${key}Count`] = Array.isArray(value) ? value.length : value ? 1 : 0;
      return;
    }
    if (Array.isArray(value)) {
      output[key] = value
        .filter((item) => ["string", "number", "boolean"].includes(typeof item))
        .slice(0, 20);
      output[`${key}Count`] = value.length;
      return;
    }
    if (value && typeof value === "object") {
      if (key === "run") {
        output[key] = sanitizeLogContext(summarizeRunForQueueResult(value));
        return;
      }
      if (key === "lastResult") {
        output[key] = sanitizeQueuePayload(value);
        return;
      }
      output[key] = sanitizeLogContext(value);
      return;
    }
    if (value !== undefined) output[key] = value;
  });
  return sanitizeLogContext(output);
}

function normalizeTask(input = {}) {
  const type = String(input.type || "").trim();
  const runId = resolveRunId(input);
  if (!type || !runId) return null;

  const createdAt = toIso(input.createdAt, nowIso());
  const updatedAt = toIso(input.updatedAt, createdAt);
  const status = Object.values(RUN_DEFERRED_TASK_STATUS).includes(input.status)
    ? input.status
    : RUN_DEFERRED_TASK_STATUS.PENDING;

  return {
    id: input.id || getTaskId(type, runId),
    runId,
    localRunId: input.localRunId || input.payload?.localRunId || runId,
    remoteRunId: input.remoteRunId || input.payload?.remoteRunId || null,
    type,
    status,
    createdAt,
    updatedAt,
    attempts: Math.max(0, Number(input.attempts || 0) || 0),
    maxAttempts: Math.max(1, Number(input.maxAttempts || getDefaultMaxAttempts(type)) || DEFAULT_MAX_ATTEMPTS),
    nextRunAt: toIso(input.nextRunAt, createdAt),
    lastStartedAt: input.lastStartedAt || null,
    lastFinishedAt: input.lastFinishedAt || null,
    lastError: input.lastError ? sanitizeError(input.lastError) : null,
    payload: sanitizeQueuePayload(input.payload || {}),
    idempotencyKey: input.idempotencyKey || getIdempotencyKey(type, runId),
    priority: Number(input.priority ?? getDefaultPriority(type)) || getDefaultPriority(type),
    dependencies: Array.isArray(input.dependencies) ? input.dependencies.map(String).filter(Boolean) : [],
    metadata: sanitizeQueuePayload(input.metadata || {}),
    result: input.result
      ? sanitizeQueuePayload(input.result)
      : input.metadata?.lastResult
        ? sanitizeQueuePayload(input.metadata.lastResult)
        : null,
    resultVersion: Math.max(1, Number(input.resultVersion || 1) || 1),
    schemaVersion: Math.max(
      RUN_DEFERRED_TASK_SCHEMA_VERSION,
      Number(input.schemaVersion || RUN_DEFERRED_TASK_SCHEMA_VERSION)
    ),
  };
}

async function loadQueueRaw() {
  const raw = await AsyncStorage.getItem(RUN_DEFERRED_TASK_QUEUE_KEY);
  return safeParse(raw)
    .map(normalizeTask)
    .filter(Boolean);
}

async function saveQueueRaw(tasks = []) {
  const normalized = (Array.isArray(tasks) ? tasks : [])
    .map(normalizeTask)
    .filter(Boolean)
    .sort((left, right) => (
      Number(left.priority || 0) - Number(right.priority || 0) ||
      String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
    ))
    .slice(0, MAX_STORED_TASKS);
  await AsyncStorage.setItem(RUN_DEFERRED_TASK_QUEUE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function loadRunDeferredTasks(options = {}) {
  const tasks = await loadQueueRaw();
  if (options.includeTerminal === false) {
    return tasks.filter((task) => !TERMINAL_STATUSES.has(task.status));
  }
  return tasks;
}

function mergeQueuedTask(existing, incoming, options = {}) {
  if (!existing) return incoming;
  if (existing.status === RUN_DEFERRED_TASK_STATUS.SUCCEEDED && options.resetSucceeded !== true) {
    return existing;
  }
  if (existing.status === RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT && options.resetPermanent !== true) {
    return existing;
  }
  return normalizeTask({
    ...existing,
    payload: {
      ...(existing.payload || {}),
      ...(incoming.payload || {}),
    },
    metadata: {
      ...(existing.metadata || {}),
      ...(incoming.metadata || {}),
    },
    priority: Math.min(Number(existing.priority || incoming.priority), Number(incoming.priority || existing.priority)),
    dependencies: incoming.dependencies?.length ? incoming.dependencies : existing.dependencies,
    updatedAt: nowIso(),
    status: existing.status === RUN_DEFERRED_TASK_STATUS.CANCELLED ? RUN_DEFERRED_TASK_STATUS.PENDING : existing.status,
  });
}

export async function enqueueRunDeferredTasks(tasks = [], options = {}) {
  const items = (Array.isArray(tasks) ? tasks : [tasks])
    .map(normalizeTask)
    .filter(Boolean);
  if (items.length === 0) return { queued: [], queue: await loadQueueRaw() };

  recordRunEvent("RUN_DEFERRED_TASKS_ENQUEUE_STARTED", {
    runId: options.runId || items[0]?.runId || null,
    count: items.length,
    types: items.map((task) => task.type),
    source: options.source || "runDeferredTaskQueueService",
  });

  const queue = await loadQueueRaw();
  const next = [...queue];
  const queued = [];
  items.forEach((task) => {
    const index = next.findIndex((item) =>
      item.id === task.id ||
      item.idempotencyKey === task.idempotencyKey ||
      (item.runId === task.runId && item.type === task.type)
    );
    const merged = mergeQueuedTask(index >= 0 ? next[index] : null, task, options);
    if (index >= 0) next[index] = merged;
    else next.push(merged);
    queued.push(merged);
  });

  const saved = await saveQueueRaw(next);
  recordRunEvent("RUN_DEFERRED_TASKS_ENQUEUED", {
    runId: options.runId || queued[0]?.runId || null,
    count: queued.length,
    queueDepth: saved.filter((task) => !TERMINAL_STATUSES.has(task.status)).length,
    types: queued.map((task) => task.type),
    source: options.source || "runDeferredTaskQueueService",
  });

  return { queued, queue: saved };
}

function getRunMode(run = {}) {
  const raw = String(run.mode || run.type || run.runMode || "free").toLowerCase();
  return raw === "zones" || raw === "zone" || raw === "territory" ? "zones" : "free";
}

function makeTask(type, run = {}, payload = {}, options = {}) {
  const runId = resolveRunId(run);
  return normalizeTask({
    runId,
    localRunId: run.localRunId || runId,
    remoteRunId: run.remoteRunId || null,
    type,
    payload: {
      runId,
      localRunId: run.localRunId || runId,
      remoteRunId: run.remoteRunId || null,
      userId: run.userId || options.userId || payload.userId || "offline",
      mode: getRunMode(run),
      finishedAt: run.finishedAt || run.endedAt || run.date || null,
      ...payload,
    },
    priority: options.priority ?? getDefaultPriority(type),
    maxAttempts: options.maxAttempts ?? getDefaultMaxAttempts(type),
    metadata: {
      source: options.source || "post_run_finish",
      enqueuedAfterLocalSave: true,
      ...options.metadata,
    },
  });
}

export async function enqueueDefaultPostRunTasks(run = {}, options = {}) {
  const runId = resolveRunId(run);
  if (!runId) return { queued: [], queue: await loadQueueRaw(), error: "missing_run_id" };

  const mode = getRunMode(run);
  const tasks = [
    makeTask(RUN_DEFERRED_TASK_TYPE.RUN_FULL_SAVE_FINALIZE, run, {}, options),
  ];

  if (mode === "zones" || options.includeTerritory === true) {
    tasks.push(makeTask(RUN_DEFERRED_TASK_TYPE.RUN_TERRITORY_CAPTURE, run, {
      userName: options.userName || null,
      userAvatar: options.userAvatar || null,
      visibility: options.visibility || "followers",
    }, options));
  }

  tasks.push(
    makeTask(RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE, run, {}, options),
    makeTask(RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC, run, {}, options),
    makeTask(RUN_DEFERRED_TASK_TYPE.RUN_RANKING_UPDATE, run, {}, options),
    makeTask(RUN_DEFERRED_TASK_TYPE.RUN_FEED_UPDATE, run, {}, options),
    makeTask(RUN_DEFERRED_TASK_TYPE.RUN_DIAGNOSTIC_FULL_EXPORT_READY, run, {}, options),
    makeTask(RUN_DEFERRED_TASK_TYPE.RUN_CLEANUP_TEMP_FILES, run, {}, options)
  );

  return enqueueRunDeferredTasks(tasks, {
    ...options,
    runId,
    source: options.source || "finish",
  });
}

function getExpectedProcessingTaskTypes(run = {}) {
  const expected = [
    RUN_DEFERRED_TASK_TYPE.RUN_FULL_SAVE_FINALIZE,
    RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE,
    RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC,
    RUN_DEFERRED_TASK_TYPE.RUN_RANKING_UPDATE,
    RUN_DEFERRED_TASK_TYPE.RUN_FEED_UPDATE,
  ];
  if (getRunMode(run) === "zones") {
    expected.push(RUN_DEFERRED_TASK_TYPE.RUN_TERRITORY_CAPTURE);
  }
  return expected;
}

function toExpeditionTaskStatus(task = {}) {
  switch (task.status) {
    case RUN_DEFERRED_TASK_STATUS.RUNNING:
      return EXPEDITION_PROCESSING_STATUS.PROCESSING;
    case RUN_DEFERRED_TASK_STATUS.SUCCEEDED:
      return EXPEDITION_PROCESSING_STATUS.READY;
    case RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE:
      return EXPEDITION_PROCESSING_STATUS.FAILED_RETRYABLE;
    case RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT:
      return EXPEDITION_PROCESSING_STATUS.FAILED_PERMANENT;
    case RUN_DEFERRED_TASK_STATUS.CANCELLED:
      return EXPEDITION_PROCESSING_STATUS.CANCELLED;
    default:
      return EXPEDITION_PROCESSING_STATUS.PENDING;
  }
}

function createNotApplicableModule(module, reason) {
  return {
    module,
    status: EXPEDITION_PROCESSING_STATUS.NOT_APPLICABLE,
    taskId: null,
    type: null,
    attempts: 0,
    updatedAt: null,
    result: null,
    error: null,
    reason,
  };
}

function createPendingModule(module) {
  return {
    module,
    status: EXPEDITION_PROCESSING_STATUS.PENDING,
    taskId: null,
    type: null,
    attempts: 0,
    updatedAt: null,
    result: null,
    error: null,
    reason: "task_not_enqueued_yet",
  };
}

function buildModuleFromTask(module, task) {
  if (!task) return createPendingModule(module);
  return {
    module,
    status: toExpeditionTaskStatus(task),
    taskId: task.id,
    type: task.type,
    attempts: Number(task.attempts || 0),
    maxAttempts: Number(task.maxAttempts || 0),
    updatedAt: task.updatedAt || null,
    startedAt: task.lastStartedAt || null,
    finishedAt: task.lastFinishedAt || null,
    nextRunAt: task.nextRunAt || null,
    result: task.result || task.metadata?.lastResult || null,
    error: task.lastError || null,
    reason: task.lastError?.reason || task.result?.reason || task.metadata?.lastResult?.reason || null,
  };
}

function deriveOverallProcessingStatus(modules = {}) {
  const values = Object.values(modules).filter(
    (module) => module.status !== EXPEDITION_PROCESSING_STATUS.NOT_APPLICABLE
  );
  const readyCount = values.filter(
    (module) => module.status === EXPEDITION_PROCESSING_STATUS.READY
  ).length;
  const allReady = values.length > 0 && readyCount === values.length;
  if (allReady) return "ready";
  if (readyCount > 0) return "partial";
  if (values.some((module) => module.status === EXPEDITION_PROCESSING_STATUS.PROCESSING)) {
    return "processing";
  }
  if (values.some((module) => (
    module.status === EXPEDITION_PROCESSING_STATUS.FAILED_RETRYABLE ||
    module.status === EXPEDITION_PROCESSING_STATUS.FAILED_PERMANENT ||
    module.status === EXPEDITION_PROCESSING_STATUS.CANCELLED
  ))) {
    return "partial";
  }
  return "pending";
}

export async function getRunExpeditionProcessingState(runId, options = {}) {
  const requestedRunId = String(runId || options.run?.localRunId || options.run?.id || "");
  const queue = Array.isArray(options.queue) ? options.queue : await loadQueueRaw();
  let run = options.run || null;
  if (!run && requestedRunId) {
    try {
      const sync = await import("../../utils/sync.js");
      run = await sync.findLocalRunById?.({
        id: requestedRunId,
        localRunId: requestedRunId,
        runId: requestedRunId,
        remoteRunId: requestedRunId,
      });
    } catch {
      run = null;
    }
  }

  const runIdentities = new Set([
    requestedRunId,
    run?.id,
    run?.localRunId,
    run?.runId,
    run?.remoteRunId,
    run?.legacyId,
  ].filter(Boolean).map(String));
  const tasks = queue.filter((task) => [
    task.runId,
    task.localRunId,
    task.remoteRunId,
  ].filter(Boolean).some((id) => runIdentities.has(String(id))));
  const normalizedRunId = String(
    run?.localRunId ||
    run?.runId ||
    run?.id ||
    tasks[0]?.runId ||
    requestedRunId
  );
  const taskByModule = new Map();
  tasks.forEach((task) => {
    const module = TASK_MODULE_BY_TYPE[task.type];
    if (!module) return;
    const previous = taskByModule.get(module);
    if (!previous || toTimestamp(task.updatedAt, 0) >= toTimestamp(previous.updatedAt, 0)) {
      taskByModule.set(module, task);
    }
  });

  const isZoneRun = getRunMode(run || tasks[0]?.payload || {}) === "zones";
  const metricsTask = taskByModule.get(EXPEDITION_PROCESSING_MODULE.METRICS);
  const modules = {
    [EXPEDITION_PROCESSING_MODULE.METRICS]: metricsTask
      ? buildModuleFromTask(EXPEDITION_PROCESSING_MODULE.METRICS, metricsTask)
      : isFinishedLocalRunForProcessing(run)
        ? {
            ...createPendingModule(EXPEDITION_PROCESSING_MODULE.METRICS),
            status: EXPEDITION_PROCESSING_STATUS.READY,
            reason: "minimum_run_saved",
            updatedAt: run.minimumSavedAt || run.finishedAt || run.updatedAt || null,
            result: {
              runId: run.localRunId || run.id || normalizedRunId,
              distanceMeters: Number(run.distanceMeters ?? run.distance ?? 0),
              durationSeconds: Number(run.durationSeconds ?? run.duration ?? 0),
            },
          }
        : createPendingModule(EXPEDITION_PROCESSING_MODULE.METRICS),
    [EXPEDITION_PROCESSING_MODULE.TERRITORY]: isZoneRun
      ? buildModuleFromTask(
          EXPEDITION_PROCESSING_MODULE.TERRITORY,
          taskByModule.get(EXPEDITION_PROCESSING_MODULE.TERRITORY)
        )
      : createNotApplicableModule(EXPEDITION_PROCESSING_MODULE.TERRITORY, "free_run"),
    [EXPEDITION_PROCESSING_MODULE.PROGRESSION]: buildModuleFromTask(
      EXPEDITION_PROCESSING_MODULE.PROGRESSION,
      taskByModule.get(EXPEDITION_PROCESSING_MODULE.PROGRESSION)
    ),
    [EXPEDITION_PROCESSING_MODULE.RANKING]: buildModuleFromTask(
      EXPEDITION_PROCESSING_MODULE.RANKING,
      taskByModule.get(EXPEDITION_PROCESSING_MODULE.RANKING)
    ),
    [EXPEDITION_PROCESSING_MODULE.SOCIAL]: buildModuleFromTask(
      EXPEDITION_PROCESSING_MODULE.SOCIAL,
      taskByModule.get(EXPEDITION_PROCESSING_MODULE.SOCIAL)
    ),
    [EXPEDITION_PROCESSING_MODULE.SYNC]: buildModuleFromTask(
      EXPEDITION_PROCESSING_MODULE.SYNC,
      taskByModule.get(EXPEDITION_PROCESSING_MODULE.SYNC)
    ),
    [EXPEDITION_PROCESSING_MODULE.CHALLENGES]: createNotApplicableModule(
      EXPEDITION_PROCESSING_MODULE.CHALLENGES,
      "not_implemented"
    ),
    [EXPEDITION_PROCESSING_MODULE.REWARDS]: createNotApplicableModule(
      EXPEDITION_PROCESSING_MODULE.REWARDS,
      "not_implemented"
    ),
  };
  const sortedUpdateTimes = tasks
    .map((task) => task.updatedAt)
    .filter(Boolean)
    .sort();
  const updatedAt = sortedUpdateTimes[sortedUpdateTimes.length - 1] ||
    run?.minimumSavedAt ||
    run?.updatedAt ||
    nowIso();
  const overallStatus = deriveOverallProcessingStatus(modules);

  return {
    runId: normalizedRunId,
    schemaVersion: EXPEDITION_PROCESSING_SCHEMA_VERSION,
    overallStatus,
    status: overallStatus,
    updatedAt,
    modules,
  };
}

function isFinishedLocalRunForProcessing(run = {}) {
  const value = run || {};
  const status = String(value.status || "").toLowerCase();
  return Boolean(
    value &&
    (status === "completed" || status === "finished") &&
    (value.finishedAt || value.endedAt || value.date)
  );
}

async function persistRunExpeditionProcessingState(runId, options = {}) {
  if (!runId) return null;
  try {
    const sync = await import("../../utils/sync.js");
    const run = options.run || await sync.findLocalRunById?.({
      id: runId,
      localRunId: runId,
      runId,
    });
    if (!run) return null;
    const state = await getRunExpeditionProcessingState(runId, {
      ...options,
      run,
    });
    return sync.saveLocalRun?.({
      ...run,
      expeditionProcessingVersion: EXPEDITION_PROCESSING_SCHEMA_VERSION,
      expeditionProcessingStatus: String(state.overallStatus || "pending").toUpperCase(),
      expeditionProcessing: state,
      expeditionProcessingUpdatedAt: state.updatedAt,
    });
  } catch (error) {
    logger.warn(LOG_CATEGORIES.RUN_SESSION, "RUN_EXPEDITION_STATE_PERSIST_FAILED", {
      runId,
      error,
    });
    return null;
  }
}

export async function reconcilePendingRunExpeditionProcessing(options = {}) {
  const sync = await import("../../utils/sync.js");
  const runs = await sync.loadLocalRuns?.();
  const queue = await loadQueueRaw();
  const candidates = (Array.isArray(runs) ? runs : []).filter((run) => (
    Number(run.minimumSavedRunVersion || 0) >= 1 &&
    String(run.expeditionProcessingStatus || run.expeditionProcessing?.status || "PENDING").toUpperCase() !== "READY"
  ));
  const reconciled = [];

  for (const run of candidates) {
    const runId = resolveRunId(run);
    if (!runId) continue;
    const existingTypes = new Set(
      queue
        .filter((task) => String(task.runId) === String(runId))
        .map((task) => task.type)
    );
    const expectedTypes = getExpectedProcessingTaskTypes(run);
    const missingTypes = expectedTypes.filter((type) => !existingTypes.has(type));
    if (missingTypes.length > 0) {
      const result = await enqueueDefaultPostRunTasks(run, {
        includeTerritory: getRunMode(run) === "zones",
        source: options.source || "expedition_reconcile",
      });
      reconciled.push({
        runId,
        missingTypes,
        queued: result.queued?.length || 0,
      });
    }
    await persistRunExpeditionProcessingState(runId, { run }).catch(() => null);
  }

  if (reconciled.length > 0) {
    recordRunEvent("RUN_EXPEDITION_PROCESSING_RECONCILED", {
      count: reconciled.length,
      runIds: reconciled.map((item) => item.runId).slice(0, 20),
      source: options.source || "expedition_reconcile",
    });
  }
  return { reconciled, candidates: candidates.length };
}

function dependencySatisfied(queue = [], dependency) {
  const key = String(dependency || "");
  return queue.some((task) =>
    (task.id === key || task.idempotencyKey === key || task.type === key) &&
    task.status === RUN_DEFERRED_TASK_STATUS.SUCCEEDED
  );
}

function isTaskReady(task = {}, queue = [], nowMs = Date.now()) {
  if (!READY_STATUSES.has(task.status)) return false;
  if (toTimestamp(task.nextRunAt, 0) > nowMs) return false;
  return (task.dependencies || []).every((dependency) => dependencySatisfied(queue, dependency));
}

function computeBackoffMs(attempts = 1) {
  const safeAttempts = Math.max(1, Number(attempts) || 1);
  const schedule = [0, 30_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
  return schedule[Math.min(safeAttempts - 1, schedule.length - 1)];
}

function makeQueueError(message, options = {}) {
  const error = new Error(message);
  error.code = options.code || message;
  error.retryable = options.retryable !== false;
  error.permanent = options.permanent === true;
  error.reason = options.reason || message;
  return error;
}

async function updateTask(taskId, producer) {
  const queue = await loadQueueRaw();
  const index = queue.findIndex((task) => task.id === taskId);
  if (index < 0) return { queue, task: null };
  const updated = normalizeTask(producer(queue[index], queue));
  const next = [...queue];
  next[index] = updated;
  const saved = await saveQueueRaw(next);
  return { queue: saved, task: updated };
}

export async function recoverStaleRunDeferredTasks(options = {}) {
  const now = options.nowMs || Date.now();
  const timeoutMs = Number(options.timeoutMs || RUNNING_RECOVERY_TIMEOUT_MS);
  const queue = await loadQueueRaw();
  let changed = false;
  const recovered = [];
  const next = queue.map((task) => {
    if (task.status !== RUN_DEFERRED_TASK_STATUS.RUNNING) return task;
    const startedAtMs = toTimestamp(task.lastStartedAt || task.updatedAt, 0);
    if (startedAtMs && now - startedAtMs < timeoutMs && options.force !== true) return task;
    changed = true;
    const updated = normalizeTask({
      ...task,
      status: RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE,
      updatedAt: new Date(now).toISOString(),
      nextRunAt: new Date(now).toISOString(),
      lastError: {
        message: "running_task_recovered_after_restart",
        code: "running_task_recovered",
        retryable: true,
      },
    });
    recovered.push(updated);
    return updated;
  });

  const saved = changed ? await saveQueueRaw(next) : queue;
  if (recovered.length > 0) {
    recordRunEvent("RUN_DEFERRED_QUEUE_RECOVERED_ON_BOOT", {
      count: recovered.length,
      taskIds: recovered.map((task) => task.id).slice(0, 20),
      trigger: options.trigger || "recovery",
    });
  }
  return { recovered, queue: saved };
}

async function getActiveRunInfo() {
  try {
    const service = await import("../runTracking/activeRunTrackingService.js");
    const snapshot = await service.default?.getActiveRunSnapshot?.().catch(() => null);
    const runtime = service.default?.getTrackingRuntimeStatus?.() || {};
    const status = String(snapshot?.status || runtime?.status || "").toUpperCase();
    const exists = Boolean(snapshot?.activeRunId || snapshot?.runId || LIVE_ACTIVE_RUN_STATUSES.has(status));
    return { exists, status, runId: snapshot?.activeRunId || snapshot?.runId || null };
  } catch {
    return { exists: false, status: "unknown", runId: null };
  }
}

async function loadRunForTask(task = {}) {
  const sync = await import("../../utils/sync.js");
  const lookup = {
    id: task.runId,
    localRunId: task.localRunId || task.payload?.localRunId || task.runId,
    remoteRunId: task.remoteRunId || task.payload?.remoteRunId || null,
    runId: task.payload?.runId || task.runId,
  };
  const run = await sync.findLocalRunById?.(lookup);
  if (!run) {
    throw makeQueueError("run_not_found_for_deferred_task", {
      code: "run_not_found",
      permanent: true,
      retryable: false,
    });
  }
  return { run, sync };
}

function hasCompletedTerritoryCapture(run = {}) {
  const status = String(run.territoryCaptureStatus || "").toUpperCase();
  const hasArea = Number(run.areaM2 ?? run.area ?? 0) > 0;
  return status === "COMPLETED" || Boolean(run.territoryId || run.zoneId) || hasArea;
}

async function findExistingTerritoryForRun(run = {}, runId) {
  try {
    const repository = await import("../../repositories/territoryRepository.js");
    const result = await repository.list?.();
    const territories = Array.isArray(result?.data) ? result.data : [];
    const ids = new Set([
      runId,
      run.id,
      run.localRunId,
      run.runId,
      run.remoteRunId,
    ].filter(Boolean).map(String));
    return territories.find((territory) =>
      ids.has(String(territory.runLocalId || "")) ||
      ids.has(String(territory.runId || "")) ||
      ids.has(String(territory.localRunId || "")) ||
      ids.has(String(territory.runRemoteId || "")) ||
      ids.has(String(territory.remoteRunId || ""))
    ) || null;
  } catch {
    return null;
  }
}

function serializeCaptureResult(result) {
  if (!result) return null;
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason || "capture_failed",
      details: result.details || null,
    };
  }
  return {
    ok: true,
    territoryId: result.capturedTerritory?.id || null,
    capturedAreaM2: Number(result.capturedAreaM2 || 0),
    newAreaM2: Number(result.newAreaM2 || 0),
    stolenAreaM2: Number(result.stolenAreaM2 || 0),
    ownMergedAreaM2: Number(result.ownMergedAreaM2 || 0),
    conqueredCount: result.conqueredTerritories?.length || 0,
    splitCount: result.splitTerritories?.length || 0,
    mergedCount: result.mergedTerritories?.length || 0,
    affectedUsersCount: result.affectedUsers?.length || 0,
    becameLeaderInCells: result.becameLeaderInCells || [],
    lostLeaderInCells: result.lostLeaderInCells || [],
    cellIds: result.cellIds || [],
    highlights: result.summary?.highlights || [],
  };
}

function buildCaptureResultMessage(result) {
  if (!result) return null;
  if (!result.ok) {
    const reason = result.reason || "erro";
    if (reason === "not_closed_loop") return "Corrida salva. O trajeto nao fechou um loop para capturar territorio.";
    if (reason === "not_enough_points") return "Corrida salva. Foram necessarios mais pontos para capturar territorio.";
    if (reason === "duration_too_short") return "Corrida salva. A captura foi bloqueada porque a atividade foi curta demais.";
    if (reason === "distance_too_short") return "Corrida salva. A captura foi bloqueada porque a distancia foi curta demais.";
    if (reason === "bad_accuracy" || reason === "bad_gps") return "Corrida salva. A captura foi bloqueada por baixa qualidade de GPS.";
    if (reason === "impossible_speed" || reason === "gps_jump" || reason === "suspicious_activity") return "Corrida salva. A captura foi bloqueada por sinais inconsistentes no trajeto.";
    if (reason === "area_too_small") return "Corrida salva. A area ficou pequena demais para virar territorio.";
    if (reason === "area_too_large") return "Corrida salva. A area ficou grande demais para captura segura.";
    return "Corrida salva. A captura territorial nao foi aplicada desta vez.";
  }
  const area = Math.round(Number(result.capturedAreaM2 || 0));
  return `Territorio capturado: ${area} m2.`;
}

function buildTerritoryPatchFromResult(result = {}) {
  const patch = {
    captureResult: serializeCaptureResult(result),
    territoryCaptureMessage: buildCaptureResultMessage(result),
    territoryCaptureStatus: result?.ok ? "COMPLETED" : "FAILED",
    territoryData: result?.ok ? null : {
      pendingCalculation: false,
      failed: true,
      reason: result?.reason || "capture_failed",
    },
  };

  if (result?.ok) {
    const captured = result.capturedTerritory || {};
    patch.area = Number(result.capturedAreaM2 || captured.areaM2 || 0);
    patch.areaM2 = patch.area;
    patch.territoryId = captured.id || null;
    patch.zoneId = captured.id || null;
    patch.zoneCoords = Array.isArray(captured.coordsPreview) ? captured.coordsPreview : [];
    patch.geometry = captured.geometry || null;
    patch.zoneGeometry = captured.geometry || null;
    patch.routeGeometry = captured.routeGeometry || null;
    patch.color = captured.color || "#00E676";
    patch.strokeColor = captured.strokeColor || captured.color || "#00E676";
    patch.fillOpacity = Number(captured.fillOpacity ?? 0.24);
    patch.zoneCount = patch.zoneCoords.length >= 3 ? 1 : 0;
    patch.territorySummary = result.summary || null;
    patch.territoryEvents = Array.isArray(result.events) ? result.events : [];
    patch.capturedCells = Array.isArray(result.cellIds) ? result.cellIds : [];
  } else {
    patch.area = 0;
    patch.areaM2 = 0;
    patch.territoryCaptureFailedReason = result?.reason || "capture_failed";
    if (result?.runContext?.suspicious || result?.details?.suspicious) {
      patch.suspicious = true;
      patch.territoryCaptureBlockedReason = result?.reason || "suspicious_activity";
      patch.suspiciousScore = result?.suspiciousScore || 0;
    }
  }

  return patch;
}

async function processFullSaveFinalize(task) {
  const { run } = await loadRunForTask(task);
  return {
    alreadyDone: true,
    reason: "local_run_already_saved",
    runId: run.localRunId || run.id || task.runId,
  };
}

async function processTerritoryCapture(task) {
  const { run, sync } = await loadRunForTask(task);
  const runId = run.localRunId || run.id || task.runId;
  if (getRunMode(run) !== "zones") {
    return { alreadyDone: true, reason: "free_run_no_territory" };
  }
  if (hasCompletedTerritoryCapture(run)) {
    return { alreadyDone: true, reason: "territory_already_on_run" };
  }

  const existingTerritory = await findExistingTerritoryForRun(run, runId);
  if (existingTerritory) {
    const recoveredRun = await sync.saveLocalRun?.({
      ...run,
      territoryCaptureStatus: "COMPLETED",
      territoryId: existingTerritory.id || existingTerritory.localId || null,
      zoneId: existingTerritory.id || existingTerritory.localId || null,
      area: Number(existingTerritory.areaM2 ?? existingTerritory.area ?? 0) || 0,
      areaM2: Number(existingTerritory.areaM2 ?? existingTerritory.area ?? 0) || 0,
      zoneCoords: Array.isArray(existingTerritory.zoneCoords) ? existingTerritory.zoneCoords : [],
      geometry: existingTerritory.geometry || null,
      zoneGeometry: existingTerritory.geometry || null,
      routeGeometry: existingTerritory.routeGeometry || null,
      territoryCaptureMessage: "Territorio ja estava salvo localmente e foi vinculado a corrida.",
      synced: false,
      pendingSync: true,
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      updatedAt: nowIso(),
    });
    sync.scheduleRunsSync?.(0);
    return {
      alreadyDone: true,
      reason: "existing_territory_relinked",
      run: recoveredRun,
    };
  }

  const [{ processRunTerritoryCapture }, { auth }] = await Promise.all([
    import("../territory/index.js"),
    import("../../firebaseConfig.js"),
  ]);
  const user = auth?.currentUser || {};
  const userId = task.payload?.userId || run.userId || user.uid || "offline";
  const result = await processRunTerritoryCapture({
    userId,
    userName: task.payload?.userName || user.displayName || user.email?.split("@")?.[0] || "Atleta Wayper",
    userAvatar: task.payload?.userAvatar || user.photoURL || null,
    runId,
    path: run.trustedPath || run.path || [],
    segments: run.routeSegments || run.segments || [],
    mode: "zones",
    distanceMeters: run.distanceMeters ?? run.distance ?? 0,
    durationSeconds: run.durationSeconds ?? run.duration ?? 0,
    visibility: task.payload?.visibility || "followers",
    createdAt: run.finishedAt || run.endedAt || run.date || nowIso(),
    persistRemote: false,
  });

  const patch = buildTerritoryPatchFromResult(result);
  const saved = await sync.saveLocalRun?.({
    ...run,
    ...patch,
    synced: false,
    pendingSync: true,
    syncStatus: "PENDING",
    offlineStatus: "PENDING_SYNC",
    updatedAt: nowIso(),
  });
  sync.scheduleRunsSync?.(0);

  if (!result?.ok) {
    return {
      permanentFailure: true,
      reason: result?.reason || "territory_capture_not_applicable",
      run: saved,
    };
  }
  return { run: saved, captureResult: serializeCaptureResult(result) };
}

async function processXpUpdate(task) {
  const { run } = await loadRunForTask(task);
  const progression = await import("../../repositories/progressionRepository.js");
  const result = await progression.addXpFromRun?.(run, {
    userId: task.payload?.userId || run.userId || "offline",
  });
  if (result?.reason === "already_processed") {
    return { alreadyDone: true, reason: "xp_already_processed" };
  }
  if (result?.applied === false && result?.reason) {
    return { permanentFailure: true, reason: result.reason, result };
  }
  return { result };
}

async function processRemoteSync(task) {
  const { run, sync } = await loadRunForTask(task);
  if (run.synced === true && run.pendingSync !== true) {
    return { alreadyDone: true, reason: "run_already_synced" };
  }
  await sync.saveLocalRun?.({
    ...run,
    synced: false,
    pendingSync: true,
    syncStatus: "PENDING",
    offlineStatus: "PENDING_SYNC",
    updatedAt: nowIso(),
  });
  const result = await sync.syncRunsToFirestore?.();
  if (result?.offline) {
    throw makeQueueError("remote_sync_offline", { code: "offline", retryable: true });
  }
  if (Number(result?.failed || 0) > 0) {
    throw makeQueueError("remote_sync_failed", {
      code: "remote_sync_failed",
      retryable: Number(result?.recoverableFailures || 0) > 0,
      permanent: Number(result?.recoverableFailures || 0) === 0,
    });
  }
  return { result };
}

async function processRankingUpdate(task) {
  const ranking = await import("../../repositories/rankingRepository.js");
  const modes = ["distance", "xp", "area", "runs"];
  const results = [];
  for (const mode of modes) {
    const result = await ranking.listRanking?.({
      mode,
      criterion: mode,
      period: "all",
      limitTo: 50,
      allowDemo: false,
    });
    results.push({ mode, source: result?.source || null, count: Array.isArray(result?.data) ? result.data.length : 0 });
  }
  return { results, runId: task.runId };
}

async function processFeedUpdate(task) {
  const social = await import("../../repositories/socialHomeRepository.js");
  const result = await social.loadSocialHome?.({
    userId: task.payload?.userId || "offline",
    limit: 20,
  });
  return {
    source: result?.source || null,
    feedItems: Array.isArray(result?.feedItems) ? result.feedItems.length : 0,
    stories: Array.isArray(result?.stories) ? result.stories.length : 0,
  };
}

async function processDiagnosticReady(task) {
  recordRunEvent("RUN_DIAGNOSTIC_FULL_EXPORT_READY", {
    runId: task.runId,
    localRunId: task.localRunId,
    source: "run_deferred_task_queue",
  });
  return { ready: true };
}

async function processCleanupTempFiles(task) {
  return { skipped: true, reason: "no_temp_file_registry_for_run", runId: task.runId };
}

async function processRetryFailedProcessing(task) {
  const result = await retryRunDeferredTasks({
    runId: task.runId,
    type: task.payload?.type || null,
    includePermanent: false,
  });
  return {
    resetCount: result.resetCount || 0,
    queueDepth: Array.isArray(result.queue) ? result.queue.length : 0,
  };
}

async function executeTask(task) {
  switch (task.type) {
    case RUN_DEFERRED_TASK_TYPE.RUN_FULL_SAVE_FINALIZE:
      return processFullSaveFinalize(task);
    case RUN_DEFERRED_TASK_TYPE.RUN_TERRITORY_CAPTURE:
      return processTerritoryCapture(task);
    case RUN_DEFERRED_TASK_TYPE.RUN_XP_UPDATE:
      return processXpUpdate(task);
    case RUN_DEFERRED_TASK_TYPE.RUN_REMOTE_SYNC:
      return processRemoteSync(task);
    case RUN_DEFERRED_TASK_TYPE.RUN_RANKING_UPDATE:
      return processRankingUpdate(task);
    case RUN_DEFERRED_TASK_TYPE.RUN_FEED_UPDATE:
      return processFeedUpdate(task);
    case RUN_DEFERRED_TASK_TYPE.RUN_DIAGNOSTIC_FULL_EXPORT_READY:
      return processDiagnosticReady(task);
    case RUN_DEFERRED_TASK_TYPE.RUN_CLEANUP_TEMP_FILES:
      return processCleanupTempFiles(task);
    case RUN_DEFERRED_TASK_TYPE.RUN_RETRY_FAILED_PROCESSING:
      return processRetryFailedProcessing(task);
    default:
      throw makeQueueError("unknown_deferred_task_type", {
        code: "unknown_task_type",
        permanent: true,
        retryable: false,
      });
  }
}

function markTerminalResult(task, result, status = RUN_DEFERRED_TASK_STATUS.SUCCEEDED) {
  const sanitizedResult = sanitizeQueuePayload(result || {});
  const metadata = { ...(task.metadata || {}) };
  delete metadata.lastResult;
  return normalizeTask({
    ...task,
    status,
    updatedAt: nowIso(),
    lastFinishedAt: nowIso(),
    lastError: status === RUN_DEFERRED_TASK_STATUS.SUCCEEDED
      ? null
      : {
          message: result?.reason || result?.message || "permanent_failure",
          code: result?.code || result?.reason || "permanent_failure",
          reason: result?.reason || "permanent_failure",
          retryable: false,
          permanent: true,
        },
    metadata: {
      ...metadata,
    },
    result: sanitizedResult,
    resultVersion: 1,
  });
}

function markFailedResult(task, error) {
  const attempts = Number(task.attempts || 0);
  const maxAttempts = Number(task.maxAttempts || DEFAULT_MAX_ATTEMPTS);
  const permanent = error?.permanent === true || error?.retryable === false || attempts >= maxAttempts;
  const nextRunAt = permanent
    ? task.nextRunAt
    : new Date(Date.now() + computeBackoffMs(attempts + 1)).toISOString();
  return normalizeTask({
    ...task,
    status: permanent
      ? RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT
      : RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE,
    updatedAt: nowIso(),
    lastFinishedAt: nowIso(),
    nextRunAt,
    lastError: sanitizeError(error),
  });
}

export async function processRunDeferredTaskQueue(options = {}) {
  if (isProcessingQueue) {
    recordRunEvent("RUN_DEFERRED_QUEUE_PROCESS_SKIPPED", {
      reason: "already_processing",
      trigger: options.trigger || "manual",
    });
    return { skipped: true, reason: "already_processing" };
  }

  isProcessingQueue = true;
  const trigger = options.trigger || "manual";
  const startedAt = Date.now();
  const processed = [];
  const failed = [];

  try {
    await recoverStaleRunDeferredTasks({ trigger, force: options.recoverRunning === true });
    let queue = await loadQueueRaw();
    const ready = queue
      .filter((task) => isTaskReady(task, queue, Date.now()))
      .filter((task) => !options.runId || String(task.runId) === String(options.runId))
      .sort((left, right) => (
        Number(left.priority || 0) - Number(right.priority || 0) ||
        String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
      ))
      .slice(0, Math.max(1, Number(options.limit || 8)));

    if (ready.length === 0) {
      recordRunEvent("RUN_DEFERRED_QUEUE_EMPTY", { trigger });
      return { processed: [], failed: [], skipped: false, empty: true };
    }

    const active = await getActiveRunInfo();
    if (active.exists && options.ignoreActiveRun !== true) {
      recordRunEvent("RUN_DEFERRED_QUEUE_PROCESS_SKIPPED_ACTIVE_RUN", {
        trigger,
        activeRunId: active.runId,
        status: active.status,
        readyCount: ready.length,
      });
      return { skipped: true, reason: "active_run", readyCount: ready.length };
    }

    recordRunEvent("RUN_DEFERRED_QUEUE_PROCESS_STARTED", {
      trigger,
      count: ready.length,
      taskIds: ready.map((task) => task.id).slice(0, 20),
    });

    for (const readyTask of ready) {
      const runningTransition = await updateTask(readyTask.id, (task) => ({
        ...task,
        status: RUN_DEFERRED_TASK_STATUS.RUNNING,
        attempts: Number(task.attempts || 0) + 1,
        updatedAt: nowIso(),
        lastStartedAt: nowIso(),
        lastError: null,
      }));
      const task = runningTransition.task;
      if (!task) continue;

      const taskStartedAt = Date.now();
      recordRunEvent("RUN_DEFERRED_TASK_STARTED", {
        taskId: task.id,
        runId: task.runId,
        type: task.type,
        attempt: task.attempts,
        trigger,
      });

      try {
        const result = await executeTask(task);
        const durationMs = Date.now() - taskStartedAt;
        let finalStatus = RUN_DEFERRED_TASK_STATUS.SUCCEEDED;
        if (result?.permanentFailure) finalStatus = RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT;
        const finalTask = markTerminalResult(task, {
          ...result,
          durationMs,
        }, finalStatus);
        await updateTask(task.id, () => finalTask);
        processed.push(finalTask);

        if (result?.alreadyDone) {
          recordRunEvent("RUN_DEFERRED_TASK_ALREADY_DONE", {
            taskId: task.id,
            runId: task.runId,
            type: task.type,
            reason: result.reason || "already_done",
            durationMs,
          });
        } else if (result?.permanentFailure) {
          recordRunEvent("RUN_DEFERRED_TASK_FAILED_PERMANENT", {
            taskId: task.id,
            runId: task.runId,
            type: task.type,
            reason: result.reason || "permanent_failure",
            durationMs,
          });
        } else {
          recordRunSnapshotEvent("RUN_DEFERRED_TASK_SUCCEEDED", result?.run || { id: task.runId }, {
            taskId: task.id,
            runId: task.runId,
            type: task.type,
            durationMs,
          });
        }
      } catch (error) {
        const durationMs = Date.now() - taskStartedAt;
        const failedTask = markFailedResult(task, error);
        await updateTask(task.id, () => failedTask);
        failed.push(failedTask);
        const eventName = failedTask.status === RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT
          ? "RUN_DEFERRED_TASK_FAILED_PERMANENT"
          : "RUN_DEFERRED_TASK_FAILED_RETRYABLE";
        recordRunEvent(eventName, {
          taskId: task.id,
          runId: task.runId,
          type: task.type,
          attempt: task.attempts,
          maxAttempts: task.maxAttempts,
          durationMs,
          error,
        });
        if (failedTask.status === RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE) {
          recordRunEvent("RUN_DEFERRED_TASK_RETRY_SCHEDULED", {
            taskId: task.id,
            runId: task.runId,
            type: task.type,
            attempt: failedTask.attempts,
            nextRunAt: failedTask.nextRunAt,
          });
        }
      }
    }

    queue = await loadQueueRaw();
    const affectedRunIds = [...new Set(
      [...processed, ...failed].map((task) => task.runId).filter(Boolean)
    )];
    await Promise.all(
      affectedRunIds.map((runId) =>
        persistRunExpeditionProcessingState(runId, { queue }).catch(() => null)
      )
    );
    return {
      processed,
      failed,
      queue,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    logger.warn(LOG_CATEGORIES.RUN_SESSION, "RUN_DEFERRED_QUEUE_CORRUPTED_RECOVERABLE", { error });
    recordRunEvent("RUN_DEFERRED_QUEUE_CORRUPTED_RECOVERABLE", {
      trigger,
      error,
    });
    return { processed, failed, error };
  } finally {
    isProcessingQueue = false;
  }
}

export async function retryRunDeferredTasks(options = {}) {
  const queue = await loadQueueRaw();
  const now = nowIso();
  let resetCount = 0;
  const next = queue.map((task) => {
    const matchesRun = !options.runId || String(task.runId) === String(options.runId);
    const matchesType = !options.type || String(task.type) === String(options.type);
    const retryableStatus =
      task.status === RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE ||
      task.status === RUN_DEFERRED_TASK_STATUS.PENDING ||
      (options.includePermanent === true && task.status === RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT);
    if (!matchesRun || !matchesType || !retryableStatus) return task;
    resetCount += 1;
    return normalizeTask({
      ...task,
      status: RUN_DEFERRED_TASK_STATUS.PENDING,
      nextRunAt: now,
      updatedAt: now,
      lastError: task.status === RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT ? null : task.lastError,
    });
  });
  const saved = await saveQueueRaw(next);
  recordRunEvent("RUN_DEFERRED_TASK_RETRY_SCHEDULED", {
    count: resetCount,
    runId: options.runId || null,
    type: options.type || null,
    manual: true,
  });
  return { resetCount, queue: saved };
}

export async function getRunDeferredTaskQueueSummary() {
  const queue = await loadQueueRaw();
  const counts = queue.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});
  const pending = queue.filter((task) => !TERMINAL_STATUSES.has(task.status));
  const failed = queue.filter((task) =>
    task.status === RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE ||
    task.status === RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT
  );
  const oldest = pending
    .slice()
    .sort((left, right) => toTimestamp(left.createdAt, 0) - toTimestamp(right.createdAt, 0))[0] || null;
  const nextRetry = pending
    .slice()
    .sort((left, right) => toTimestamp(left.nextRunAt, 0) - toTimestamp(right.nextRunAt, 0))[0] || null;
  const lastErrorTask = failed
    .slice()
    .sort((left, right) => toTimestamp(right.updatedAt, 0) - toTimestamp(left.updatedAt, 0))[0] || null;

  return sanitizeLogContext({
    total: queue.length,
    pending: counts[RUN_DEFERRED_TASK_STATUS.PENDING] || 0,
    running: counts[RUN_DEFERRED_TASK_STATUS.RUNNING] || 0,
    succeeded: counts[RUN_DEFERRED_TASK_STATUS.SUCCEEDED] || 0,
    failedRetryable: counts[RUN_DEFERRED_TASK_STATUS.FAILED_RETRYABLE] || 0,
    failedPermanent: counts[RUN_DEFERRED_TASK_STATUS.FAILED_PERMANENT] || 0,
    cancelled: counts[RUN_DEFERRED_TASK_STATUS.CANCELLED] || 0,
    oldestPendingAt: oldest?.createdAt || null,
    oldestPendingAgeMs: oldest ? Math.max(0, Date.now() - toTimestamp(oldest.createdAt, Date.now())) : 0,
    nextRunAt: nextRetry?.nextRunAt || null,
    lastError: lastErrorTask?.lastError || null,
    lastErrorTaskId: lastErrorTask?.id || null,
    lastErrorRunId: lastErrorTask?.runId || null,
    taskTypes: queue.reduce((acc, task) => {
      acc[task.type] = (acc[task.type] || 0) + 1;
      return acc;
    }, {}),
  });
}

export async function startRunDeferredTaskAutoProcessing(options = {}) {
  if (autoProcessTimer) return { started: false, reason: "already_started" };
  const intervalMs = Number(options.intervalMs || AUTO_PROCESS_INTERVAL_MS);
  const triggerProcess = (trigger) => {
    processRunDeferredTaskQueue({ trigger }).catch((error) => {
      logger.warn(LOG_CATEGORIES.RUN_SESSION, "RUN_DEFERRED_QUEUE_PROCESS_FAILED", { trigger, error });
    });
  };

  await reconcilePendingRunExpeditionProcessing({
    source: "auto_start",
  }).catch((error) => {
    logger.warn(LOG_CATEGORIES.RUN_SESSION, "RUN_EXPEDITION_RECONCILE_FAILED", { error });
  });
  await recoverStaleRunDeferredTasks({ trigger: "auto_start", force: true }).catch(() => null);
  setTimeout(() => triggerProcess("auto_start"), Number(options.initialDelayMs || 1200));
  autoProcessTimer = setInterval(() => triggerProcess("auto_interval"), intervalMs);

  try {
    netInfoUnsubscribe = NetInfo.addEventListener?.((state) => {
      if (state?.isConnected && state.isInternetReachable !== false) {
        triggerProcess("network_online");
      }
    }) || null;
  } catch {
    netInfoUnsubscribe = null;
  }

  try {
    appStateUnsubscribe = AppState.addEventListener?.("change", (nextState) => {
      if (nextState === "active") triggerProcess("app_foreground");
    }) || null;
  } catch {
    appStateUnsubscribe = null;
  }

  recordRunEvent("RUN_DEFERRED_QUEUE_AUTO_PROCESS_STARTED", {
    intervalMs,
  });
  return { started: true, intervalMs };
}

export async function stopRunDeferredTaskAutoProcessing() {
  if (autoProcessTimer) clearInterval(autoProcessTimer);
  autoProcessTimer = null;
  try {
    netInfoUnsubscribe?.();
  } catch {}
  try {
    appStateUnsubscribe?.remove?.();
    if (typeof appStateUnsubscribe === "function") appStateUnsubscribe();
  } catch {}
  netInfoUnsubscribe = null;
  appStateUnsubscribe = null;
  return { stopped: true };
}

export async function __resetRunDeferredTaskQueueForTests() {
  await stopRunDeferredTaskAutoProcessing();
  isProcessingQueue = false;
  await AsyncStorage.removeItem(RUN_DEFERRED_TASK_QUEUE_KEY);
}

export default {
  RUN_DEFERRED_TASK_QUEUE_KEY,
  RUN_DEFERRED_TASK_SCHEMA_VERSION,
  RUN_DEFERRED_TASK_TYPE,
  RUN_DEFERRED_TASK_STATUS,
  EXPEDITION_PROCESSING_SCHEMA_VERSION,
  EXPEDITION_PROCESSING_MODULE,
  EXPEDITION_PROCESSING_STATUS,
  enqueueRunDeferredTasks,
  enqueueDefaultPostRunTasks,
  loadRunDeferredTasks,
  processRunDeferredTaskQueue,
  retryRunDeferredTasks,
  recoverStaleRunDeferredTasks,
  getRunExpeditionProcessingState,
  reconcilePendingRunExpeditionProcessing,
  getRunDeferredTaskQueueSummary,
  startRunDeferredTaskAutoProcessing,
  stopRunDeferredTaskAutoProcessing,
};
