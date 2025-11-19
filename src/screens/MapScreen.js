// src/screens/MapScreen.js
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Modal,
} from "react-native";
import MapView, { Polyline, Polygon, Marker, AnimatedRegion } from "react-native-maps";
import NetInfo from "@react-native-community/netinfo";

import { requestLocationPermission, getCurrentPosition, watchPosition } from "../services/location/locationService";
import { loadLocalZones, saveLocalZones, syncZonesToFirestore } from "../services/zones/zoneService";
import { loadCheckpoints, loadVisitedPoints, saveVisitedPoints, findNearbyCheckpoint } from "../services/checkpoints/checkpointService";
import { awardXPToUser } from "../services/xp/xpService";
import { calculateArea, formatArea, getDistance } from "../utils/geo";
import formatTime from "../utils/formatTime";

export default function MapScreen() {
  // states
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

  const [checkpoints, setCheckpoints] = useState([]);
  const [visitedPoints, setVisitedPoints] = useState([]);
  const [rewardModal, setRewardModal] = useState({ visible: false, text: "" });

  const mapRef = useRef(null);
  const coordinate = useRef(new AnimatedRegion({
    latitude: 0, longitude: 0, latitudeDelta: 0.005, longitudeDelta: 0.005
  })).current;

  const [replaying, setReplaying] = useState(false);
  const [selectedReplay, setSelectedReplay] = useState(null);
  const [replayPath, setReplayPath] = useState([]);
  const [showReplayList, setShowReplayList] = useState(false);

  // init
  useEffect(() => {
    let unsubscribeNetInfo;
    const initialize = async () => {
      const ok = await requestLocationPermission();
      if (!ok) {
        Alert.alert("Permissão negada", "Ative o GPS para usar o app.", [
          { text: "Abrir Configurações", onPress: () => {} },
        ]);
        return;
      }

      const pos = await getCurrentPosition();
      setLocation(pos.coords);
      coordinate.timing({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, duration: 500 }).start();

      // zones
      const savedZones = await loadLocalZones();
      setPolygons(savedZones);
      setTotalArea(savedZones.reduce((acc, z) => acc + (z.area || 0), 0));

      // checkpoints & visited
      const savedVisited = await loadVisitedPoints();
      setVisitedPoints(savedVisited);
      const cps = await loadCheckpoints();
      setCheckpoints(cps);

      // net listener
      unsubscribeNetInfo = NetInfo.addEventListener((state) => {
        if (state.isConnected) {
          (async () => {
            const synced = await syncZonesToFirestore(polygons);
            await saveLocalZones(synced);
          })();
        }
      });
    };

    initialize();
    return () => unsubscribeNetInfo && unsubscribeNetInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // center map helper
  const centerMap = (coords) => {
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.001,
        longitudeDelta: 0.001,
      }, 500);
    }
  };

  // run logic
  const startRun = async () => {
    setRunning(true);
    setRoute([]); setDistance(0); setTime(0); setLastArea(null);
    const interval = setInterval(() => setTime(t => t + 1), 1000);
    setTimerInterval(interval);

    const sub = await watchPosition(async (loc) => {
      const { latitude, longitude } = loc.coords;
      setLocation(loc.coords);
      coordinate.timing({ latitude, longitude, duration: 500 }).start();

      setRoute((prev) => {
        if (prev.length > 0) {
          const last = prev[prev.length - 1];
          setDistance(d => d + getDistance(last.latitude, last.longitude, latitude, longitude));
        }
        return [...prev, { latitude, longitude }];
      });

      // checkpoint detection
      const nearby = findNearbyCheckpoint({ latitude, longitude }, checkpoints, visitedPoints);
      if (nearby) {
        await handleCheckpointReached(nearby);
      }
    });

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
    const newZone = { coords: closed, area, date: new Date().toISOString(), synced: false };
    const updated = [...polygons, newZone];
    setPolygons(updated);
    setTotalArea(updated.reduce((acc, z) => acc + z.area, 0));
    await saveLocalZones(updated);

    Alert.alert("Corrida finalizada!", `Área registrada: ${formatArea(area)}`);
  };

  // checkpoint reached handler
  const handleCheckpointReached = async (cp) => {
    try {
      if (visitedPoints.includes(cp.id)) return;

      const updatedVisited = [...visitedPoints, cp.id];
      setVisitedPoints(updatedVisited);
      await saveVisitedPoints(updatedVisited);

      await awardXPToUser(cp);

      setRewardModal({ visible: true, text: `Você ganhou ${cp.bonusXP || 0} XP em ${cp.name}` });
      setTimeout(() => setRewardModal({ visible: false, text: "" }), 3000);
    } catch (err) {
      console.error("handleCheckpointReached:", err);
    }
  };

  // sync zones manual (exposed if needed)
  const syncZones = async () => {
    const synced = await syncZonesToFirestore(polygons);
    setPolygons(synced);
    await saveLocalZones(synced);
  };

  // replay logic
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

  if (!location) return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#00b894" />
      <Text>Carregando mapa...</Text>
    </View>
  );

  return (
    <View style={styles.container}>
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
        {running && route.length > 1 && <Polyline coordinates={route} strokeWidth={5} strokeColor="#0984e3" />}
        {replaying && replayPath.length > 1 && <Polyline coordinates={replayPath} strokeWidth={5} strokeColor="#fdcb6e" />}
        {polygons.map((z, i) => <Polygon key={i} coordinates={z.coords} fillColor="rgba(0, 184, 148, 0.3)" strokeColor="#00b894" strokeWidth={2} />)}
        {checkpoints.filter(cp => cp && typeof cp.latitude === "number" && typeof cp.longitude === "number").map(cp => (
          <Marker
            key={cp.id}
            coordinate={{ latitude: cp.latitude, longitude: cp.longitude }}
            title={cp.name}
            description={cp.description}
            pinColor={cp.partner ? "#ff9f43" : "#0984e3"}
            onPress={() => centerMap({ latitude: cp.latitude, longitude: cp.longitude })}
          />
        ))}
        {location && <Marker.Animated coordinate={coordinate}><View style={styles.myLocationDot} /></Marker.Animated>}
      </MapView>

      <Modal visible={rewardModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.rewardBox}>
            <Text style={{ fontWeight: "700" }}>{rewardModal.text}</Text>
            <TouchableOpacity onPress={() => setRewardModal({ visible: false, text: "" })} style={{ marginTop: 10 }}>
              <Text style={{ color: "#00b894" }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {(running || replaying) && (
        <View style={styles.activeCard}>
          <Text style={styles.title}>{replaying ? "🎬 Reproduzindo Trajeto" : "🏃 Corrida Ativa"}</Text>
          <Text>⏱️ Tempo: {formatTime(time)}</Text>
          <Text>📍 Distância: {(distance / 1000).toFixed(2)} km</Text>
          {lastArea && !running && <Text>🗺️ Última área: {formatArea(lastArea)}</Text>}
        </View>
      )}

      <View style={styles.bottomButtons}>
        {!replaying && (
          <>
            <TouchableOpacity style={[styles.mainButton, { backgroundColor: running ? "#d63031" : "#00b894" }]} onPress={running ? stopRun : startRun}>
              <Text style={styles.mainButtonText}>{running ? "Finalizar Corrida" : "Iniciar Corrida"}</Text>
            </TouchableOpacity>
            {!running && (
              <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: "#0984e3" }]} onPress={() => setShowReplayList(true)}>
                <Text style={styles.mainButtonText}>Reproduzir Corrida</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {replaying && <TouchableOpacity style={[styles.mainButton, { backgroundColor: "#d63031" }]} onPress={stopReplay}><Text style={styles.mainButtonText}>Parar Reprodução</Text></TouchableOpacity>}
      </View>

      <Modal visible={showReplayList} animationType="slide">
        <View style={styles.modal}>
          <Text style={styles.title}>Corridas Salvas</Text>
          <FlatList
            data={polygons}
            keyExtractor={(item) => item.date}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.replayItem} onPress={() => startReplay(item)}>
                <Text>{new Date(item.date).toLocaleString()}</Text>
                <Text>{formatArea(item.area)}</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity style={[styles.mainButton, { marginTop: 20 }]} onPress={() => setShowReplayList(false)}>
            <Text style={styles.mainButtonText}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  activeCard: { position: "absolute", top: 100, alignSelf: "center", backgroundColor: "white", padding: 15, borderRadius: 10, elevation: 5, alignItems: "center" },
  title: { fontWeight: "bold", fontSize: 16, marginBottom: 5 },
  bottomButtons: { position: "absolute", bottom: 40, width: "100%", paddingHorizontal: 20 },
  mainButton: { padding: 15, borderRadius: 10, marginBottom: 10, alignItems: "center" },
  secondaryButton: { padding: 15, borderRadius: 10, alignItems: "center" },
  mainButtonText: { color: "white", fontWeight: "bold" },
  myLocationDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#e17055", borderWidth: 2, borderColor: "white" },
  modal: { flex: 1, padding: 20, backgroundColor: "#f5f6fa" },
  replayItem: { padding: 15, marginVertical: 5, backgroundColor: "white", borderRadius: 10, elevation: 2, flexDirection: "row", justifyContent: "space-between" },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center" },
  rewardBox: { backgroundColor: "#fff", padding: 18, borderRadius: 12, width: "80%", alignItems: "center" },
});
