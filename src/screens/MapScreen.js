// src/screens/MapScreen.js
// MAP SCREEN - WAYPER (raw GPS mode, no smoothing)

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Modal,
  Alert,
  AppState,
} from "react-native";
import MapView, { Marker, Polyline, Polygon, AnimatedRegion } from "react-native-maps";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";


/* Haversine distance (meters) */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function MapScreen() {
  // UI + flow
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [running, setRunning] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [showReplayList, setShowReplayList] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [selectModeVisible, setSelectModeVisible] = useState(false);
  const [counting, setCounting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // metrics & states
  const [route, setRoute] = useState([]);
  const [routeState, setRouteState] = useState([]); // rendered trail
  const [replayPathState, setReplayPathState] = useState([]);
  const [distanceState, setDistanceState] = useState(0);
  const [timeSec, setTimeSec] = useState(0);
  const [runs, setRuns] = useState([]);
  const [polygons, setPolygons] = useState([]);
  const [mode, setMode] = useState(null); // 'free' | 'zones'

  // refs (performance)
  const mapRef = useRef(null);
  const coordinate = useRef(new AnimatedRegion({ latitude: 0, longitude: 0, latitudeDelta: 0.001, longitudeDelta: 0.001 })).current;
  const watcherRef = useRef(null);
  const flushIntervalRef = useRef(null);
  const timerRef = useRef(null);
  const replayIntervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  // buffer + last point + distance
  const lastPointRef = useRef(null);
  const routeBufferRef = useRef([]);
  const distanceRef = useRef(0);

  /* TUNABLES - raw GPS mode (no smoothing) */
  const MIN_ACCURACY = 100; // accept up to 100m accuracy; still allows very noisy devices to be used
  const FLUSH_INTERVAL_MS = 200; // flush buffer to state every 200ms (keeps UI responsive)
  // NOTE: MIN_POINT_DISTANCE removed — we accept raw points

  /* =============== init =============== */
  useEffect(() => {
    let cleanup = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permissão", "Permita o GPS para usar o app.");
          setLoading(false);
          return;
        }

        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const coords = pos.coords || { latitude: 0, longitude: 0 };
        const initial = { latitude: coords.latitude, longitude: coords.longitude };
        setLocation(initial);
        try { coordinate.setValue(initial); } catch {}

        // start route buffer flush interval
        if (!flushIntervalRef.current) {
          flushIntervalRef.current = setInterval(() => flushRouteBufferToState(), FLUSH_INTERVAL_MS);
        }

        // optional: listen app state for backgrounding
        const sub = AppState.addEventListener("change", (next) => {
          appStateRef.current = next;
        });
      } catch (e) {
        console.warn("init error", e);
      } finally {
        if (!cleanup) setLoading(false);
      }
    })();

    return () => {
      cleanup = true;
      if (flushIntervalRef.current) { clearInterval(flushIntervalRef.current); flushIntervalRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (replayIntervalRef.current) { clearInterval(replayIntervalRef.current); replayIntervalRef.current = null; }
      if (watcherRef.current && typeof watcherRef.current.remove === "function") {
        try { watcherRef.current.remove(); } catch {}
        watcherRef.current = null;
      }
    };
  }, []);

  /* =============== buffer flush =============== */
  function flushRouteBufferToState() {
    if (routeBufferRef.current.length === 0) return;
    setRouteState((prev) => {
      const next = prev.concat(routeBufferRef.current);
      routeBufferRef.current = [];
      return next;
    });
    setDistanceState(distanceRef.current);
  }

  /* =============== location processing (RAW) =============== */
  function handleLocationUpdate(raw) {
    if (!raw || typeof raw.latitude !== "number" || typeof raw.longitude !== "number") return;

    // raw point (no filter)
    const now = Date.now();
    const point = {
      latitude: raw.latitude,
      longitude: raw.longitude,
      timestamp: now,
    };

    // move the DOT smoothly (still just visual)
    try {
      coordinate.timing({
        latitude: point.latitude,
        longitude: point.longitude,
        duration: 120,
        useNativeDriver: false
      }).start();
    } catch {
      try { coordinate.setValue({ latitude: point.latitude, longitude: point.longitude }); } catch {}
    }

    // always keep location state so MapView initial/region can use it
    setLocation({ latitude: point.latitude, longitude: point.longitude });

    // if not running, we don't record trail
    if (!running) return;

    // if first point, accept it
    if (!lastPointRef.current) {
      lastPointRef.current = point;
      routeBufferRef.current.push(point);
      return;
    }

    // calculate distance from last raw point (no smoothing)
    const last = lastPointRef.current;
    const dist = haversineDistance(last.latitude, last.longitude, point.latitude, point.longitude);

    // accept the raw point always (no minimum). Still guard gross jumps: if dist is absurd, ignore.
    if (isFinite(dist) && dist < 1000) {
      routeBufferRef.current.push(point);
      distanceRef.current += dist;
      lastPointRef.current = point;
    } else {
      // ignore absurd jump but keep lastPointRef the same
      // do nothing
    }
  }

  /* =============== start / stop core (raw mode) =============== */
  async function startRunCore(selectedMode = "free") {
    setMode(selectedMode);

    // prepare state BEFORE starting watcher
    setRunning(true);
    setReplaying(false);

    routeBufferRef.current = [];
    lastPointRef.current = null;

    setRouteState([]);
    distanceRef.current = 0;
    setDistanceState(0);
    setTimeSec(0);

    // start timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = setInterval(() => {
      setTimeSec((t) => t + 1);
    }, 1000);

    // initial position
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      if (pos?.coords) {
        const { latitude, longitude } = pos.coords;
        try { coordinate.setValue({ latitude, longitude }); } catch {}
        lastPointRef.current = { latitude, longitude, timestamp: Date.now() };
        routeBufferRef.current.push(lastPointRef.current);
        mapRef.current?.animateCamera({ center: { latitude, longitude }, zoom: 17 });
        setLocation({ latitude, longitude });
      }
    } catch (err) {
      // ignore
    }

    // start watcher — RAW mode: distanceInterval 0 => get updates by timeInterval
    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 200,
          distanceInterval: 0,
          mayShowUserSettingsDialog: true,
        },
        (loc) => {
          if (!loc?.coords) return;
          const { latitude, longitude, accuracy } = loc.coords;
          // accept even noisy points, but allow a very high-accuracy block (optional)
          if (typeof accuracy === "number" && accuracy > MIN_ACCURACY) {
            // still accept points, but user can change MIN_ACCURACY if desired
          }
          handleLocationUpdate({ latitude, longitude });
        }
      );
      watcherRef.current = sub;
    } catch (e) {
      console.warn("watchPositionAsync failed, fallback to polling", e);
      const pollId = setInterval(async () => {
        try {
          const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          if (!p?.coords) return;
          const { latitude, longitude } = p.coords;
          handleLocationUpdate({ latitude, longitude });
        } catch (err) { /* ignore */ }
      }, 1000);
      watcherRef.current = { pollingInterval: pollId };
    }
  }

  function stopRunCore() {
    setRunning(false);

    // stop watcher
    if (watcherRef.current) {
      if (typeof watcherRef.current.remove === "function") {
        try { watcherRef.current.remove(); } catch (e) {}
      } else if (watcherRef.current.pollingInterval) {
        clearInterval(watcherRef.current.pollingInterval);
      }
      watcherRef.current = null;
    }

    // stop timer
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    // final flush: take buffer snapshot, don't rely on state update timing
    const finalBuffer = [...routeBufferRef.current];
    routeBufferRef.current = [];

    const finalRoute = [...routeState, ...finalBuffer];

    if (finalRoute.length > 1) {
      const entry = {
        id: String(Date.now()),
        date: Date.now(),
        mode,
        distance: distanceRef.current,
        time: timeSec,
        path: finalRoute,
      };
      setRuns((r) => [...r, entry]);
      // you may want to persist to AsyncStorage here
    }

    // cleanup
    distanceRef.current = 0;
    lastPointRef.current = null;
    setRouteState([]);
    setReplayPathState([]);
    setDistanceState(0);
    setTimeSec(0);
    setMode(null);
  }

  /* =============== countdown wrapper =============== */
  function startWithCountdown(selectedMode = "free") {
    if (counting) return;
    setCounting(true);
    setCountdown(3);
    let n = 3;
    const tick = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n <= 0) clearInterval(tick);
    }, 1000);
    setTimeout(() => {
      setCounting(false);
      setCountdown(0);
      startRunCore(selectedMode);
    }, 3000);
  }

  function stopRun() {
    stopRunCore();
  }

  /* =============== replay =============== */
  function startReplay(runEntry) {
    if (!runEntry || !Array.isArray(runEntry.path) || runEntry.path.length === 0) return;
    // stop watcher if any
    if (watcherRef.current && typeof watcherRef.current.remove === "function") {
      try { watcherRef.current.remove(); } catch {}
      watcherRef.current = null;
    }
    if (watcherRef.current && watcherRef.current.pollingInterval) {
      clearInterval(watcherRef.current.pollingInterval);
      watcherRef.current = null;
    }

    setReplaying(true);
    setRunning(false);
    setRouteState([]);
    setReplayPathState([]);
    setMode(null);

    let idx = 0;
    if (replayIntervalRef.current) { clearInterval(replayIntervalRef.current); replayIntervalRef.current = null; }
    replayIntervalRef.current = setInterval(() => {
      if (!runEntry || idx >= runEntry.path.length) {
        clearInterval(replayIntervalRef.current);
        replayIntervalRef.current = null;
        setReplaying(false);
        return;
      }
      const p = runEntry.path[idx++];
      setReplayPathState((prev) => [...prev, p]);
      try {
        coordinate.timing({ latitude: p.latitude, longitude: p.longitude, duration: 200, useNativeDriver: false }).start();
      } catch {
        try { coordinate.setValue({ latitude: p.latitude, longitude: p.longitude }); } catch {}
      }
    }, 250);
  }

  function stopReplay() {
    if (replayIntervalRef.current) { clearInterval(replayIntervalRef.current); replayIntervalRef.current = null; }
    setReplaying(false);
    setReplayPathState([]);
  }

  /* =============== GPX/JSON helpers =============== */
  function pointsToGPX(coords, meta = {}) {
    const header = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Wayper" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${meta.name || "Wayper Run"}</name><time>${meta.time || new Date().toISOString()}</time></metadata>
  <trk><name>${meta.name || "Wayper Run"}</name><trkseg>`;
    const pts = coords.map((p) => `<trkpt lat="${p.latitude}" lon="${p.longitude}"><time>${p.timestamp || ""}</time></trkpt>`).join("\n");
    const footer = `</trkseg></trk></gpx>`;
    return `${header}\n${pts}\n${footer}`;
  }

  async function shareRunAsGPX(run) {
    if (!run || !Array.isArray(run.path)) return;
    const gpx = pointsToGPX(run.path, { name: `Wayper Run ${run.date}`, time: new Date(run.date).toISOString() });
    const path = FileSystem.cacheDirectory + `wayper_run_${run.id || Date.now()}.gpx`;
    try {
      await FileSystem.writeAsStringAsync(path, gpx, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      } else {
        Alert.alert("Compartilhar", "Compartilhamento não disponível neste dispositivo.");
      }
    } catch (e) {
      console.warn("share GPX error", e);
      Alert.alert("Erro", "Falha ao gerar/compartilhar GPX.");
    }
  }

  async function shareRunAsJSON(run) {
    if (!run) return;
    const path = FileSystem.cacheDirectory + `wayper_run_${run.id || Date.now()}.json`;
    try {
      await FileSystem.writeAsStringAsync(path, JSON.stringify(run), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      } else {
        Alert.alert("Compartilhar", "Compartilhamento não disponível neste dispositivo.");
      }
    } catch (e) {
      console.warn("share JSON error", e);
      Alert.alert("Erro", "Falha ao gerar/compartilhar JSON.");
    }
  }

  /* =============== UI =============== */
  if (loading || !location) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#0984e3" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.001,
          longitudeDelta: 0.001,
        }}
      >
        {showZones && polygons.map((z, i) => (
          <Polygon key={i} coordinates={z.coords} strokeColor="#00b894" fillColor="rgba(0,184,148,0.25)" strokeWidth={8} />
        ))}

        {/* trail: routeState (flushed) */}
        {routeState.length > 0 && <Polyline coordinates={routeState} strokeWidth={8} strokeColor="#0984e3" lineJoin="round" lineCap="round" /> }
        {replayPathState.length > 0 && <Polyline coordinates={replayPathState} strokeWidth={8} strokeColor="#fdcb6e" lineJoin="round" lineCap="round" /> }

        <Marker.Animated coordinate={coordinate}>
          <View style={styles.myLocationDot} />
        </Marker.Animated>
      </MapView>

      {/* run panel */}
      {(running || replaying) && (
        <View style={styles.runPanel}>
          <Text style={styles.runTitle}>
            {running ? (mode === "zones" ? "Capturando Zonas" : "Corrida Livre") : "Reproduzindo"}
          </Text>
          <View style={styles.runRow}>
            <Text style={styles.runLabel}>Tempo</Text>
            <Text style={styles.runValue}>{formatTime(timeSec)}</Text>
          </View>
          <View style={styles.runRow}>
            <Text style={styles.runLabel}>Distância</Text>
            <Text style={styles.runValue}>{(distanceState / 1000).toFixed(2)} km</Text>
          </View>
        </View>
      )}

      {/* main menu (centered start) */}
      {!running && !replaying && (
        <View style={styles.menuPanel}>
          <TouchableOpacity style={styles.startMainBtn} onPress={() => setSelectModeVisible(true)}>
            <Text style={styles.startMainBtnTxt}>Iniciar Corrida</Text>
          </TouchableOpacity>

          <View style={styles.menuRow}>
            <TouchableOpacity style={styles.menuItem} onPress={() => setShowZones(!showZones)}>
              <Text style={styles.menuItemTitle}>Zonas</Text>
              <Text style={styles.menuItemValue}>{showZones ? "Exibindo" : "Ocultas"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={() => setShowReplayList(true)}>
              <Text style={styles.menuItemTitle}>Corridas</Text>
              <Text style={styles.menuItemValue}>{runs.length}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.metaText}>Zonas: {polygons.length} • Corridas: {runs.length}</Text>
        </View>
      )}

      {/* bottom finalize button */}
      {running && (
        <View style={styles.bottomButtons}>
          <TouchableOpacity style={[styles.mainButton, { backgroundColor: "#d63031" }]} onPress={stopRun}>
            <Text style={styles.mainButtonText}>Finalizar</Text>
          </TouchableOpacity>
        </View>
      )}

      {replaying && (
        <View style={styles.bottomButtons}>
          <TouchableOpacity style={[styles.mainButton, { backgroundColor: "#d63031" }]} onPress={stopReplay}>
            <Text style={styles.mainButtonText}>Parar Reprodução</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* replay modal */}
      <Modal visible={showReplayList} animationType="slide">
        <View style={styles.modal}>
          <Text style={styles.title}>Corridas Salvas</Text>
          <FlatList
            data={runs}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <View style={styles.replayItem}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700" }}>{new Date(item.date).toLocaleString()}</Text>
                  <Text style={{ color: "#666" }}>{(item.distance / 1000).toFixed(2)} km • {formatTime(item.time)}</Text>
                </View>

                <View style={{ justifyContent: "space-between" }}>
                  <TouchableOpacity style={styles.smallBtn} onPress={() => { setShowReplayList(false); startReplay(item); }}>
                    <Text>Reproduzir</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallBtn} onPress={() => shareRunAsGPX(item)}><Text>GPX</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.smallBtn} onPress={() => shareRunAsJSON(item)}><Text>JSON</Text></TouchableOpacity>
                </View>
              </View>
            )}
          />
          <TouchableOpacity style={[styles.mainButton, { marginTop: 16 }]} onPress={() => setShowReplayList(false)}>
            <Text style={styles.mainButtonText}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* select mode modal */}
      <Modal visible={selectModeVisible} transparent animationType="fade">
        <View style={styles.modeOverlay}>
          <View style={styles.modeBox}>
            <Text style={styles.modeTitle}>Selecione o tipo de corrida</Text>
            <TouchableOpacity style={styles.modeBtn} onPress={() => { setSelectModeVisible(false); startWithCountdown("free"); }}>
              <Text style={styles.modeBtnText}>Corrida Livre</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modeBtn} onPress={() => { setSelectModeVisible(false); startWithCountdown("zones"); }}>
              <Text style={styles.modeBtnText}>Capturar Zonas</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectModeVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* countdown overlay */}
      {counting && (
        <View style={styles.countdownOverlay}>
          <View style={styles.countdownBox}>
            <Text style={styles.countdownNumber}>{countdown > 0 ? countdown : "VAI"}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

/* =============== styles (WAYPER ULTRA UI) =============== */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000"
  },

  map: {
    flex: 1
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center"
  },

  /* Pontinho da localização */
  myLocationDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#00ffe1",
    borderWidth: 3,
    borderColor: "#000",
    shadowColor: "#00ffe1",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8
  },

  /* Painel flutuante com blur e neon */
  runPanel: {
    position: "absolute",
    top: 22,
    left: 16,
    right: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(15, 15, 15, 0.55)",
    borderWidth: 1,
    borderColor: "rgba(0,255,200,0.15)"
  },

  runTitle: {
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    color: "#eaffff",
    marginBottom: 8,
    letterSpacing: 0.8
  },

  runRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6
  },

  runLabel: {
    color: "#c4f6f6",
    fontWeight: "600"
  },

  runValue: {
    color: "#fff",
    fontWeight: "800"
  },

  /* Painel inferior principal */
  menuPanel: {
    position: "absolute",
    bottom: 26,
    left: 16,
    right: 16,
    padding: 18,
    borderRadius: 18,
    backgroundColor: "rgba(15,15,15,0.65)",
    borderColor: "rgba(0,255,200,0.15)",
    borderWidth: 1
  },

  startMainBtn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 18,
    backgroundColor: "#00e676",
    shadowColor: "#00e676",
    shadowOpacity: 0.4,
    shadowRadius: 10
  },

  startMainBtnTxt: {
    color: "#000",
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: 0.5
  },

  menuRow: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    marginBottom: 10
  },

  menuItem: {
    flex: 1,
    marginHorizontal: 6,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(0,255,200,0.1)",
    borderWidth: 1,
    alignItems: "center"
  },

  menuItemTitle: {
    fontWeight: "800",
    fontSize: 14,
    color: "#eaffff"
  },

  menuItemValue: {
    marginTop: 4,
    color: "#9dd",
    fontSize: 12
  },

  metaText: {
    marginTop: 10,
    color: "#9dd",
    fontSize: 12,
    textAlign: "center",
    opacity: 0.8
  },

  /* Botão inferior */
  bottomButtons: {
    position: "absolute",
    bottom: 22,
    width: "100%",
    alignItems: "center"
  },

  mainButton: {
    width: "75%",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    backgroundColor: "#ff1744",
    shadowColor: "#ff1744",
    shadowOpacity: 0.5,
    shadowRadius: 12
  },

  mainButtonText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 0.6
  },

  /* Modal */
  modal: {
    flex: 1,
    padding: 20,
    backgroundColor: "#000"
  },

  title: {
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 20,
    color: "#eaffff"
  },

  replayItem: {
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    borderColor: "rgba(0,255,200,0.10)",
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12
  },

  smallBtn: {
    padding: 8,
    backgroundColor: "rgba(0,255,200,0.15)",
    borderRadius: 8,
    marginBottom: 6,
    alignItems: "center"
  },

  /* countdown */
  countdownOverlay: {
    position: "absolute",
    left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center"
  },

  countdownBox: {
    width: 240,
    height: 240,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,255,200,0.05)",
    borderColor: "rgba(0,255,200,0.25)",
    borderWidth: 1
  },

  countdownNumber: {
    fontSize: 110,
    fontWeight: "900",
    color: "#00ffe1"
  },

  /* selecionar modo */
  modeOverlay: {
    position: "absolute",
    left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20
  },

  modeBox: {
    width: "100%",
    backgroundColor: "rgba(15,15,15,0.9)",
    padding: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,200,0.2)"
  },

  modeTitle: {
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 22,
    color: "#eaffff"
  },

  modeBtn: {
    backgroundColor: "#00e676",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12
  },

  modeBtnText: {
    color: "#000",
    fontWeight: "900",
    fontSize: 17
  },

  cancelBtn: {
    backgroundColor: "#ff1744",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 6
  },

  cancelBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 15
  },
});
