// src/services/location/locationService.js
import * as Location from "expo-location";

export async function requestLocationPermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

export async function getCurrentPosition() {
  return await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.BestForNavigation,
  });
}

export async function watchPosition(onChange) {
  const subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 1000,
      distanceInterval: 1,
    },

    (loc) => {
      if (!loc || !loc.coords) return;

      const { latitude, longitude, accuracy } = loc.coords;
      if (!accuracy || accuracy > 50) return;

      onChange({
        coords: {
          latitude,
          longitude,
          accuracy,
          timestamp: Date.now(),
        },
      });
    }
  );

  return {
    remove: () => subscription.remove(),
  };
}
