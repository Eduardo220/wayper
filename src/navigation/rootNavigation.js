import { createNavigationContainerRef } from "@react-navigation/native";
import { recordDeepLinkReceived } from "../services/runTracking/activeRunRuntimeService.js";

export const ACTIVE_RUN_DEEP_LINK = "wayper://run/active";

export const navigationRef = createNavigationContainerRef();

let pendingActiveRunOpen = false;
let pendingActiveRunOpenOptions = null;

function buildOpenActiveRunParams(options = {}) {
  return {
    screen: "Mapa",
    params: {
      activeRunOpenRequestId: Date.now(),
      fromRunNotification: options.fromRunNotification !== false,
      fromDeepLink: Boolean(options.fromDeepLink),
    },
  };
}

export function requestOpenActiveRun(options = {}) {
  if (!navigationRef.isReady()) {
    pendingActiveRunOpen = true;
    pendingActiveRunOpenOptions = options;
    return false;
  }

  const rootState = navigationRef.getRootState?.();
  const routeNames = Array.isArray(rootState?.routeNames) ? rootState.routeNames : [];
  if (routeNames.length > 0 && !routeNames.includes("Main")) {
    pendingActiveRunOpen = true;
    pendingActiveRunOpenOptions = options;
    return false;
  }

  pendingActiveRunOpen = false;
  pendingActiveRunOpenOptions = null;
  navigationRef.navigate("Main", buildOpenActiveRunParams(options));
  return true;
}

export function flushPendingNavigation() {
  if (pendingActiveRunOpen) {
    requestOpenActiveRun(pendingActiveRunOpenOptions || {});
  }
}

export function isActiveRunUrl(url) {
  if (!url || typeof url !== "string") return false;
  const normalized = url.toLowerCase();
  return normalized === ACTIVE_RUN_DEEP_LINK || normalized.startsWith(`${ACTIVE_RUN_DEEP_LINK}?`);
}

export function handleNavigationUrl(url) {
  if (!isActiveRunUrl(url)) return false;
  recordDeepLinkReceived(url, {
    source: "linking",
  });
  requestOpenActiveRun({
    fromDeepLink: true,
    fromRunNotification: true,
  });
  return true;
}

export default {
  ACTIVE_RUN_DEEP_LINK,
  flushPendingNavigation,
  handleNavigationUrl,
  isActiveRunUrl,
  navigationRef,
  requestOpenActiveRun,
};
