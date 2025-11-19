// src/services/location/locationService.js
import * as Location from "expo-location";
import { getDistance } from "../../utils/geo"; // Ajusta se teu caminho for diferente

let lastPoint = null;

export async function requestLocationPermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

export async function getCurrentPosition() {
  return await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
  });
}

export async function watchPosition(onChange) {
  return await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Highest,   // precisão máxima
      timeInterval: 1000,                   // 1 segundo entre updates
      distanceInterval: 1,                  // só registra se andou pelo menos 1m
    },

    (loc) => {
      const { latitude, longitude, accuracy } = loc.coords;

      // 1) IGNORA UPDATE IMUNDO
      if (!accuracy || accuracy > 20) return;

      // 2) IGNORA TELEPORTE DE GPS
      if (lastPoint) {
        const dist = getDistance(
          lastPoint.latitude,
          lastPoint.longitude,
          latitude,
          longitude
        );

        // se saltou mais de 8m em 1 segundo... é mentira
        if (dist > 8) return;
      }

      // 3) SUAVIZAÇÃO PRA NÃO FICAR ZIG-ZAG
      const smooth = lastPoint
        ? {
            latitude:
              lastPoint.latitude +
              (latitude - lastPoint.latitude) * 0.25, // suaviza 25%
            longitude:
              lastPoint.longitude +
              (longitude - lastPoint.longitude) * 0.25,
          }
        : { latitude, longitude };

      lastPoint = smooth;

      // devolve a coordenada filtrada e suavizada
      onChange({ coords: smooth });
    }
  );
}
