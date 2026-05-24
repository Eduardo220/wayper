import { Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";

export const PermissionStatus = {
  GRANTED: "granted",
  DENIED: "denied",
  BLOCKED: "blocked",
  UNAVAILABLE: "unavailable",
  UNDETERMINED: "undetermined",
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
    console.log(`[Wayper Permissions] ${event}`, payload);
  }
};

const storageKey = (permissionName, kind) => `${STORAGE_PREFIX}:${permissionName}:${kind}`;

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
  let status = rawStatus;

  if (response.granted || rawStatus === PermissionStatus.GRANTED) {
    status = PermissionStatus.GRANTED;
  } else if (rawStatus === "undetermined" || rawStatus === "notDetermined") {
    status = PermissionStatus.UNDETERMINED;
  } else if (canAskAgain === false) {
    status = PermissionStatus.BLOCKED;
  } else if (rawStatus === "denied") {
    status = PermissionStatus.DENIED;
  }

  return {
    permissionName,
    status,
    granted: status === PermissionStatus.GRANTED,
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
    try {
      await markPermissionRequested(PermissionName.LOCATION_FOREGROUND);
      const result = await Location.requestForegroundPermissionsAsync();
      const normalized = normalizePermission(PermissionName.LOCATION_FOREGROUND, result);
      permissionDebug("request_result", normalized);
      return normalized;
    } catch (error) {
      permissionDebug("request_failed", { permissionName: PermissionName.LOCATION_FOREGROUND, error: error?.message || error });
      return normalizePermission(PermissionName.LOCATION_FOREGROUND, null);
    }
  });
};

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
    try {
      await markPermissionRequested(PermissionName.LOCATION_BACKGROUND);
      const result = await Location.requestBackgroundPermissionsAsync();
      const normalized = normalizePermission(PermissionName.LOCATION_BACKGROUND, result);
      permissionDebug("request_result", normalized);
      return normalized;
    } catch (error) {
      permissionDebug("request_failed", { permissionName: PermissionName.LOCATION_BACKGROUND, error: error?.message || error });
      return normalizePermission(PermissionName.LOCATION_BACKGROUND, null);
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
    default:
      return normalizePermission(permissionName, null);
  }
};
