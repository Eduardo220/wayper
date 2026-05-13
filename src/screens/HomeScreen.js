import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Location from "expo-location";
import WayperMapLibre from "../components/Map/WayperMapLibre";

function getDistance(lat1, lon1, lat2, lon2) {
  const radius = 6371e3;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function HomeScreen() {
  const [location, setLocation] = useState(null);
  const [route, setRoute] = useState([]);
  const [watcher, setWatcher] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [distance, setDistance] = useState(0);
  const [time, setTime] = useState(0);
  const [timerInterval, setTimerInterval] = useState(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permissão negada", "Ative o GPS para usar o app.");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
    })();
  }, []);

  const startRun = async () => {
    setIsRunning(true);
    setRoute([]);
    setDistance(0);
    setTime(0);

    const interval = setInterval(() => {
      setTime((prev) => prev + 1);
    }, 1000);
    setTimerInterval(interval);

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 1000,
        distanceInterval: 2,
      },
      (newLocation) => {
        const { latitude, longitude } = newLocation.coords;
        setLocation(newLocation.coords);
        setRoute((prevRoute) => {
          if (prevRoute.length > 0) {
            const last = prevRoute[prevRoute.length - 1];
            const addedDistance = getDistance(last.latitude, last.longitude, latitude, longitude);
            setDistance((prev) => prev + addedDistance);
          }
          return [...prevRoute, { latitude, longitude }];
        });
      }
    );

    setWatcher(subscription);
  };

  const stopRun = () => {
    setIsRunning(false);
    if (watcher) watcher.remove();
    if (timerInterval) clearInterval(timerInterval);
    setWatcher(null);
    setTimerInterval(null);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  if (!location) {
    return <Text style={{ marginTop: 50, textAlign: "center" }}>Carregando mapa...</Text>;
  }

  return (
    <View style={styles.container}>
      <WayperMapLibre
        style={styles.map}
        location={location}
        centerCoordinate={location}
        routePath={route}
        showUserLocation={true}
        followUserLocation={isRunning}
        initialZoom={15}
        followZoomLevel={17}
      />

      {isRunning && (
        <View style={styles.infoPanel}>
          <Text style={styles.infoText}>Tempo: {formatTime(time)}</Text>
          <Text style={styles.infoText}>Distância: {(distance / 1000).toFixed(2)} km</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: isRunning ? "#FF6347" : "#00e676" }]}
        onPress={isRunning ? stopRun : startRun}
      >
        <Text style={styles.buttonText}>{isRunning ? "Parar corrida" : "Iniciar corrida"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  infoPanel: {
    position: "absolute",
    top: 40,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  infoText: {
    backgroundColor: "rgba(0,0,0,0.6)",
    color: "#fff",
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginVertical: 4,
  },
  button: {
    position: "absolute",
    bottom: 40,
    left: "25%",
    right: "25%",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 16,
  },
});
