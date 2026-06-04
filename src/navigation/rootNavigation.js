import { createNavigationContainerRef } from "@react-navigation/native";

export const ACTIVE_RUN_DEEP_LINK = "wayper://run/active";

export const navigationRef = createNavigationContainerRef();

let pendingActiveRunOpen = false;

function buildOpenActiveRunParams() {
  return {
    screen: "Mapa",
    params: {
      activeRunOpenRequestId: Date.now(),
      fromRunNotification: true,
    },
  };
}

export function requestOpenActiveRun() {
  if (!navigationRef.isReady()) {
    pendingActiveRunOpen = true;
    return false;
  }

  const rootState = navigationRef.getRootState?.();
  const routeNames = Array.isArray(rootState?.routeNames) ? rootState.routeNames : [];
  if (routeNames.length > 0 && !routeNames.includes("Main")) {
    pendingActiveRunOpen = true;
    return false;
  }

  pendingActiveRunOpen = false;
  navigationRef.navigate("Main", buildOpenActiveRunParams());
  return true;
}

export function flushPendingNavigation() {
  if (pendingActiveRunOpen) {
    requestOpenActiveRun();
  }
}

export function isActiveRunUrl(url) {
  if (!url || typeof url !== "string") return false;
  const normalized = url.toLowerCase();
  return normalized === ACTIVE_RUN_DEEP_LINK || normalized.startsWith(`${ACTIVE_RUN_DEEP_LINK}?`);
}

export function handleNavigationUrl(url) {
  if (!isActiveRunUrl(url)) return false;
  requestOpenActiveRun();
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
