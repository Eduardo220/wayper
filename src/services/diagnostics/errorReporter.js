import logger, { LOG_CATEGORIES, sanitizeLogContext } from "../../utils/logger.js";
import { getRecentLogs } from "./logStorageService.js";

let installed = false;
let previousGlobalHandler = null;
let previousUnhandledRejection = null;

function serializeError(error) {
  if (!error) return { message: "Unknown error" };
  return sanitizeLogContext({
    name: error.name || "Error",
    message: error.message || String(error),
    stack: error.stack || null,
  });
}

async function getActiveRunContext() {
  try {
    const diagnostics = await import("./runDiagnosticsService.js");
    const tracking = await import("../runTracking/activeRunTrackingService.js");
    const service = tracking.default || tracking;
    const snapshot = await service.getActiveRunSnapshot?.();
    return diagnostics.summarizeRunSnapshot(snapshot || {}, service.getTrackingRuntimeStatus?.() || {});
  } catch {
    return null;
  }
}

export async function reportError(error, context = {}) {
  try {
    const [recentLogs, activeRun] = await Promise.all([
      getRecentLogs(50).catch(() => []),
      getActiveRunContext(),
    ]);
    const payload = sanitizeLogContext({
      ...context,
      error: serializeError(error),
      activeRun,
      recentLogs: recentLogs.map((log) => ({
        id: log.id,
        timestamp: log.timestamp,
        level: log.level,
        category: log.category,
        event: log.event,
      })),
    });
    const level = context.fatal ? "fatal" : "error";
    logger[level](
      LOG_CATEGORIES.UNKNOWN,
      context.event || "UNCAUGHT_ERROR",
      payload,
      { skipRemote: context.remoteCapturedByGlobalHandler === true }
    );
    return payload;
  } catch {
    return null;
  }
}

export function installGlobalErrorReporter() {
  if (installed) return () => {};
  installed = true;

  try {
    const errorUtils = globalThis.ErrorUtils;
    if (errorUtils?.getGlobalHandler && errorUtils?.setGlobalHandler) {
      previousGlobalHandler = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error, isFatal) => {
        reportError(error, {
          event: "GLOBAL_JS_ERROR",
          fatal: Boolean(isFatal),
          source: "ErrorUtils",
          remoteCapturedByGlobalHandler: true,
        }).finally(() => {
          if (typeof previousGlobalHandler === "function") {
            previousGlobalHandler(error, isFatal);
          }
        });
      });
    }
  } catch (error) {
    logger.warn(LOG_CATEGORIES.UNKNOWN, "GLOBAL_ERROR_HANDLER_INSTALL_FAILED", {
      error,
    });
  }

  try {
    previousUnhandledRejection = globalThis.onunhandledrejection;
    globalThis.onunhandledrejection = (event) => {
      const reason = event?.reason || event;
      reportError(reason, {
        event: "UNHANDLED_PROMISE_REJECTION",
        source: "onunhandledrejection",
        remoteCapturedByGlobalHandler: true,
      });
      if (typeof previousUnhandledRejection === "function") {
        previousUnhandledRejection(event);
      }
    };
  } catch {}

  return () => {};
}

export function __resetErrorReporterForTests() {
  installed = false;
  previousGlobalHandler = null;
  previousUnhandledRejection = null;
}

export default {
  installGlobalErrorReporter,
  reportError,
};
