import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  FlatList,
  Modal,
} from "react-native";
import * as Location from "expo-location";
import MapView, { Polyline, Polygon, Marker, AnimatedRegion } from "react-native-maps";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { collection, addDoc } from "firebase/firestore";
import { db, auth } from "../firebaseConfig";
import * as turf from "@turf/turf";
import { Animated } from "react-native";

// ================= Funções auxiliares =================
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const calculateArea = (polygon) => {
  if (polygon.length < 3) return 0;
  const turfPolygon = turf.polygon([
    [...polygon.map((p) => [p.longitude, p.latitude]), [polygon[0].longitude, polygon[0].latitude]],
  ]);
  return turf.area(turfPolygon);
};

const formatDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR");
};

// ================= Componente principal =================
export default function MapScreen() {
  const [location, setLocation] = useState(null);
  const [running, setRunning] = useState(false);
  const [route, setRoute] = useState([]);
  const [distance, setDistance] = useState(0);
  const [time, setTime] = useState(0);
  const [timerInterval, setTimerInterval] = useState(null);
  const [lastArea, setLastArea] = useState(null);
  const [watcher, setWatcher] = useState(null);
  const [polygons, setPolygons] = useState([]);
  const [totalArea, setTotalArea] = useState(0);

  const animatedMarker = useRef(null);
  const coordinate = useRef(
    new AnimatedRegion({
      latitude: 0,
      longitude: 0,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    })
  ).current;
  const mapRef = useRef(null);

  // Replay
  const [replaying, setReplaying] = useState(false);
  const [selectedReplay, setSelectedReplay] = useState(null);
  const [replayPath, setReplayPath] = useState([]);
  const [showReplayList, setShowReplayList] = useState(false);

  const ZONES_KEY = "zones";

  // ================= Inicialização =================
  useEffect(() => {
    let unsubscribeNetInfo;

    const initialize = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permissão negada", "Ative o GPS para usar o app.", [
          { text: "Abrir Configurações", onPress: () => Location.openSettings() },
        ]);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
      coordinate.timing({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        duration: 500,
      }).start();

      const saved = await AsyncStorage.getItem(ZONES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPolygons(parsed);
        setTotalArea(parsed.reduce((acc, z) => acc + (z.area || 0), 0));
      }

      unsubscribeNetInfo = NetInfo.addEventListener((state) => {
        if (state.isConnected) syncZones();
      });
    };

    initialize();

    return () => unsubscribeNetInfo && unsubscribeNetInfo();
  }, []);

  // ================= Centraliza mapa =================
  const centerMap = (coords) => {
    if (mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: 0.001,
          longitudeDelta: 0.001,
        },
        500
      );
    }
  };

  useEffect(() => {
    if (location) centerMap(location);
  }, [location]);

  // ================= Formatação =================
  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const formatArea = (a) =>
    a > 10000 ? `${(a / 1_000_000).toFixed(2)} km²` : `${a.toFixed(0)} m²`;

  // ================= Corrida =================
  const startRun = async () => {
    setRunning(true);
    setRoute([]);
    setDistance(0);
    setTime(0);
    setLastArea(null);

    const interval = setInterval(() => setTime((t) => t + 1), 1000);
    setTimerInterval(interval);

    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 1000,
        distanceInterval: 2,
      },
      (loc) => {
        const { latitude, longitude } = loc.coords;
        setLocation(loc.coords);
        coordinate.timing({ latitude, longitude, duration: 500 }).start();

        setRoute((prev) => {
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            setDistance(
              (d) => d + getDistance(last.latitude, last.longitude, latitude, longitude)
            );
          }
          return [...prev, { latitude, longitude }];
        });
      }
    );
    setWatcher(sub);
  };

  const stopRun = async () => {
    setRunning(false);
    if (watcher) watcher.remove();
    if (timerInterval) clearInterval(timerInterval);

    if (route.length <= 2) return;

    const closed = [...route, route[0]];
    const area = calculateArea(closed);
    setLastArea(area);

    const newZone = {
      coords: closed,
      area,
      date: new Date().toISOString(),
      synced: false,
    };

    const updated = [...polygons, newZone];
    setPolygons(updated);
    setTotalArea(updated.reduce((acc, z) => acc + z.area, 0));
    await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(updated));

    Alert.alert("Corrida finalizada!", `Área registrada: ${formatArea(area)}`);
  };

  // ================= Replay =================
  useEffect(() => {
    let replayInterval;
    if (replaying && selectedReplay) {
      const coords = selectedReplay.coords;
      let i = 0;

      replayInterval = setInterval(() => {
        if (i >= coords.length) {
          clearInterval(replayInterval);
          setReplaying(false);
          return;
        }
        const point = coords[i];
        coordinate.timing({ latitude: point.latitude, longitude: point.longitude, duration: 250 }).start();
        setReplayPath((prev) => [...prev, point]);
        i++;
      }, 250);
    }

    return () => replayInterval && clearInterval(replayInterval);
  }, [replaying, selectedReplay]);

  const startReplay = (zone) => {
    setSelectedReplay(zone);
    setReplayPath([]);
    setReplaying(true);
    setShowReplayList(false);
  };

  const stopReplay = () => {
    setReplaying(false);
    setSelectedReplay(null);
    setReplayPath([]);
  };

  // ================= Sincronização =================
  const syncZones = async () => {
    const unsynced = polygons.filter((z) => !z.synced);
    for (const zone of unsynced) {
      await addDoc(collection(db, "zonas"), {
        userId: auth?.currentUser?.uid || "offline",
        coords: zone.coords,
        area: zone.area,
        date: zone.date,
      });
    }

    const updated = polygons.map((z) =>
      unsynced.some((u) => u.date === z.date) ? { ...z, synced: true } : z
    );
    setPolygons(updated);
    await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(updated));
  };

  // ================= Loader =================
  if (!location)
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#00b894" />
        <Text>Carregando mapa...</Text>
      </View>
    );

  // ================= Render =================
  return (
    <View style={styles.container}>
      {/* MAPA */}
      <MapView
        ref={mapRef}
        style={styles.map}
        region={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.001,
          longitudeDelta: 0.001,
        }}
      >
        {running && route.length > 1 && (
          <Polyline coordinates={route} strokeWidth={5} strokeColor="#0984e3" />
        )}

        {replaying && replayPath.length > 1 && (
          <Polyline coordinates={replayPath} strokeWidth={5} strokeColor="#fdcb6e" />
        )}

        {polygons.map((z, i) => (
          <Polygon
            key={i}
            coordinates={z.coords}
            fillColor="rgba(0, 184, 148, 0.3)"
            strokeColor="#00b894"
            strokeWidth={2}
          />
        ))}

        <Marker.Animated coordinate={coordinate}>
          <View style={styles.myLocationDot} />
        </Marker.Animated>
      </MapView>

      {/* CARD ATIVO */}
      {(running || replaying) && (
        <View style={styles.activeCard}>
          <Text style={styles.title}>
            {replaying ? "🎬 Reproduzindo Trajeto" : "🏃 Corrida Ativa"}
          </Text>
          <Text>⏱️ Tempo: {formatTime(time)}</Text>
          <Text>📍 Distância: {(distance / 1000).toFixed(2)} km</Text>
          {lastArea && !running && (
            <Text>🗺️ Última área: {formatArea(lastArea)}</Text>
          )}
        </View>
      )}

      {/* BOTÕES */}
      <View style={styles.bottomButtons}>
        {!replaying && (
          <>
            <TouchableOpacity
              style={[
                styles.mainButton,
                { backgroundColor: running ? "#d63031" : "#00b894" },
              ]}
              onPress={running ? stopRun : startRun}
            >
              <Text style={styles.mainButtonText}>
                {running ? "Finalizar Corrida" : "Iniciar Corrida"}
              </Text>
            </TouchableOpacity>

            {!running && (
              <TouchableOpacity
                style={[styles.secondaryButton, { backgroundColor: "#0984e3" }]}
                onPress={() => setShowReplayList(true)}
              >
                <Text style={styles.mainButtonText}>Reproduzir Corrida</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {replaying && (
          <TouchableOpacity style={[styles.mainButton, { backgroundColor: "#d63031" }]} onPress={stopReplay}>
            <Text style={styles.mainButtonText}>Parar Reprodução</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* MODAL REPLAY */}
      <Modal visible={showReplayList} animationType="slide">
        <View style={styles.modal}>
          <Text style={styles.title}>Corridas Salvas</Text>
          <FlatList
            data={polygons}
            keyExtractor={(item) => item.date}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.replayItem}
                onPress={() => startReplay(item)}
              >
                <Text>{formatDate(item.date)}</Text>
                <Text>{formatArea(item.area)}</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity
            style={[styles.mainButton, { marginTop: 20 }]}
            onPress={() => setShowReplayList(false)}
          >
            <Text style={styles.mainButtonText}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

// ================= ESTILOS =================
const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  // Botão/ícone do lado esquerdo
  leftText: {
    fontSize: 16,
    color: "#636e72",
  },

  activeCard: {
    position: "absolute",
    top: 100,
    alignSelf: "center",
    backgroundColor: "white",
    padding: 15,
    borderRadius: 10,
    elevation: 5,
    alignItems: "center",
  },
  title: { fontWeight: "bold", fontSize: 16, marginBottom: 5 },

  bottomButtons: {
    position: "absolute",
    bottom: 40,
    width: "100%",
    paddingHorizontal: 20,
  },
  mainButton: {
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: "center",
  },
  secondaryButton: { padding: 15, borderRadius: 10, alignItems: "center" },
  mainButtonText: { color: "white", fontWeight: "bold" },

  myLocationDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#e17055",
    borderWidth: 2,
    borderColor: "white",
  },
  modal: { flex: 1, padding: 20, backgroundColor: "#f5f6fa" },
  replayItem: {
    padding: 15,
    marginVertical: 5,
    backgroundColor: "white",
    borderRadius: 10,
    elevation: 2,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
});
