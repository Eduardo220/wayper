import { Linking, PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import logger, { LOG_CATEGORIES } from "../utils/logger.js";
import { recordRunEvent } from "./diagnostics/runDiagnosticsService.js";

export const PermissionStatus = {
  GRANTED: "granted",
  DENIED: "denied",
  BLOCKED: "blocked",
  LIMITED: "limited",
  UNAVAILABLE: "unavailable",
  UNDETERMINED: "undetermined",
  UNKNOWN: "unknown",
  CHECKING: "checking",
};

export const PermissionName = {
  LOCATION_FOREGROUND: "locationForeground",
  LOCATION_BACKGROUND: "locationBackground",
  MEDIA_LIBRARY: "mediaLibrary",
  IMAGE_LIBRARY: "imageLibrary",
  NOTIFICATIONS: "notifications",
};

const STORAGE_PREFIX = "wayper:permissions";
const requestInFlight = new Map();

const isDev = () => typeof __DEV__ !== "undefined" && __DEV__;

const permissionDebug = (event, payload = {}) => {
  if (isDev()) {
    logger.debug(LOG_CATEGORIES.PERMISSION, `[Wayper Permissions] ${event}`, payload);
  }
};

const storageKey = (permissionName, kind) => `${STORAGE_PREFIX}:${permissionName}:${kind}`;

export const normalizePermissionStatus = (input, options = {}) => {
  const rawStatus = typeof input === "string"
    ? input
    : input?.status || (input?.granted ? PermissionStatus.GRANTED : options.fallbackStatus);
  const status = String(rawStatus || PermissionStatus.UNKNOWN).toLowerCase();
  const canAskAgain = input?.canAskAgain ?? options.canAskAgain;
  const granted = input?.granted ?? options.granted;

  if (granted === true || status === "granted" || status === "authorized") return PermissionStatus.GRANTED;
  if (status === "limited") return PermissionStatus.LIMITED;
  if (status === "blocked" || status === "never_ask_again") return PermissionStatus.BLOCKED;
  if (status === "denied" && canAskAgain === false) return PermissionStatus.BLOCKED;
  if (status === "denied") return PermissionStatus.DENIED;
  if (status === "undetermined" || status === "notdetermined" || status === "not_determined") return PermissionStatus.UNDETERMINED;
  if (status === "unavailable" || status === "restricted") return PermissionStatus.UNAVAILABLE;
  if (status === "checking") return PermissionStatus.CHECKING;
  return PermissionStatus.UNKNOWN;
};

const remember = async (permissionName, kind) => {
  try {
    await AsyncStorage.setItem(storageKey(permissionName, kind), "1");
  } catch (error) {
    permissionDebug("persist_failed", { permissionName, kind, error: error?.message || error });
  }
};

export const hasShownPermissionNotice = async (permissionName) => {
  try {
    return (await AsyncStorage.getItem(storageKey(permissionName, "noticeShown"))) === "1";
  } catch {
    return false;
  }
};

export const markPermissionNoticeShown = async (permissionName) => {
  await remember(permissionName, "noticeShown");
};

export const hasRequestedPermission = async (permissionName) => {
  try {
    return (await AsyncStorage.getItem(storageKey(permissionName, "nativeRequested"))) === "1";
  } catch {
    return false;
  }
};

const markPermissionRequested = async (permissionName) => {
  await remember(permissionName, "nativeRequested");
};

const normalizePermission = (permissionName, response, fallbackStatus = PermissionStatus.UNAVAILABLE) => {
  if (!response) {
    return {
      permissionName,
      status: fallbackStatus,
      granted: false,
      canAskAgain: false,
      raw: response,
    };
  }

  const rawStatus = response.status || (response.granted ? PermissionStatus.GRANTED : fallbackStatus);
  const canAskAgain = response.canAskAgain !== false;
  const status = normalizePermissionStatus(rawStatus, {
    canAskAgain,
    granted: response.granted,
    fallbackStatus,
  });

  return {
    permissionName,
    status,
    granted: status === PermissionStatus.GRANTED || status === PermissionStatus.LIMITED,
    canAskAgain,
    expires: response.expires,
    raw: response,
  };
};

const runSingleRequest = async (key, fn) => {
  if (requestInFlight.has(key)) return requestInFlight.get(key);
  const promise = fn().finally(() => requestInFlight.delete(key));
  requestInFlight.set(key, promise);
  return promise;
};

export const openAppSettings = async () => {
  permissionDebug("open_settings");
  try {
    await Linking.openSettings();
    return true;
  } catch (error) {
    permissionDebug("open_settings_failed", { error: error?.message || error });
    return false;
  }
};

export const markPermissionEducationSeen = markPermissionNoticeShown;

export const shouldShowPermissionEducation = async (permissionName, state = null) => {
  const permissionState = state || await getPermissionState(permissionName);
  if (permissionState?.granted) return false;
  if (await hasShownPermissionNotice(permissionName)) return false;
  return true;
};

export const checkLocationPermission = async () => {
  permissionDebug("check", { permissionName: PermissionName.LOCATION_FOREGROUND });
  try {
    const result = await Location.getForegroundPermissionsAsync();
    const normalized = normalizePermission(PermissionName.LOCATION_FOREGROUND, result);
    permissionDebug("check_result", normalized);
    return normalized;
  } catch (error) {
    permissionDebug("check_failed", { permissionName: PermissionName.LOCATION_FOREGROUND, error: error?.message || error });
    return normalizePermission(PermissionName.LOCATION_FOREGROUND, null);
  }
};

export const requestLocationPermission = async () => {
  return runSingleRequest(PermissionName.LOCATION_FOREGROUND, async () => {
    permissionDebug("request", { permissionName: PermissionName.LOCATION_FOREGROUND });
    recordRunEvent("LOCATION_PERMISSION_REQUESTED", {
      permissionName: PermissionName.LOCATION_FOREGROUND,
    });
    try {
      await markPermissionRequested(PermissionName.LOCATION_FOREGROUND);
      const result = await Location.requestForegroundPermissionsAsync();
      const normalized = normalizePermission(PermissionName.LOCATION_FOREGROUND, result);
      permissionDebug("request_result", normalized);
      recordRunEvent(
        normalized.granted ? "LOCATION_PERMISSION_GRANTED" : "LOCATION_PERMISSION_DENIED",
        {
          permissionName: PermissionName.LOCATION_FOREGROUND,
          status: normalized.status,
          granted: normalized.granted,
          canAskAgain: normalized.canAskAgain,
        }
      );
      return normalized;
    } catch (error) {
      permissionDebug("request_failed", { permissionName: PermissionName.LOCATION_FOREGROUND, error: error?.message || error });
      recordRunEvent("LOCATION_PERMISSION_DENIED", {
        permissionName: PermissionName.LOCATION_FOREGROUND,
        status: "error",
        error,
      });
      return normalizePermission(PermissionName.LOCATION_FOREGROUND, null);
    }
  });
};

export const requestForegroundLocation = requestLocationPermission;

export const ensureLocationForRun = async () => {
  const current = await checkLocationPermission();
  if (current.granted) return { ...current, action: "granted" };
  if (current.canAskAgain === false || current.status === PermissionStatus.BLOCKED) {
    permissionDebug("show_notice_instead_of_request", {
      permissionName: PermissionName.LOCATION_FOREGROUND,
      reason: "blocked",
    });
    return { ...current, action: "blocked" };
  }

  const requested = await requestLocationPermission();
  return { ...requested, action: requested.granted ? "granted" : "denied" };
};

export const checkBackgroundLocationPermission = async () => {
  if (Platform.OS === "web") {
    return normalizePermission(PermissionName.LOCATION_BACKGROUND, null);
  }

  permissionDebug("check", { permissionName: PermissionName.LOCATION_BACKGROUND });
  try {
    const result = await Location.getBackgroundPermissionsAsync();
    const normalized = normalizePermission(PermissionName.LOCATION_BACKGROUND, result);
    permissionDebug("check_result", normalized);
    return normalized;
  } catch (error) {
    permissionDebug("check_failed", { permissionName: PermissionName.LOCATION_BACKGROUND, error: error?.message || error });
    return normalizePermission(PermissionName.LOCATION_BACKGROUND, null);
  }
};

export const requestBackgroundLocationPermission = async () => {
  return runSingleRequest(PermissionName.LOCATION_BACKGROUND, async () => {
    const foreground = await checkLocationPermission();
    if (!foreground.granted) return { ...foreground, permissionName: PermissionName.LOCATION_BACKGROUND };

    const current = await checkBackgroundLocationPermission();
    if (current.granted || current.canAskAgain === false) return current;

    const alreadyRequested = await hasRequestedPermission(PermissionName.LOCATION_BACKGROUND);
    if (alreadyRequested) {
      permissionDebug("show_notice_instead_of_request", {
        permissionName: PermissionName.LOCATION_BACKGROUND,
        reason: "background_already_requested",
      });
      return { ...current, promptedBefore: true };
    }

    permissionDebug("request", { permissionName: PermissionName.LOCATION_BACKGROUND });
    recordRunEvent("LOCATION_PERMISSION_REQUESTED", {
      permissionName: PermissionName.LOCATION_BACKGROUND,
    });
    try {
      await markPermissionRequested(PermissionName.LOCATION_BACKGROUND);
      const result = await Location.requestBackgroundPermissionsAsync();
      const normalized = normalizePermission(PermissionName.LOCATION_BACKGROUND, result);
      permissionDebug("request_result", normalized);
      recordRunEvent(
        normalized.granted ? "LOCATION_PERMISSION_GRANTED" : "LOCATION_PERMISSION_DENIED",
        {
          permissionName: PermissionName.LOCATION_BACKGROUND,
          status: normalized.status,
          granted: normalized.granted,
          canAskAgain: normalized.canAskAgain,
        }
      );
      return normalized;
    } catch (error) {
      permissionDebug("request_failed", { permissionName: PermissionName.LOCATION_BACKGROUND, error: error?.message || error });
      recordRunEvent("LOCATION_PERMISSION_DENIED", {
        permissionName: PermissionName.LOCATION_BACKGROUND,
        status: "error",
        error,
      });
      return normalizePermission(PermissionName.LOCATION_BACKGROUND, null);
    }
  });
};

export const requestBackgroundLocation = requestBackgroundLocationPermission;

export const checkNotificationPermission = async () => {
  const permissionName = PermissionName.NOTIFICATIONS;

  if (Platform.OS !== "android") {
    return normalizePermission(permissionName, {
      status: PermissionStatus.UNAVAILABLE,
      granted: false,
      canAskAgain: false,
    });
  }

  if (Number(Platform.Version || 0) < 33) {
    return normalizePermission(permissionName, {
      status: PermissionStatus.GRANTED,
      granted: true,
      canAskAgain: false,
    });
  }

  const permission = PermissionsAndroid?.PERMISSIONS?.POST_NOTIFICATIONS;
  if (!permission || typeof PermissionsAndroid?.check !== "function") {
    return normalizePermission(permissionName, {
      status: PermissionStatus.UNAVAILABLE,
      granted: false,
      canAskAgain: false,
    });
  }

  try {
    const granted = await PermissionsAndroid.check(permission);
    const normalized = normalizePermission(permissionName, {
      status: granted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
      granted,
      canAskAgain: true,
    });
    permissionDebug("check_result", normalized);
    return normalized;
  } catch (error) {
    permissionDebug("check_failed", { permissionName, error: error?.message || error });
    return normalizePermission(permissionName, null);
  }
};

export const requestNotificationPermission = async ({ force = false } = {}) => {
  return runSingleRequest(PermissionName.NOTIFICATIONS, async () => {
    const permissionName = PermissionName.NOTIFICATIONS;
    const current = await checkNotificationPermission();
    if (current.granted || current.status === PermissionStatus.UNAVAILABLE) return current;

    const alreadyRequested = await hasRequestedPermission(permissionName);
    if (alreadyRequested && !force) {
      permissionDebug("show_notice_instead_of_request", {
        permissionName,
        reason: "optional_already_requested",
      });
      return { ...current, promptedBefore: true };
    }

    const permission = PermissionsAndroid?.PERMISSIONS?.POST_NOTIFICATIONS;
    if (Platform.OS !== "android" || !permission || typeof PermissionsAndroid?.request !== "function") {
      return normalizePermission(permissionName, null);
    }

    try {
      await markPermissionRequested(permissionName);
      const response = await PermissionsAndroid.request(permission);
      const grantedStatus = PermissionsAndroid.RESULTS?.GRANTED || PermissionStatus.GRANTED;
      const neverAskAgainStatus = PermissionsAndroid.RESULTS?.NEVER_ASK_AGAIN || "never_ask_again";
      const granted = response === grantedStatus;
      const blocked = response === neverAskAgainStatus;
      const normalized = normalizePermission(permissionName, {
        status: granted ? PermissionStatus.GRANTED : blocked ? PermissionStatus.BLOCKED : (response || PermissionStatus.DENIED),
        granted,
        canAskAgain: !blocked,
      });
      permissionDebug("request_result", normalized);
      return normalized;
    } catch (error) {
      permissionDebug("request_failed", { permissionName, error: error?.message || error });
      return normalizePermission(permissionName, null);
    }
  });
};

export const checkMediaPermission = async ({ mediaLibrary } = {}) => {
  try {
    const MediaLibrary = mediaLibrary || (await import("expo-media-library"));
    if (typeof MediaLibrary.getPermissionsAsync !== "function") {
      return normalizePermission(PermissionName.MEDIA_LIBRARY, null);
    }

    permissionDebug("check", { permissionName: PermissionName.MEDIA_LIBRARY });
    const result = await MediaLibrary.getPermissionsAsync(false);
    const normalized = normalizePermission(PermissionName.MEDIA_LIBRARY, result);
    permissionDebug("check_result", normalized);
    return normalized;
  } catch (error) {
    permissionDebug("check_failed", { permissionName: PermissionName.MEDIA_LIBRARY, error: error?.message || error });
    return normalizePermission(PermissionName.MEDIA_LIBRARY, null);
  }
};

export const requestMediaPermission = async ({ mediaLibrary, force = false } = {}) => {
  return runSingleRequest(PermissionName.MEDIA_LIBRARY, async () => {
    try {
      const MediaLibrary = mediaLibrary || (await import("expo-media-library"));
      const current = await checkMediaPermission({ mediaLibrary: MediaLibrary });
      if (current.granted || current.canAskAgain === false) return current;

      const alreadyRequested = await hasRequestedPermission(PermissionName.MEDIA_LIBRARY);
      if (alreadyRequested && !force) {
        permissionDebug("show_notice_instead_of_request", {
          permissionName: PermissionName.MEDIA_LIBRARY,
          reason: "optional_already_requested",
        });
        return { ...current, promptedBefore: true };
      }

      if (typeof MediaLibrary.requestPermissionsAsync !== "function") {
        return normalizePermission(PermissionName.MEDIA_LIBRARY, null);
      }

      permissionDebug("request", { permissionName: PermissionName.MEDIA_LIBRARY });
      await markPermissionRequested(PermissionName.MEDIA_LIBRARY);
      const result = await MediaLibrary.requestPermissionsAsync(false);
      const normalized = normalizePermission(PermissionName.MEDIA_LIBRARY, result);
      permissionDebug("request_result", normalized);
      return normalized;
    } catch (error) {
      permissionDebug("request_failed", { permissionName: PermissionName.MEDIA_LIBRARY, error: error?.message || error });
      return normalizePermission(PermissionName.MEDIA_LIBRARY, null);
    }
  });
};

export const checkImageLibraryPermission = async () => {
  if (typeof ImagePicker.getMediaLibraryPermissionsAsync !== "function") {
    return normalizePermission(PermissionName.IMAGE_LIBRARY, null);
  }

  permissionDebug("check", { permissionName: PermissionName.IMAGE_LIBRARY });
  try {
    const result = await ImagePicker.getMediaLibraryPermissionsAsync();
    const normalized = normalizePermission(PermissionName.IMAGE_LIBRARY, result);
    permissionDebug("check_result", normalized);
    return normalized;
  } catch (error) {
    permissionDebug("check_failed", { permissionName: PermissionName.IMAGE_LIBRARY, error: error?.message || error });
    return normalizePermission(PermissionName.IMAGE_LIBRARY, null);
  }
};

export const requestImageLibraryPermission = async ({ force = false } = {}) => {
  return runSingleRequest(PermissionName.IMAGE_LIBRARY, async () => {
    try {
      const current = await checkImageLibraryPermission();
      if (current.granted || current.canAskAgain === false) return current;

      const alreadyRequested = await hasRequestedPermission(PermissionName.IMAGE_LIBRARY);
      if (alreadyRequested && !force) {
        permissionDebug("show_notice_instead_of_request", {
          permissionName: PermissionName.IMAGE_LIBRARY,
          reason: "optional_already_requested",
        });
        return { ...current, promptedBefore: true };
      }

      permissionDebug("request", { permissionName: PermissionName.IMAGE_LIBRARY });
      await markPermissionRequested(PermissionName.IMAGE_LIBRARY);
      const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
      const normalized = normalizePermission(PermissionName.IMAGE_LIBRARY, result);
      permissionDebug("request_result", normalized);
      return normalized;
    } catch (error) {
      permissionDebug("request_failed", { permissionName: PermissionName.IMAGE_LIBRARY, error: error?.message || error });
      return normalizePermission(PermissionName.IMAGE_LIBRARY, null);
    }
  });
};

export const getPermissionState = async (permissionName) => {
  switch (permissionName) {
    case PermissionName.LOCATION_FOREGROUND:
      return checkLocationPermission();
    case PermissionName.LOCATION_BACKGROUND:
      return checkBackgroundLocationPermission();
    case PermissionName.MEDIA_LIBRARY:
      return checkMediaPermission();
    case PermissionName.IMAGE_LIBRARY:
      return checkImageLibraryPermission();
    case PermissionName.NOTIFICATIONS:
      return checkNotificationPermission();
    default:
      return normalizePermission(permissionName, null);
  }
};

const settledValue = (result, permissionName) =>
  result?.status === "fulfilled" ? result.value : normalizePermission(permissionName, null);

export const getPermissionSummary = async ({ includeMedia = true } = {}) => {
  const checks = [
    checkLocationPermission(),
    checkBackgroundLocationPermission(),
    checkNotificationPermission(),
  ];
  if (includeMedia) {
    checks.push(checkMediaPermission(), checkImageLibraryPermission());
  }

  const results = await Promise.allSettled(checks);
  const foregroundLocation = settledValue(results[0], PermissionName.LOCATION_FOREGROUND);
  const backgroundLocation = settledValue(results[1], PermissionName.LOCATION_BACKGROUND);
  const notifications = settledValue(results[2], PermissionName.NOTIFICATIONS);
  const mediaLibrary = includeMedia ? settledValue(results[3], PermissionName.MEDIA_LIBRARY) : null;
  const imageLibrary = includeMedia ? settledValue(results[4], PermissionName.IMAGE_LIBRARY) : null;

  return {
    foregroundLocation,
    backgroundLocation,
    notifications,
    mediaLibrary,
    imageLibrary,
    canStartRun: foregroundLocation.granted,
    backgroundLimited: !backgroundLocation.granted,
    notificationLimited: !notifications.granted && notifications.status !== PermissionStatus.UNAVAILABLE,
    requiredBlocked: foregroundLocation.status === PermissionStatus.BLOCKED,
    optionalBlocked: [backgroundLocation, notifications, mediaLibrary, imageLibrary]
      .filter(Boolean)
      .some((item) => item.status === PermissionStatus.BLOCKED),
    offlineMessage: "Voce esta offline, mostrando dados locais.",
    localSaveMessage: "Salvo localmente, sincroniza depois.",
  };
};

export default {
  PermissionName,
  PermissionStatus,
  checkBackgroundLocationPermission,
  checkImageLibraryPermission,
  checkLocationPermission,
  checkMediaPermission,
  checkNotificationPermission,
  ensureLocationForRun,
  getPermissionState,
  getPermissionSummary,
  hasRequestedPermission,
  hasShownPermissionNotice,
  markPermissionEducationSeen,
  markPermissionNoticeShown,
  normalizePermissionStatus,
  openAppSettings,
  requestBackgroundLocation,
  requestBackgroundLocationPermission,
  requestForegroundLocation,
  requestImageLibraryPermission,
  requestLocationPermission,
  requestMediaPermission,
  requestNotificationPermission,
  shouldShowPermissionEducation,
};
