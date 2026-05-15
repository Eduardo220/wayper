import React, { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import WayperMapLibre, { WAYPER_FALLBACK_COORD } from "../../components/Map/WayperMapLibre";
import { WPButton, WPCard, WPChip, WPScreen, WPSectionTitle } from "../../components/ui";
import { WayperTheme } from "../../theme/wayperTheme";
import sync from "../../utils/sync";

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

const safeNumber = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const formatKm = (meters) => (safeNumber(meters) / 1000).toFixed(2);

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
};

function CorridasScreen({ navigation }) {
  const [runs, setRuns] = useState([]);
  const [zones, setZones] = useState([]);
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [rRaw, zRaw] = await Promise.allSettled([sync.loadLocalRuns(), sync.loadLocalZones()]);
      const r = rRaw.status === "fulfilled" && Array.isArray(rRaw.value) ? rRaw.value : [];
      const z = zRaw.status === "fulfilled" && Array.isArray(zRaw.value) ? zRaw.value : [];

      setRuns(r.map((x) => ({ ...x })).filter(Boolean).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)));
      setZones(z.map((x) => ({ ...x })).filter(Boolean).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)));
    } catch (e) {
      console.warn("CorridasScreen.loadAll unexpected error", e);
      Alert.alert("Erro", "Falha ao carregar corridas/zonas.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        if (!mounted) return;
        await loadAll();
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

  const merged = useMemo(() => {
    const r = (runs || []).map((x) => ({ ...x, __type: "run" }));
    const z = (zones || []).map((x) => ({ ...x, __type: "zone" }));
    if (filter === "free") return r;
    if (filter === "zones") return z;
    return [...r, ...z].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [runs, zones, filter]);

  const goToRun = useCallback((item) => navigation.navigate("RunDetail", { run: item }), [navigation]);
  const goToZone = useCallback((item) => navigation.navigate("ZoneDetail", { zone: item }), [navigation]);
  const goToMap = useCallback(() => {
    const parent = navigation.getParent?.();
    if (parent) parent.navigate("Mapa");
    else navigation.navigate("Mapa");
  }, [navigation]);

  const RenderRun = useCallback(
    ({ item }) => {
      const path = Array.isArray(item.path) ? item.path : [];
      const center = path[0] || WAYPER_FALLBACK_COORD;

      return (
        <Pressable onPress={() => goToRun(item)} style={styles.cardPressable}>
          <WPCard style={styles.card} glow={path.length > 1}>
            <View style={styles.cardHeader}>
              <View style={styles.runIcon}>
                <Ionicons name="walk-outline" size={21} color={WayperTheme.colors.textInverse} />
              </View>
              <View style={styles.cardTitleWrap}>
                <Text style={styles.runTitle}>{item.name || "Corrida"}</Text>
                <Text style={styles.date}>{safeDate(item.date)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.textSubtle} />
            </View>

            {path.length > 1 ? (
              <View pointerEvents="none" style={styles.preview}>
                <WayperMapLibre
                  style={styles.previewMap}
                  routePath={path}
                  centerCoordinate={center}
                  showUserLocation={false}
                  interactive={false}
                  fitToContent
                  contentPadding={{ top: 40, right: 40, bottom: 40, left: 40 }}
                />
              </View>
            ) : null}

            <View style={styles.metricRow}>
              <Metric label="Distância" value={`${formatKm(item.distance || item.totalMeters || 0)} km`} />
              <Metric label="Tempo" value={formatDuration(item.duration || 0)} />
              <Metric label="RPE" value={item.effort ?? "—"} />
            </View>

            <View style={styles.footerRow}>
              <Text style={styles.tagText}>{item.tags?.slice(0, 2).join(", ") || "Sem tags"}</Text>
              <Ionicons name="arrow-forward-circle" size={24} color={WayperTheme.colors.primary} />
            </View>
          </WPCard>
        </Pressable>
      );
    },
    [goToRun]
  );

  const RenderZone = useCallback(
    ({ item }) => {
      const coords = Array.isArray(item.coords) ? item.coords : [];
      const center = coords[0] || WAYPER_FALLBACK_COORD;
      const area = Math.round(item.area || 0);

      return (
        <WPCard style={styles.card} accent="cyan">
          <View style={styles.cardHeader}>
            <View style={[styles.runIcon, styles.zoneIcon]}>
              <Ionicons name="map-outline" size={21} color={WayperTheme.colors.textInverse} />
            </View>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.zoneTitle}>Zona • {area} m²</Text>
              <Text style={styles.date}>{safeDate(item.date)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.textSubtle} onPress={() => goToZone(item)} />
          </View>

          {coords.length >= 3 ? (
            <View style={styles.preview}>
              <WayperMapLibre
                style={styles.previewMap}
                zones={[{ coords }]}
                centerCoordinate={center}
                showUserLocation={false}
                interactive={false}
                fitToContent
                contentPadding={{ top: 40, right: 40, bottom: 40, left: 40 }}
              />
            </View>
          ) : null}

          <View style={styles.metricRow}>
            <Metric label="Área" value={`${area} m²`} accent="cyan" />
            <Metric label="Pontos" value={coords.length} accent="cyan" />
          </View>
        </WPCard>
      );
    },
    [goToZone]
  );

  const renderItem = useCallback(
    ({ item }) => {
      if (!item) return null;
      if (item.__type === "run") return <RenderRun item={item} />;
      return <RenderZone item={item} />;
    },
    [RenderRun, RenderZone]
  );

  return (
    <WPScreen safe={false}>
      <FlatList
        data={merged}
        keyExtractor={(item) => item?.id || `${item?.__type || "item"}_${String(item?.date || Date.now())}`}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAll} tintColor={WayperTheme.colors.primary} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <WPSectionTitle title="Corridas" subtitle="Histórico de rotas, zonas e atividades salvas." />
            <View style={styles.filterRow}>
              <WPChip label="Todas" active={filter === "all"} onPress={() => setFilter("all")} />
              <WPChip label="Corridas" active={filter === "free"} onPress={() => setFilter("free")} />
              <WPChip label="Zonas" active={filter === "zones"} onPress={() => setFilter("zones")} color="cyan" />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nenhuma atividade encontrada.</Text>
            <WPButton title="Ir para o mapa" compact onPress={goToMap} style={styles.emptyButton} />
          </View>
        }
      />
    </WPScreen>
  );
}

function Metric({ label, value, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

export default React.memo(CorridasScreen);

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 36,
  },
  header: {
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: WayperTheme.spacing.xl,
    paddingBottom: WayperTheme.spacing.md,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.sm,
  },
  card: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
  },
  cardPressable: {
    borderRadius: WayperTheme.radius.xxl,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardTitleWrap: {
    flex: 1,
    marginHorizontal: WayperTheme.spacing.md,
  },
  runIcon: {
    width: 46,
    height: 46,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  zoneIcon: {
    backgroundColor: WayperTheme.colors.cyan,
  },
  runTitle: {
    color: WayperTheme.colors.primary,
    fontSize: 18,
    fontWeight: "900",
  },
  zoneTitle: {
    color: WayperTheme.colors.cyan,
    fontSize: 18,
    fontWeight: "900",
  },
  date: {
    ...WayperTheme.typography.caption,
    marginTop: WayperTheme.spacing.xs,
  },
  preview: {
    height: 132,
    borderRadius: WayperTheme.radius.lg,
    overflow: "hidden",
    marginTop: WayperTheme.spacing.lg,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  previewMap: {
    flex: 1,
  },
  metricRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.lg,
  },
  metric: {
    flex: 1,
    minHeight: 68,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.md,
  },
  metricLabel: {
    ...WayperTheme.typography.caption,
  },
  metricValue: {
    marginTop: WayperTheme.spacing.xs,
    fontSize: 17,
    fontWeight: "900",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: WayperTheme.spacing.lg,
  },
  tagText: {
    ...WayperTheme.typography.caption,
    color: WayperTheme.colors.textMuted,
  },
  empty: {
    padding: WayperTheme.spacing.xxl,
    alignItems: "center",
  },
  emptyText: {
    ...WayperTheme.typography.body,
    color: WayperTheme.colors.textMuted,
    textAlign: "center",
  },
  emptyButton: {
    marginTop: WayperTheme.spacing.lg,
  },
});
