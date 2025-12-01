// src/screens/MapScreen.js
// MAP SCREEN - WAYPER (re-escrito, com logs de saída ao final de cada função)
// Assumptions: expo-managed or bare with expo-location + react-native-maps available.

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
  Platform,
} from "react-native";
import MapView, { Marker, Polyline, Polygon, AnimatedRegion } from "react-native-maps";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";

/* ---------------------- Helpers ---------------------- */

const debug = (...args) => {
  try {
    console.log("[MAPDEBUG]", ...args);
  } catch (e) {}
};

/* Haversine distance (meters) */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const res = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  debug("haversineDistance exit", { lat1, lon1, lat2, lon2, res });
  return res;
}

/* formatTime (seconds) -> mm:ss or hh:mm:ss */
function formatTime(sec) {
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec % 3600) / 60);
  const h = Math.floor(sec / 3600);
  const out = h > 0
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  debug("formatTime exit", { sec, out });
  return out;
}

/* ---------------------- Component ---------------------- */

export default function MapScreen() {
  /* UI + flow */
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [running, setRunning] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [showReplayList, setShowReplayList] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [selectModeVisible, setSelectModeVisible] = useState(false);
  const [counting, setCounting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  /* metrics & states */
  const [routeState, setRouteState] = useState([]); // rendered trail
  const [replayPathState, setReplayPathState] = useState([]);
  const [distanceState, setDistanceState] = useState(0);
  const [timeSec, setTimeSec] = useState(0);
  const [runs, setRuns] = useState([]);
  const [polygons, setPolygons] = useState([]);
  const [mode, setMode] = useState(null); // 'free' | 'zones'

  /* refs (performance) */
  const mapRef = useRef(null);
  const coordinate = useRef(new AnimatedRegion({ latitude: 0, longitude: 0, latitudeDelta: 0.001, longitudeDelta: 0.001 })).current;
  const watcherRef = useRef(null);
  const timerRef = useRef(null);
  const replayIntervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  /* buffer + last point + distance */
  const lastPointRef = useRef(null);
  const routeBufferRef = useRef([]); // will flush to routeState periodically
  const distanceRef = useRef(0);
  const runningRef = useRef(false);

  /* TUNABLES */
  const MIN_ACCURACY = 75; // meters tolerated
  const FLUSH_INTERVAL_MS = 300; // flush buffer to state

  /* ---------------------- INIT & CLEANUP ---------------------- */
  useEffect(() => {
    let mounted = true;
    let appStateSub = null;
    let flushTimer = null;

    (async () => {
      try {
        // request permissions
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permissão negada", "Ative o GPS e permita localização em primeiro plano.");
          if (mounted) setLoading(false);
          debug("init exit (permission denied)");
          return;
        }

        // initial position
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }).catch(e => {
          debug("getCurrentPositionAsync failed (init)", e);
          return null;
        });

        const initial = pos?.coords ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : { latitude: 0, longitude: 0 };
        if (mounted) {
          setLocation(initial);
          try { coordinate.setValue(initial); } catch {}
        }

        // app state listener
        appStateSub = AppState.addEventListener("change", (next) => {
          appStateRef.current = next;
          debug("appState change", next);
        });

        // start periodic flush to UI
        flushTimer = setInterval(() => {
          flushRouteBufferToState();
        }, FLUSH_INTERVAL_MS);
        debug("init finished priming");
      } catch (err) {
        console.warn("INIT ERROR", err);
        debug("init catch exit", err);
      } finally {
        if (mounted) setLoading(false);
        debug("useEffect(init) exit");
      }
    })();

    return () => {
      mounted = false;

      // cleanup timer
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }

      // stop watcher
      stopWatcherAndPolling();

      // stop running timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      // remove app state listener
      if (appStateSub?.remove) appStateSub.remove();

      // make sure runningRef cleared
      runningRef.current = false;

      debug("useEffect cleanup exit");
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  debug("component render", { loading, location, running });

  /* ---------------------- UTIL: watcher cleanup ---------------------- */

  function stopWatcherAndPolling() {
    try {
      if (watcherRef.current) {
        if (typeof watcherRef.current.remove === "function") {
          try { watcherRef.current.remove(); } catch (e) { debug("watcher remove error", e); }
        } else if (watcherRef.current.pollingInterval) {
          try { clearInterval(watcherRef.current.pollingInterval); } catch (e) { debug("clear polling error", e); }
        }
        watcherRef.current = null;
      }
    } catch (e) {
      debug("stopWatcherAndPolling caught", e);
    }
    debug("stopWatcherAndPolling exit");
  }

  /* ---------------------- BUFFER FLUSH ---------------------- */

  function flushRouteBufferToState() {
    try {
      const buf = routeBufferRef.current;
      if (!buf || buf.length === 0) {
        debug("flushRouteBufferToState no-op");
        return;
      }
      // keep only lat/lon for UI
      const mapped = buf.map(p => ({ latitude: Number(p.latitude), longitude: Number(p.longitude) })).filter(p => isFinite(p.latitude) && isFinite(p.longitude));
      if (mapped.length === 0) {
        routeBufferRef.current = [];
        debug("flushRouteBufferToState nothing valid");
        return;
      }
      setRouteState(prev => {
        const next = prev.concat(mapped);
        return next;
      });
      routeBufferRef.current = [];
      setDistanceState(distanceRef.current);
      debug("flushRouteBufferToState exit", { added: mapped.length, distanceRef: distanceRef.current });
    } catch (e) {
      debug("flushRouteBufferToState catch", e);
    }
  }

  /* ---------------------- LOCATION HANDLER ---------------------- */

  function handleLocationUpdate(locObj = {}) {
    debug("HLU STEP0: begin", locObj);

    try {
      // ----------------------------------
      // 1) VALIDAR COORDENADAS
      // ----------------------------------
      const lat = Number(locObj.latitude);
      const lon = Number(locObj.longitude);
      const accuracy = locObj.accuracy != null ? Number(locObj.accuracy) : 9999;

      if (!isFinite(lat) || !isFinite(lon)) {
        debug("HLU ERROR: invalid coords", locObj);
        return;
      }

      // ----------------------------------
      // 2) ATUALIZAR VISUAL DO DOT SEMPRE
      // ----------------------------------
      setLocation({ latitude: lat, longitude: lon });

      try {
        coordinate.timing({
          latitude: lat,
          longitude: lon,
          duration: 280,
          useNativeDriver: false,
        }).start();
      } catch {
        try {
          coordinate.setValue({ latitude: lat, longitude: lon });
        } catch {}
      }

      // ----------------------------------
      // 3) SE NÃO TÁ CORRENDO -> SAI
      // ----------------------------------
      if (!runningRef.current) {
        debug("HLU EXIT (NOT RUNNING REF)", { lat, lon, accuracy });
        return;
      }

      // ----------------------------------
      // 4) FILTRO DE ACURÁCIA
      // ----------------------------------
      if (!isFinite(accuracy) || accuracy > MIN_ACCURACY) {
        debug("HLU EXIT (ACCURACY DROP)", { lat, lon, accuracy });
        return;
      }

      // ----------------------------------
      // 5) CRIAR PONTO PADRÃO
      // ----------------------------------
      const point = {
        latitude: lat,
        longitude: lon,
        accuracy,
        timestamp: Date.now(),
      };

      // ----------------------------------
      // 6) PRIMEIRO PONTO
      // ----------------------------------
      if (!lastPointRef.current) {
        lastPointRef.current = point;
        routeBufferRef.current.push(point);
        debug("HLU EXIT (FIRST POINT)", point);
        return;
      }

      // ----------------------------------
      // 7) DISTÂNCIA ENTRE ÚLTIMO E ATUAL
      // ----------------------------------
      const last = lastPointRef.current;
      const d = haversineDistance(last.latitude, last.longitude, point.latitude, point.longitude);

      // ----------------------------------
      // 8) FILTRO DE SPIKE
      // ----------------------------------
      if (!isFinite(d) || d <= 0 || d > 1000) {
        debug("HLU EXIT (SPIKE IGNORED)", { last, point, d });
        return;
      }

      // ----------------------------------
      // 9) SALVAR DISTÂNCIA E PONTO
      // ----------------------------------
      distanceRef.current += d;
      lastPointRef.current = point;
      routeBufferRef.current.push(point);
      setDistanceState(distanceRef.current);

      debug("HLU EXIT (OK)", {
        added: d,
        total: distanceRef.current,
        point,
      });

    } catch (e) {
      debug("HLU CATCH", e);
    }
  }

  /* ---------------------- START / STOP RUN ---------------------- */
  function startWithCountdown(selectedMode = "free") {
    try {
      if (counting || running) {
        debug("startWithCountdown early-return", { counting, running });
        return;
      }
      setMode(selectedMode);
      setCounting(true);
      setCountdown(3);

      const interval = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(interval);
            setCounting(false);
            startRun();
            return 0;
          }
          return c - 1;
        });
      }, 1000);
      debug("startWithCountdown exit (started countdown)", { selectedMode });
    } catch (e) {
      debug("startWithCountdown catch", e);
    }
  }

 /* ---------------------- START RUN ---------------------- */
  async function startRun() {
  debug("startRun STEP0: begin");

  try {
    if (running) {
      debug("startRun EARLY_EXIT: already running");
      return;
    }

    debug("startRun STEP1: resetting states");

    // reset everything
    setRunning(true);
    // ****** FIX: marca a ref como true para o handler aceitar pontos ******
    runningRef.current = true;

    setReplaying(false);
    setRouteState([]);
    routeBufferRef.current = [];
    distanceRef.current = 0;
    setDistanceState(0);
    lastPointRef.current = null;
    setTimeSec(0);

    // timer reset
    if (timerRef.current) {
      clearInterval(timerRef.current);
      debug("startRun STEP1.1: cleared previous timer");
    }

    timerRef.current = setInterval(() => {
      setTimeSec(t => t + 1);
    }, 1000);

    debug("startRun STEP2: requesting initial position");

    // GET CURRENT POSITION (FIRST CRITICAL POINT)
    let pos = null;
    try {
      pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      debug("startRun STEP2.1: got initial position", pos?.coords);
    } catch (e) {
      debug("startRun ERROR: getCurrentPositionAsync failed", e);
    }

    // avoid exploding AnimatedRegion
    debug("startRun STEP3: syncing coordinate safely");

    if (pos?.coords) {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      try {
        coordinate.stopAnimation();
      } catch (e) {
        debug("startRun coord.stopAnimation error", e);
      }

      try {
        coordinate.setValue({ latitude: lat, longitude: lon });
        debug("startRun STEP3.1: coordinate.setValue OK");
      } catch (e) {
        debug("startRun STEP3.1 ERROR: coordinate.setValue failed", e);
      }

      try {
        mapRef.current?.animateCamera({
          center: { latitude: lat, longitude: lon },
          zoom: 17,
        });
        debug("startRun STEP3.2: animateCamera OK");
      } catch (e) {
        debug("startRun STEP3.2 ERROR: animateCamera failed", e);
      }

      // call handler manually for first point
      try {
        handleLocationUpdate({
          latitude: lat,
          longitude: lon,
          accuracy: pos.coords.accuracy,
        });
        debug("startRun STEP3.3: handleLocationUpdate OK");
      } catch (e) {
        debug("startRun STEP3.3 ERROR: handleLocationUpdate failed", e);
      }
    } else {
      debug("startRun STEP3 SKIPPED: no pos.coords");
    }

    // START WATCHER (SECOND CRITICAL POINT)
    debug("startRun STEP4: starting watcher");

    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
          mayShowUserSettingsDialog: true,
        },
        (loc) => {
          debug("watch CB fired", loc?.coords);
          if (!loc?.coords) {
            debug("watch CB EMPTY", loc);
            return;
          }

          handleLocationUpdate({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
          });
        }
      );

      watcherRef.current = sub;
      debug("startRun STEP4.1: watcher started", {
        hasRemove: typeof sub.remove === "function",
      });

    } catch (e) {
      // WATCHER FAILED → FALLBACK
      debug("startRun STEP4 ERROR: watchPositionAsync failed", e);

      const poll = setInterval(async () => {
        try {
          const p = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });

          debug("polling LOCATION", p?.coords);

          if (p?.coords) {
            handleLocationUpdate({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy,
            });
          }
        } catch (err) {
          debug("startRun POLLING_ERROR", err);
        }
      }, 1000);

      watcherRef.current = { pollingInterval: poll };
      debug("startRun STEP4.2: fallback polling started");
    }

    debug("startRun STEP5: exit normally");

  } catch (e) {
    debug("startRun FINAL_CATCH", e);
  }
}

 /* ---------------------- STOP RUN ---------------------- */
  function stopRun() {
    try {
      if (!running) {
        debug("stopRun early exit not running");
        return;
      }

      // ****** FIX: marca a ref como false pra handler não aceitar pontos ******
      runningRef.current = false;
      setRunning(false);

      stopWatcherAndPolling();

      // stop timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      // save run if sensible
      const routeCopy = routeState || [];
      if (routeCopy.length > 1 && distanceRef.current > 1) {
        const entry = {
          id: String(Date.now()),
          date: Date.now(),
          distance: distanceRef.current,
          time: timeSec,
          path: routeCopy,
        };
        setRuns(r => [entry, ...r]);
        debug("stopRun saved run", { id: entry.id, distance: entry.distance, time: entry.time });
      }

      // reset visual
      distanceRef.current = 0;
      setDistanceState(0);
      lastPointRef.current = null;
      setRouteState([]);
      setTimeSec(0);

      debug("stopRun exit");
    } catch (e) {
      debug("stopRun catch", e);
    }
  }

  /* ============================================================
   REPLAY DA CORRIDA — VERSÃO AJUSTADA E SEM FRESCURA
   ============================================================ */

  function startReplay(runEntry) {
    try {
      // validação decente
      if (
        !runEntry ||
        !Array.isArray(runEntry.path) ||
        runEntry.path.length === 0
      ) {
        debug("startReplay invalid input", { valid: !!runEntry });
        return;
      }

      // desliga qualquer tracking ativo
      stopWatcherAndPolling();

      // garante modo replay
      setReplaying(true);
      runningRef.current = false;
      setRunning(false);

      // limpa o estado do mapa ANTES do replay
      setRouteState([]);
      setReplayPathState([]);
      setDrawnPath && setDrawnPath([]);
      setMode(null);

      // limpa interval anterior, se existir
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
        replayIntervalRef.current = null;
      }

      let idx = 0;

      replayIntervalRef.current = setInterval(() => {
        // fim do replay
        if (!runEntry || idx >= runEntry.path.length) {
          clearInterval(replayIntervalRef.current);
          replayIntervalRef.current = null;

          // garante o fim do replay
          setReplaying(false);

          // LIMPA TUDO ao finalizar
          setReplayPathState([]);
          setRouteState([]);
          setDrawnPath && setDrawnPath([]);

          debug("startReplay finished");
          return;
        }

        const p = runEntry.path[idx++];
        setReplayPathState(prev => [...prev, p]);

        // animação do ponto
        try {
          coordinate
            .timing({
              latitude: p.latitude,
              longitude: p.longitude,
              duration: 200,
              useNativeDriver: false,
            })
            .start();
        } catch {
          try {
            coordinate.setValue({
              latitude: p.latitude,
              longitude: p.longitude,
            });
          } catch {}
        }
      }, 250);

      debug("startReplay exit started", { total: runEntry.path.length });

    } catch (e) {
      debug("startReplay catch", e);
    }
  }

  /* ============================================================
    FINALIZAR REPLAY — VERSÃO AJUSTADA
    ============================================================ */

  function stopReplay() {
    try {
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
        replayIntervalRef.current = null;
      }

      setReplaying(false);

      // limpa qualquer lixo do mapa
      setReplayPathState([]);
      setRouteState([]);
      setDrawnPath && setDrawnPath([]);

      debug("stopReplay exit");
    } catch (e) {
      debug("stopReplay catch", e);
    }
  }


  /* ---------------------- GPX / JSON helpers ---------------------- */

  function pointsToGPX(coords = [], meta = {}) {
    try {
      const header = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Wayper" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${meta.name || "Wayper Run"}</name><time>${meta.time || new Date().toISOString()}</time></metadata>
  <trk><name>${meta.name || "Wayper Run"}</name><trkseg>`;
      const pts = coords.map((p) => `<trkpt lat="${p.latitude}" lon="${p.longitude}"><time>${p.timestamp || ""}</time></trkpt>`).join("\n");
      const footer = `</trkseg></trk></gpx>`;
      const out = `${header}\n${pts}\n${footer}`;
      debug("pointsToGPX exit", { count: coords.length });
      return out;
    } catch (e) {
      debug("pointsToGPX catch", e);
      return "";
    }
  }

    async function shareRunAsGPX(run) {
    try {
      if (!run || !Array.isArray(run.path)) {
        debug("shareRunAsGPX invalid run");
        return;
      }

      const gpx = pointsToGPX(run.path, { name: `Wayper Run ${run.date}`, time: new Date(run.date).toISOString() });
      const path = FileSystem.cacheDirectory + `wayper_run_${run.id || Date.now()}.gpx`;

      await FileSystem.writeAsStringAsync(path, gpx, {
        encoding: FileSystem.Encoding.UTF8
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
        debug("shareRunAsGPX exit shared", { path });
      } else {
        Alert.alert("Compartilhar", "Compartilhamento não disponível neste dispositivo.");
        debug("shareRunAsGPX exit sharing not available");
      }
    } catch (e) {
      console.warn("share GPX error", e);
      debug("shareRunAsGPX catch", e);
      Alert.alert("Erro", "Falha ao gerar/compartilhar GPX.");
    }
  }


    async function shareRunAsJSON(run) {
    try {
      if (!run) {
        debug("shareRunAsJSON invalid run");
        return;
      }

      const path = FileSystem.cacheDirectory + `wayper_run_${run.id || Date.now()}.json`;

      await FileSystem.writeAsStringAsync(path, JSON.stringify(run), {
        encoding: FileSystem.Encoding.UTF8
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
        debug("shareRunAsJSON exit shared", { path });
      } else {
        Alert.alert("Compartilhar", "Compartilhamento não disponível neste dispositivo.");
        debug("shareRunAsJSON exit sharing not available");
      }
    } catch (e) {
      console.warn("share JSON error", e);
      debug("shareRunAsJSON catch", e);
      Alert.alert("Erro", "Falha ao gerar/compartilhar JSON.");
    }
  }


  /* ---------------------- RENDER ---------------------- */

  if (loading || !location) {
    debug("render early loading");
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

        {routeState.length > 0 && <Polyline coordinates={routeState} strokeWidth={8} strokeColor="#0984e3" lineJoin="round" lineCap="round" /> }
        {replayPathState.length > 0 && <Polyline coordinates={replayPathState} strokeWidth={8} strokeColor="#fdcb6e" lineJoin="round" lineCap="round" /> }

        <Marker.Animated coordinate={coordinate}>
          <View style={styles.myLocationDot} />
        </Marker.Animated>
      </MapView>

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

/* =============== styles (kept same visuals) =============== */
/* You can reuse your original styles — keeping here for completeness */
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
