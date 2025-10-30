// src/screens/MapScreen.js
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
import { collection, addDoc, doc, getDoc, setDoc, getDocs, query } from "firebase/firestore";
import { db, auth } from "../firebaseConfig";
import * as turf from "@turf/turf";
import formatTime from '../utils/formatTime';


const ZONES_KEY = "zones";
const VISITED_KEY = "visited_checkpoints";

// helper distance (m)
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
  const turfPolygon = turf.polygon([polygon.map((p) => [p.longitude, p.latitude])]);
  return turf.area(turfPolygon);
};

const formatDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR");
};

export default function MapScreen() {
  // existing state
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

  // new: checkpoints
  const [checkpoints, setCheckpoints] = useState([]); // loaded from Firestore
  const [visitedPoints, setVisitedPoints] = useState([]); // ids visited on device
  const [rewardModal, setRewardModal] = useState({ visible: false, text: "" });

  const mapRef = useRef(null);
  const coordinate = useRef(new AnimatedRegion({
    latitude: 0, longitude: 0, latitudeDelta: 0.005, longitudeDelta: 0.005
  })).current;

  // replay states (kept as in your version)
  const [replaying, setReplaying] = useState(false);
  const [selectedReplay, setSelectedReplay] = useState(null);
  const [replayPath, setReplayPath] = useState([]);
  const [showReplayList, setShowReplayList] = useState(false);

  // ================= init =================
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
      coordinate.timing({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, duration: 500 }).start();

      // load saved zones (existing)
      const saved = await AsyncStorage.getItem(ZONES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPolygons(parsed);
        setTotalArea(parsed.reduce((acc, z) => acc + (z.area || 0), 0));
      }

      // load visited checkpoints local
      const savedVisited = await AsyncStorage.getItem(VISITED_KEY);
      if (savedVisited) setVisitedPoints(JSON.parse(savedVisited));

      // load checkpoints from Firestore
      await loadCheckpointsFromFirestore();

      unsubscribeNetInfo = NetInfo.addEventListener((state) => {
        if (state.isConnected) {
          syncZones(); // your existing sync
          loadCheckpointsFromFirestore(); // refresh remote checkpoints
        }
      });
    };

    initialize();
    return () => unsubscribeNetInfo && unsubscribeNetInfo();
  }, []);

  // ================= load checkpoints =================
  const loadCheckpointsFromFirestore = async () => {
    try {
      const q = query(collection(db, "checkpoints"));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCheckpoints(list);
      console.log("Loaded checkpoints:", list.length);
    } catch (err) {
      console.error("Erro ao carregar checkpoints:", err);
    }
  };

  // ================= center map =================
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
  useEffect(() => { if (location) centerMap(location); }, [location]);

  // ================= run logic (watch position + checkpoint detection) =================
  const startRun = async () => {
    setRunning(true);
    setRoute([]); setDistance(0); setTime(0); setLastArea(null);
    const interval = setInterval(() => setTime(t => t + 1), 1000);
    setTimerInterval(interval);

    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 2 },
      async (loc) => {
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

        // check proximity to checkpoints
        checkNearbyCheckpoint({ latitude, longitude });
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
    const newZone = { coords: closed, area, date: new Date().toISOString(), synced: false };
    const updated = [...polygons, newZone];
    setPolygons(updated);
    setTotalArea(updated.reduce((acc, z) => acc + z.area, 0));
    await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(updated));

    Alert.alert("Corrida finalizada!", `Área registrada: ${area > 10000 ? (area/1e6).toFixed(2)+' km²' : Math.round(area)+' m²'}`);
  };

  // ================= proximity check =================
  // radius meters to award
  const PROXIMITY_RADIUS_M = 50;

  const checkNearbyCheckpoint = async (pos) => {
    if (!checkpoints || checkpoints.length === 0) return;
    for (const cp of checkpoints) {
      if (visitedPoints.includes(cp.id)) continue; // já visitado

      const d = getDistance(pos.latitude, pos.longitude, cp.latitude, cp.longitude);
      if (d <= PROXIMITY_RADIUS_M) {
        // award
        await handleCheckpointReached(cp);
        break; // evita múltiplos ao mesmo tempo
      }
    }
  };

  const handleCheckpointReached = async (cp) => {
    try {
      // mark visited local
      const updatedVisited = [...visitedPoints, cp.id];
      setVisitedPoints(updatedVisited);
      await AsyncStorage.setItem(VISITED_KEY, JSON.stringify(updatedVisited));

      // award XP locally and in Firestore user doc
      await awardXPToUser(cp.bonusXP || 0, cp);

      // show modal
      setRewardModal({ visible: true, text: `Você ganhou ${cp.bonusXP || 0} XP em ${cp.name}` });

      // auto-close modal after 3s
      setTimeout(() => setRewardModal({ visible: false, text: "" }), 3000);
    } catch (err) {
      console.error("Erro ao processar checkpoint:", err);
    }
  };

  const awardXPToUser = async (xpAmount, cp) => {
    if (!auth?.currentUser) {
      console.log("Usuário offline: XP localizado apenas no device");
      // poderia salvar em uma fila local para sincronizar depois
      return;
    }
    try {
      const userRef = doc(db, "usuarios", auth.currentUser.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        const prevXP = data.xp || 0;
        const prevVisited = data.visitedCheckpoints || [];
        const newXP = prevXP + xpAmount;
        const newVisited = Array.from(new Set([...prevVisited, cp.id]));
        await setDoc(userRef, { xp: newXP, visitedCheckpoints: newVisited }, { merge: true });
      } else {
        await setDoc(userRef, { xp: xpAmount, visitedCheckpoints: [cp.id], nome: auth.currentUser.displayName || "Usuário" });
      }
      console.log("XP adicionado no Firestore:", xpAmount);
    } catch (err) {
      console.error("Erro ao atualizar XP do usuário:", err);
    }
  };

  // ================= sync zones (mantive sua função) =================
  const syncZones = async () => {
    const unsynced = polygons.filter((z) => !z.synced);
    for (const zone of unsynced) {
      try {
        await addDoc(collection(db, "zonas"), {
          userId: auth?.currentUser?.uid || "offline",
          coords: zone.coords,
          area: zone.area,
          date: zone.date,
        });
      } catch (err) {
        console.error("Erro ao enviar zona:", err);
      }
    }
    const updated = polygons.map((z) => ({ ...z, synced: true }));
    setPolygons(updated);
    await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(updated));
  };

  // ================= replay logic (mantive seu código) =================
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

  // ================= UI loader =================
  if (!location) return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#00b894" />
      <Text>Carregando mapa...</Text>
    </View>
  );

  // ================= Render =================
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
        {running && route.length > 1 && (
          <Polyline coordinates={route} strokeWidth={5} strokeColor="#0984e3" />
        )}

        {replaying && replayPath.length > 1 && (
          <Polyline coordinates={replayPath} strokeWidth={5} strokeColor="#fdcb6e" />
        )}

        {polygons.map((z, i) => (
          <Polygon key={i} coordinates={z.coords} fillColor="rgba(0, 184, 148, 0.3)" strokeColor="#00b894" strokeWidth={2} />
        ))}

        {/* markers: checkpoints */}
        {checkpoints.map((cp) => (
          <Marker
            key={cp.id}
            coordinate={{ latitude: cp.latitude, longitude: cp.longitude }}
            title={cp.name}
            description={cp.description}
            pinColor={cp.partner ? "#ff9f43" : "#0984e3"}
            onPress={() => centerMap({ latitude: cp.latitude, longitude: cp.longitude })}
          />
        ))}

        <Marker.Animated coordinate={coordinate}>
          <View style={styles.myLocationDot} />
        </Marker.Animated>
      </MapView>

      {/* reward modal */}
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

      {/* active card */}
      {(running || replaying) && (
        <View style={styles.activeCard}>
          <Text style={styles.title}>{replaying ? "🎬 Reproduzindo Trajeto" : "🏃 Corrida Ativa"}</Text>
          <Text>⏱️ Tempo: {formatTime(time)}</Text>
          <Text>📍 Distância: {(distance / 1000).toFixed(2)} km</Text>
          {lastArea && !running && <Text>🗺️ Última área: {formatArea(lastArea)}</Text>}
        </View>
      )}

      {/* Buttons */}
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

      {/* Replay modal */}
      <Modal visible={showReplayList} animationType="slide">
        <View style={styles.modal}>
          <Text style={styles.title}>Corridas Salvas</Text>
          <FlatList
            data={polygons}
            keyExtractor={(item) => item.date}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.replayItem} onPress={() => startReplay(item)}>
                <Text>{formatDate(item.date)}</Text>
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
