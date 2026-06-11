import logger, { LOG_CATEGORIES } from "../../utils/logger.js";

const SAMPLE_INTERVAL_MS = 2000;
const STALL_THRESHOLD_MS = 700;

let timer = null;
let expectedAt = 0;

export function startPerformanceDiagnostics() {
  if (timer) return;
  expectedAt = Date.now() + SAMPLE_INTERVAL_MS;
  timer = setInterval(() => {
    const now = Date.now();
    const delayMs = Math.max(0, now - expectedAt);
    expectedAt = now + SAMPLE_INTERVAL_MS;
    if (delayMs < STALL_THRESHOLD_MS) return;
    logger.warn(LOG_CATEGORIES.PERFORMANCE, "JS_EVENT_LOOP_STALL", {
      delayMs,
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
      detectedAt: new Date(now).toISOString(),
    }, {
      forcePersist: true,
    });
  }, SAMPLE_INTERVAL_MS);
}

export function stopPerformanceDiagnostics() {
  if (timer) clearInterval(timer);
  timer = null;
  expectedAt = 0;
}

export default {
  startPerformanceDiagnostics,
  stopPerformanceDiagnostics,
};
