let monitoringSink = null;

export function registerMonitoringSink(sink) {
  monitoringSink = sink && typeof sink === "object" ? sink : null;
}

export function forwardLogToMonitoring(logEvent, rawContext = {}, options = {}) {
  try {
    return monitoringSink?.captureLogEvent?.(logEvent, rawContext, options) ?? null;
  } catch {
    return null;
  }
}

export function __resetMonitoringBridgeForTests() {
  monitoringSink = null;
}

export default {
  forwardLogToMonitoring,
  registerMonitoringSink,
};
