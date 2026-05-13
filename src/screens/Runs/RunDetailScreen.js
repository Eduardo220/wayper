/**
 * src/screens/Runs/RunDetailScreen.js */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Alert,
  Animated,
} from "react-native";
import WayperMapLibre from "../../components/Map/WayperMapLibre";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
let captureRef;
try {
  // optional dependency - guard if not installed
  // eslint-disable-next-line global-require
  captureRef = require("react-native-view-shot").captureRef;
} catch {
  captureRef = null;
}

import sync from "../../utils/sync";

const WAYPER_GREEN = "#00e676";
const MIN_BAR_HEIGHT = 20;
const CHART_BASE_HEIGHT = 120;

/* ------------------------------- Small debug util ------------------------------- */
const debug = (...args) => {
  // set to true to enable console logs for debugging
  const ENABLE = false;
  if (ENABLE) console.log("[RunDetail]", ...args);
};

/* ------------------------------- Numeric helpers ------------------------------- */
const safeNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function formatDuration(sec) {
  sec = safeNum(sec, 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(secPerKm) {
  secPerKm = safeNum(secPerKm, 0);
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/* ------------------------------- Geodesy (Haversine) ------------------------------- */
function haversine(p1, p2) {
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(safeNum(p1.latitude));
  const φ2 = toRad(safeNum(p2.latitude));
  const Δφ = toRad(safeNum(p2.latitude) - safeNum(p1.latitude));
  const Δλ = toRad(safeNum(p2.longitude) - safeNum(p1.longitude));
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* ------------------------------- Timeline & Splits (robust) ------------------------------- */
/**
 * buildTimeline(path, totalDuration)
 * - returns array of points with cumulativeMeters & cumulativeTime
 * - safe to call with missing timestamps (will distribute time proportionally)
 */
function buildTimeline(path = [], totalDuration = 0) {
  if (!Array.isArray(path) || path.length === 0) return [];

  const pts = path
    .map((p) => {
      if (!p) return null;
      const lat = safeNum(p.latitude ?? p.lat);
      const lon = safeNum(p.longitude ?? p.lon ?? p.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { latitude: lat, longitude: lon, timestamp: p.timestamp ?? null };
    })
    .filter(Boolean);

  if (pts.length === 0) return [];

  if (pts.length === 1) {
    return [{ ...pts[0], cumulativeMeters: 0, cumulativeTime: 0 }];
  }

  const segments = new Array(pts.length - 1);
  let totalMeters = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1], pts[i]);
    segments[i - 1] = d;
    totalMeters += d;
  }

  const hasTimestamps = pts.every((p) => Number.isFinite(Number(p.timestamp)));
  const out = [];
  let cumMeters = 0;
  let cumTime = 0;

  if (hasTimestamps) {
    out.push({ ...pts[0], cumulativeMeters: 0, cumulativeTime: 0 });
    for (let i = 1; i < pts.length; i++) {
      const segMeters = segments[i - 1] || 0;
      const tPrev = Number(pts[i - 1].timestamp);
      const tCur = Number(pts[i].timestamp);
      const dtSec = Math.max(0, (tCur - tPrev) / 1000);
      cumMeters += segMeters;
      cumTime += dtSec;
      out.push({ ...pts[i], cumulativeMeters: cumMeters, cumulativeTime: cumTime });
    }
  } else {
    const dur = Math.max(1, safeNum(totalDuration, pts.length - 1));
    out.push({ ...pts[0], cumulativeMeters: 0, cumulativeTime: 0 });
    for (let i = 1; i < pts.length; i++) {
      const segMeters = segments[i - 1] || 0;
      const segTime = totalMeters > 0 ? (segMeters / totalMeters) * dur : dur / (pts.length - 1);
      cumMeters += segMeters;
      cumTime += segTime;
      out.push({ ...pts[i], cumulativeMeters: cumMeters, cumulativeTime: cumTime });
    }
  }
  return out;
}

/**
 * computeSplits(path, totalDuration)
 * - returns { splits[], pacePerKm[], avgSpeedKmh, maxSpeedKmh, totalMeters, totalTime }
 */
function computeSplits(path = [], totalDuration = 0) {
  const timeline = buildTimeline(path, totalDuration);
  if (!timeline || timeline.length < 2) {
    return { splits: [], pacePerKm: [], avgSpeedKmh: 0, maxSpeedKmh: 0, totalMeters: 0, totalTime: 0 };
  }

  const totalMeters = safeNum(timeline[timeline.length - 1].cumulativeMeters, 0);
  const totalTime = safeNum(timeline[timeline.length - 1].cumulativeTime, 0);

  let maxSpeed = 0;
  for (let i = 1; i < timeline.length; i++) {
    const d = Math.max(0, timeline[i].cumulativeMeters - timeline[i - 1].cumulativeMeters);
    const dt = Math.max(0.001, timeline[i].cumulativeTime - timeline[i - 1].cumulativeTime);
    const spKmh = (d / dt) * 3.6;
    if (spKmh > maxSpeed) maxSpeed = spKmh;
  }
  const avgSpeedKmh = totalTime > 0 ? (totalMeters / totalTime) * 3.6 : 0;

  const splits = [];
  const pacePerKm = [];
  let kmIndex = 1;
  let lastKmTime = 0;
  let lastKmMeters = 0;
  let idx = 0;

  while (kmIndex * 1000 <= totalMeters + 1e-6) {
    while (idx < timeline.length && timeline[idx].cumulativeMeters < kmIndex * 1000) idx++;
    if (idx >= timeline.length) break;

    const cur = timeline[idx];
    const prev = timeline[idx - 1] || timeline[0];
    const segMeters = (cur.cumulativeMeters || 0) - (prev.cumulativeMeters || 0);
    const segTime = (cur.cumulativeTime || 0) - (prev.cumulativeTime || 0);
    const metersBefore = kmIndex * 1000 - (prev.cumulativeMeters || 0);
    const ratio = segMeters > 0 ? metersBefore / segMeters : 0;
    const timeAtKm = (prev.cumulativeTime || 0) + segTime * ratio;

    const kmTime = timeAtKm - lastKmTime;
    splits.push({ km: kmIndex, time: Math.round(kmTime), paceSec: kmTime });
    pacePerKm.push(Math.round(kmTime));
    lastKmTime = timeAtKm;
    lastKmMeters = kmIndex * 1000;
    kmIndex += 1;
  }

  if (totalMeters - lastKmMeters > 10) {
    const partialMeters = totalMeters - lastKmMeters;
    const partialTime = totalTime - lastKmTime;
    splits.push({ km: +( (lastKmMeters / 1000) + (partialMeters / 1000) ).toFixed(2), time: Math.round(partialTime), paceSec: partialTime });
    pacePerKm.push(Math.round(partialTime));
  }

  return { splits, pacePerKm, avgSpeedKmh, maxSpeedKmh: maxSpeed, totalMeters, totalTime };
}

/* ------------------------------- Component ------------------------------- */
function RunDetailScreenInner({ route, navigation }) {
  const run = route?.params?.run;
  const viewRef = useRef(null);
  const anim = useRef(new Animated.Value(0)).current;

  // animate on mount
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, [anim]);

  // guard run presence early
  if (!run) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: "#fff" }}>Corrida inválida</Text>
      </View>
    );
  }

  // compute splits & stats (memoized)
  const { splits, pacePerKm, avgSpeedKmh, maxSpeedKmh, totalMeters, totalTime } = useMemo(
    () => computeSplits(run?.path || [], run?.duration || 0),
    [run]
  );

  const runPaceSec = useMemo(() => {
    if (!run || !run.distance || !run.duration) return 0;
    return safeNum(run.duration) / (safeNum(run.distance) / 1000 || 1);
  }, [run]);

  const totalKm = useMemo(() => {
    return Number.isFinite(totalMeters) && totalMeters > 0
      ? (totalMeters / 1000).toFixed(2)
      : ((safeNum(run.distance) / 1000).toFixed?.(2) ?? "0.00");
  }, [totalMeters, run]);

  // compute user's historical avg pace for insight (non-blocking)
  const [userAvgPace, setUserAvgPace] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const local = await sync.loadLocalRuns();
        if (!mounted) return;
        const filtered = (Array.isArray(local) ? local : []).filter((r) => r.distance && r.duration && r.id !== run?.id);
        if (filtered.length === 0) {
          setUserAvgPace(null);
          return;
        }
        let totalSec = 0;
        let totalKm = 0;
        for (const r of filtered) {
          const distKm = safeNum(r.distance) / 1000;
          const sec = safeNum(r.duration);
          if (distKm > 0 && sec > 0) {
            totalSec += sec;
            totalKm += distKm;
          }
        }
        if (totalKm > 0) setUserAvgPace(totalSec / totalKm);
      } catch (e) {
        debug("loadLocalRuns for avg pace failed", e);
      }
    })();
    return () => { mounted = false; };
  }, [run]);

  const paceDisplay = useMemo(() => formatPace(runPaceSec), [runPaceSec]);
  const avgSpeedDisplay = useMemo(() => (safeNum(avgSpeedKmh) || safeNum(run.avgSpeed, 0)).toFixed(1), [avgSpeedKmh, run]);

  // insights
  const insight = useMemo(() => {
    if (!userAvgPace || !runPaceSec) return null;
    const pct = ((userAvgPace - runPaceSec) / userAvgPace) * 100;
    const faster = pct > 0;
    const pctAbs = Math.abs(Math.round(pct));
    return { faster, pct: pctAbs, text: faster ? `Você foi ${pctAbs}% mais rápido que sua média` : `Você ficou ${pctAbs}% mais lento que sua média` };
  }, [userAvgPace, runPaceSec]);

  /* ---------------- Export GPX & JSON (safe) ---------------- */
  const exportGPX = useCallback(async () => {
    try {
      if (!run || !Array.isArray(run.path) || run.path.length === 0) {
        Alert.alert("Nada para exportar");
        return;
      }
      const safeName = (run.name || "Corrida Wayper").replace(/</g, "");
      const header = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Wayper" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${safeName}</name><trkseg>`;
      const pts = (run.path || [])
        .map((p) => {
          const t = p.timestamp ? new Date(p.timestamp).toISOString() : "";
          return `<trkpt lat="${p.latitude}" lon="${p.longitude}"><time>${t}</time></trkpt>`;
        })
        .join("\n");
      const footer = `</trkseg></trk></gpx>`;
      const gpx = `${header}\n${pts}\n${footer}`;
      const path = `${FileSystem.cacheDirectory}wayper_run_${run.id || Date.now()}.gpx`;
      await FileSystem.writeAsStringAsync(path, gpx, { encoding: FileSystem.EncodingUTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "application/gpx+xml", dialogTitle: "Exportar GPX - Wayper" });
      } else {
        Alert.alert("Exportado", `GPX salvo: ${path}`);
      }
    } catch (e) {
      debug("exportGPX", e);
      Alert.alert("Erro", "Não foi possível exportar GPX.");
    }
  }, [run]);

  const exportJSON = useCallback(async () => {
    try {
      const path = `${FileSystem.cacheDirectory}wayper_run_${run.id || Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(run), { encoding: FileSystem.EncodingUTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { dialogTitle: "Exportar JSON - Wayper" });
      } else {
        Alert.alert("Exportado", `JSON salvo: ${path}`);
      }
    } catch (e) {
      debug("exportJSON", e);
      Alert.alert("Erro", "Não foi possível exportar JSON.");
    }
  }, [run]);

  /* ---------------- Share map image (guard view-shot) ---------------- */
  const shareMapImage = useCallback(async () => {
    try {
      if (!captureRef) {
        Alert.alert("Funcionalidade indisponível", "Instale react-native-view-shot para habilitar captura de tela.");
        return;
      }
      if (!viewRef.current) {
        Alert.alert("Preview não disponível");
        return;
      }
      const uri = await captureRef(viewRef, { format: "png", quality: 0.9 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { dialogTitle: "Compartilhar imagem da corrida" });
      } else {
        Alert.alert("Pronto", uri);
      }
    } catch (e) {
      debug("shareMapImage", e);
      Alert.alert("Erro ao compartilhar imagem", "Falha ao capturar/compartilhar imagem.");
    }
  }, [viewRef]);

  /* ---------------- Map region (safe) ---------------- */
  const mid = Math.floor((run.path?.length || 1) / 2);
  const midPoint = run.path && run.path[mid] ? run.path[mid] : { latitude: run.path?.[0]?.latitude || 0, longitude: run.path?.[0]?.longitude || 0 };

  const animStyle = useMemo(() => ({
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }],
    opacity: anim,
  }), [anim]);

  /* ---------------- Render ---------------- */
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Animated.View ref={viewRef} style={[styles.topSection, { backgroundColor: "#000" }, animStyle]}>
        <WayperMapLibre
          style={styles.map}
          routePath={run.path || []}
          centerCoordinate={midPoint}
          showUserLocation={false}
          interactive={false}
          fitToContent={true}
        />

        <View style={styles.header}>
          <Text style={styles.title}>{run.name || "Corrida"}</Text>
          <Text style={styles.date}>{run.date ? new Date(run.date).toLocaleString() : "—"}</Text>
        </View>

        {run.photoUri ? <Image source={{ uri: run.photoUri }} style={styles.heroImage} /> : null}
      </Animated.View>

      <View style={styles.content}>
        {/* Summary row */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryBox}>
            <Text style={styles.label}>Distância</Text>
            <Text style={styles.value}>{totalKm} km</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.label}>Duração</Text>
            <Text style={styles.value}>{formatDuration(run.duration)}</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.label}>Pace Médio</Text>
            <Text style={styles.value}>{paceDisplay}</Text>
          </View>
        </View>

        {/* insight */}
        {insight && (
          <View style={styles.insight}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>{insight.text}</Text>
          </View>
        )}

        {/* pace chart */}
        <View style={{ marginTop: 12 }}>
          <Text style={styles.sectionTitle}>Pace por km</Text>
          <View style={styles.chartRow}>
            {(pacePerKm.length ? pacePerKm : [Math.round(runPaceSec)]).map((sec, idx) => {
              const isFaster = userAvgPace ? sec < userAvgPace : false;
              const denom = userAvgPace || Math.max(...(pacePerKm.length ? pacePerKm : [sec]), 1);
              const height = Math.max(MIN_BAR_HEIGHT, (sec / denom) * CHART_BASE_HEIGHT);
              return (
                <View style={styles.barWrap} key={`bar-${idx}`}>
                  <View style={[styles.bar, { height, backgroundColor: isFaster ? WAYPER_GREEN : "#ff7043" }]} />
                  <Text style={styles.barLabel}>{formatPace(sec)}</Text>
                  <Text style={styles.barSub}>{idx + 1} km</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* splits */}
        <View style={{ marginTop: 18 }}>
          <Text style={styles.sectionTitle}>Splits</Text>
          {splits.length === 0 ? (
            <Text style={{ color: "#aaa" }}>Splits não disponíveis</Text>
          ) : (
            splits.map((s, i) => (
              <View key={`split-${i}`} style={styles.splitRow}>
                <Text style={styles.splitKm}>{s.km} km</Text>
                <Text style={styles.splitTime}>{formatDuration(s.time)}</Text>
                <Text style={styles.splitPace}>{formatPace(s.time)}</Text>
              </View>
            ))
          )}
        </View>

        {/* details */}
        <View style={{ marginTop: 18 }}>
          <Text style={styles.sectionTitle}>Detalhes</Text>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Humor: </Text><Text style={styles.detailValue}>{run.mood || "—"}</Text></View>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Clima: </Text><Text style={styles.detailValue}>{run.weather || "—"}</Text></View>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Esforço (RPE): </Text><Text style={styles.detailValue}>{run.effort ?? "—"}</Text></View>
          <View style={[styles.detailRow, { marginTop: 8 }]}><Text style={styles.detailLabel}>Tags:</Text></View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
            {(run.tags || []).length === 0 ? <Text style={{ color: "#777" }}>—</Text> : (run.tags || []).map((t) => <View style={styles.tag} key={t}><Text style={styles.tagText}>{t}</Text></View>)}
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={styles.detailLabel}>Notas</Text>
            <Text style={{ color: "#ddd", marginTop: 6 }}>{run.notes || "—"}</Text>
          </View>
        </View>

        {/* actions */}
        <View style={{ marginTop: 20, marginBottom: 40 }}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: WAYPER_GREEN }]} onPress={exportGPX}>
            <Text style={styles.actionText}>Exportar GPX</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#333", marginTop: 8 }]} onPress={exportJSON}>
            <Text style={styles.actionText}>Exportar JSON</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#111", marginTop: 8 }]} onPress={shareMapImage}>
            <Text style={styles.actionText}>Compartilhar Imagem</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

/* wrap with memo for stability */
const RunDetailScreen = React.memo(RunDetailScreenInner);
export default RunDetailScreen;

/* ------------------------------- Styles (kept visually similar) ------------------------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { justifyContent: "center", alignItems: "center" },
  topSection: { backgroundColor: "#000" },
  map: { width: "100%", height: 240 },
  header: { padding: 12 },
  title: { color: WAYPER_GREEN, fontWeight: "800", fontSize: 20 },
  date: { color: "#aaa", marginTop: 6 },
  heroImage: { width: "100%", height: 160, marginTop: 8 },
  content: { padding: 12 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryBox: { flex: 1, backgroundColor: "#0d0d0d", margin: 6, padding: 12, borderRadius: 10, alignItems: "center" },
  label: { color: "#aaa", fontSize: 12 },
  value: { color: "#fff", fontWeight: "800", marginTop: 6 },

  insight: { backgroundColor: "#081c12", borderLeftWidth: 4, borderLeftColor: WAYPER_GREEN, padding: 12, marginTop: 12, borderRadius: 8 },

  sectionTitle: { color: WAYPER_GREEN, fontWeight: "800", marginBottom: 8 },

  chartRow: { flexDirection: "row", alignItems: "flex-end", paddingVertical: 8 },
  barWrap: { width: 54, alignItems: "center", marginRight: 8 },
  bar: { width: 40, borderRadius: 8, backgroundColor: WAYPER_GREEN },
  barLabel: { color: "#ddd", fontSize: 12, marginTop: 6 },
  barSub: { color: "#888", fontSize: 11 },

  splitRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderColor: "#111" },
  splitKm: { color: "#fff", fontWeight: "700" },
  splitTime: { color: "#ccc" },
  splitPace: { color: "#aaa" },

  detailRow: { flexDirection: "row", marginTop: 8 },
  detailLabel: { color: "#999", width: 120, fontWeight: "700" },
  detailValue: { color: "#fff" },

  tag: { backgroundColor: "#111", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, marginRight: 8, marginTop: 6 },
  tagText: { color: "#fff", fontWeight: "700" },

  actionBtn: { padding: 14, borderRadius: 12, alignItems: "center" },
  actionText: { color: "#fff", fontWeight: "800" },
});
