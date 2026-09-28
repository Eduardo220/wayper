import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  LOCATION_PRECISION_MODE,
  updateDiagnosticsConfig,
} from "../../config/diagnosticsConfig.js";

export const PRECISE_LOCATION_DIAGNOSTICS_KEY = "wayper:diagnostics:preciseLocation:v1";

export async function initializeDiagnosticsPreferences() {
  try {
    const enabled = (await AsyncStorage.getItem(PRECISE_LOCATION_DIAGNOSTICS_KEY)) === "true";
    updateDiagnosticsConfig({
      allowPreciseLocationLogs: enabled,
      locationPrecisionMode: enabled
        ? LOCATION_PRECISION_MODE.full
        : LOCATION_PRECISION_MODE.masked,
    });
    return enabled;
  } catch {
    updateDiagnosticsConfig({
      allowPreciseLocationLogs: false,
      locationPrecisionMode: LOCATION_PRECISION_MODE.masked,
    });
    return false;
  }
}

export async function setPreciseLocationDiagnosticsEnabled(enabled) {
  const next = enabled === true;
  await AsyncStorage.setItem(PRECISE_LOCATION_DIAGNOSTICS_KEY, String(next));
  updateDiagnosticsConfig({
    allowPreciseLocationLogs: next,
    locationPrecisionMode: next
      ? LOCATION_PRECISION_MODE.full
      : LOCATION_PRECISION_MODE.masked,
  });
  return next;
}

export default {
  PRECISE_LOCATION_DIAGNOSTICS_KEY,
  initializeDiagnosticsPreferences,
  setPreciseLocationDiagnosticsEnabled,
};
