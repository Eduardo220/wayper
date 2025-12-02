/**
 * src/screens/Runs/CorridasScreen.js */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  RefreshControl,
  Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import sync from "../../utils/sync";

const WAYPER_GREEN = "#00e676";
const PLACEHOLDER_IMG = null; // se quiser um fallback local coloque require('...')

/* ---------------- utils ---------------- */
const safeDate = (d) => {
  try {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toLocaleString();
  } catch {
    return "—";
  }
};

const safeNumber = (v, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;

const formatKm = (meters) => (safeNumber(meters) / 1000).toFixed(2);

const formatMinutes = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.round(s / 60)} min`;
};

/* ---------------- main component ---------------- */
function CorridasScreen({ navigation }) {
  const [runs, setRuns] = useState([]);
  const [zones, setZones] = useState([]);
  const [filter, setFilter] = useState("all"); // all | free | zones
  const [refreshing, setRefreshing] = useState(false);

  // load cached + local on demand
  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [rRaw, zRaw] = await Promise.allSettled([sync.loadLocalRuns(), sync.loadLocalZones()]);

      const r = rRaw.status === "fulfilled" && Array.isArray(rRaw.value) ? rRaw.value : [];
      const z = zRaw.status === "fulfilled" && Array.isArray(zRaw.value) ? zRaw.value : [];

      // sanitize & sort (newest first)
      const safeRuns = r
        .map((x) => ({ ...x }))
        .filter(Boolean)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      const safeZones = z
        .map((x) => ({ ...x }))
        .filter(Boolean)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      setRuns(safeRuns);
      setZones(safeZones);
    } catch (e) {
      console.warn("CorridasScreen.loadAll unexpected error", e);
      Alert.alert("Erro", "Falha ao carregar corridas/zonas.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  // On focus, refresh list (keeps UI fresh when returning from detail/screens)
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        if (!mounted) return;
        await loadAll();
        // try to start auto sync (optional)
        try {
          sync.startAutoSync?.();
        } catch (e) {
          console.warn("startAutoSync failed", e);
        }
      })();
      return () => {
        mounted = false;
        try {
          sync.stopAutoSync?.();
        } catch {}
      };
    }, [loadAll])
  );

  // merged dataset memoized
  const merged = useMemo(() => {
    const r = (runs || []).map((x) => ({ ...x, __type: "run" }));
    const z = (zones || []).map((x) => ({ ...x, __type: "zone" }));
    if (filter === "free") return r;
    if (filter === "zones") return z;
    return [...r, ...z].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [runs, zones, filter]);

  // navigation safe wrappers
  const goToRun = useCallback(
    (item) => {
      try {
        navigation.navigate("RunDetail", { run: item });
      } catch (e) {
        console.warn("navigation to RunDetail failed", e);
      }
    },
    [navigation]
  );

  const goToZone = useCallback(
    (item) => {
      try {
        navigation.navigate("ZoneDetail", { zone: item });
      } catch (e) {
        console.warn("navigation to ZoneDetail failed", e);
      }
    },
    [navigation]
  );

  const goToMap = useCallback(() => {
    // MainNavigator uses "Mapa" route name; adjust if different
    try {
      navigation.navigate("Mapa");
    } catch (e) {
      // fallback try english name
      try {
        navigation.navigate("Map");
      } catch {
        console.warn("Navigation to map failed");
      }
    }
  }, [navigation]);

  /* ---------------- renderers (memoized) ---------------- */
  const RenderRun = useCallback(
    ({ item }) => {
      const distance = formatKm(item.distance || item.totalMeters || 0);
      const duration = formatMinutes(item.duration || 0);
      const title = item.name || "Corrida";
      const img = item.photoUri || PLACEHOLDER_IMG;
      return (
        <TouchableOpacity style={styles.card} onPress={() => goToRun(item)}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.date}>{safeDate(item.date)}</Text>

          <Text style={styles.info}>
            {distance} km • {duration}
          </Text>

          {img ? <Image source={{ uri: img }} style={styles.image} /> : null}

          <View style={styles.rowMeta}>
            <Text style={styles.metaText}>RPE: {item.effort ?? "—"}</Text>
            <Text style={styles.metaText}>♢ {item.tags?.slice(0, 2).join(", ") || "—"}</Text>
          </View>
        </TouchableOpacity>
      );
    },
    [goToRun]
  );

  const RenderZone = useCallback(
    ({ item }) => {
      const area = Math.round(item.area || 0);
      const pts = (item.coords || []).length || 0;
      return (
        <TouchableOpacity style={[styles.card, styles.zoneCard]} onPress={() => goToZone(item)}>
          <Text style={[styles.title, styles.zoneTitle]}>Zona • {area} m²</Text>
          <Text style={styles.date}>{safeDate(item.date)}</Text>
          <Text style={styles.info}>{pts} pontos</Text>
        </TouchableOpacity>
      );
    },
    [goToZone]
  );

  const keyExtractor = useCallback((i) => {
    // ensure unique key; fallback to generated id
    return i?.id || `${i?.__type || "item"}_${String(i?.date || Date.now())}`;
  }, []);

  const renderItem = useCallback(
    ({ item }) => {
      if (!item) return null;
      if (item.__type === "run") return <RenderRun item={item} />;
      return <RenderZone item={item} />;
    },
    [RenderRun, RenderZone]
  );

  /* pull-to-refresh handler */
  const onRefresh = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  /* ---------------- UI ---------------- */
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Corridas</Text>
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterBtn, filter === "all" && styles.filterSelected]}
            onPress={() => setFilter("all")}
            accessibilityLabel="Filtrar todas"
          >
            <Text style={[styles.filterText, filter === "all" && styles.filterTextSelected]}>Todas</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterBtn, filter === "free" && styles.filterSelected]}
            onPress={() => setFilter("free")}
            accessibilityLabel="Filtrar corridas"
          >
            <Text style={[styles.filterText, filter === "free" && styles.filterTextSelected]}>Corridas</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterBtn, filter === "zones" && styles.filterSelected]}
            onPress={() => setFilter("zones")}
            accessibilityLabel="Filtrar zonas"
          >
            <Text style={[styles.filterText, filter === "zones" && styles.filterTextSelected]}>Zonas</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={merged}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={WAYPER_GREEN} />}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: "#aaa" }}>Nenhuma corrida encontrada</Text>
            <TouchableOpacity style={styles.quickBtn} onPress={goToMap}>
              <Text style={{ color: "#000", fontWeight: "700" }}>Ir para o mapa</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

/* memo export to avoid parent re-renders recreating component */
export default React.memo(CorridasScreen);

/* ---------------- styles (visual preserved) ---------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: { padding: 16, borderBottomWidth: 0.5, borderColor: "#111" },
  headerTitle: { color: WAYPER_GREEN, fontSize: 26, fontWeight: "800" },
  filterRow: { flexDirection: "row", marginTop: 12 },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#111",
    marginRight: 8,
  },
  filterSelected: { backgroundColor: WAYPER_GREEN },
  filterText: { color: "#ddd", fontWeight: "700" },
  filterTextSelected: { color: "#000" },

  card: {
    backgroundColor: "#111",
    marginHorizontal: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  zoneCard: {
    borderLeftWidth: 4,
    borderLeftColor: "#4fc3f7",
  },
  title: { color: WAYPER_GREEN, fontSize: 18, fontWeight: "800" },
  zoneTitle: { color: "#4fc3f7" },
  date: { color: "#888", marginTop: 6 },
  info: { color: "#fff", marginTop: 8 },
  image: { width: "100%", height: 140, borderRadius: 10, marginTop: 10 },

  rowMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  metaText: { color: "#999", fontSize: 13 },

  empty: { padding: 24, alignItems: "center" },
  quickBtn: {
    marginTop: 12,
    backgroundColor: WAYPER_GREEN,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
});
