import React, { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import WayperMapLibre, { WAYPER_FALLBACK_COORD } from "../../components/Map/WayperMapLibre";
import TerritoryEventCard from "../../components/Territory/TerritoryEventCard";
import TerritoryFeedFilter from "../../components/Territory/TerritoryFeedFilter";
import { WPButton, WPCard, WPScreen, WPSectionTitle } from "../../components/ui";
import { WayperTheme } from "../../theme/wayperTheme";
import { auth } from "../../firebaseConfig";
import {
  buildTerritoryMapParams,
  fetchTerritoryFeed,
  filterCompetitiveFeedItems,
  loadLocalTerritoryFeed,
  mergeRunsZonesAndTerritoryEvents,
} from "../../services/territory";
import sync from "../../utils/sync";

const safeDate = (d) => {
  try {
    if (!d) return "-";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toLocaleString();
  } catch {
    return "-";
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

const getZoneCoords = (item = {}) => {
  if (Array.isArray(item.coordsPreview)) return item.coordsPreview;
  if (Array.isArray(item.zoneCoords)) return item.zoneCoords;
  if (Array.isArray(item.raw?.zoneCoords)) return item.raw.zoneCoords;
  if (Array.isArray(item.raw?.coords)) return item.raw.coords;
  return [];
};

const isZoneActivityRun = (item = {}) => {
  const zoneCoords = getZoneCoords(item);
  return item.__type === "zone" ||
    item.raw?.mode === "zones" ||
    safeNumber(item.areaM2 ?? item.area) > 0 ||
    zoneCoords.length >= 3 ||
    !!(item.zoneId || item.raw?.zoneId);
};

const hasMapParams = (params = {}) => Object.values(params).some(Boolean);

function CorridasScreen({ navigation }) {
  const [runs, setRuns] = useState([]);
  const [zones, setZones] = useState([]);
  const [territoryEvents, setTerritoryEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const currentUserId = auth?.currentUser?.uid ?? null;
      const [rRaw, zRaw, localEventsRaw, remoteEventsRaw] = await Promise.allSettled([
        sync.loadLocalRuns(),
        sync.loadLocalZones(),
        loadLocalTerritoryFeed({ currentUserId }),
        fetchTerritoryFeed({ scope: "public", userId: currentUserId, limitTo: 60 }),
      ]);

      const r = rRaw.status === "fulfilled" && Array.isArray(rRaw.value) ? rRaw.value : [];
      const z = zRaw.status === "fulfilled" && Array.isArray(zRaw.value) ? zRaw.value : [];
      const localEvents = localEventsRaw.status === "fulfilled" && Array.isArray(localEventsRaw.value) ? localEventsRaw.value : [];
      const remoteEvents = remoteEventsRaw.status === "fulfilled" && Array.isArray(remoteEventsRaw.value) ? remoteEventsRaw.value : [];
      const eventMap = new Map();
      [...localEvents, ...remoteEvents].forEach((event) => {
        if (event?.id) eventMap.set(`${event.__type || event.eventType || "event"}:${event.id}`, event);
      });
      const e = Array.from(eventMap.values());

      setRuns(r.map((x) => ({ ...x })).filter(Boolean).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)));
      setZones(z.map((x) => ({ ...x })).filter(Boolean).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)));
      setTerritoryEvents(e);

      if (localEventsRaw.status === "rejected") {
        console.warn("CorridasScreen local territory feed failed", localEventsRaw.reason);
      }
      if (remoteEventsRaw.status === "rejected") {
        console.warn("CorridasScreen remote territory feed failed", remoteEventsRaw.reason);
      }
    } catch (e) {
      console.warn("CorridasScreen.loadAll unexpected error", e);
      Alert.alert("Erro", "Falha ao carregar historico competitivo.");
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
    const items = mergeRunsZonesAndTerritoryEvents({ runs, zones, events: territoryEvents });
    return filterCompetitiveFeedItems(items, filter);
  }, [runs, zones, territoryEvents, filter]);

  const goToRun = useCallback((item) => navigation.navigate("RunDetail", { run: item }), [navigation]);
  const goToZone = useCallback((item) => navigation.navigate("ZoneDetail", { zone: item }), [navigation]);
  const goToMap = useCallback((item = null) => {
    const params = item ? buildTerritoryMapParams(item) : null;
    const parent = navigation.getParent?.();
    const targetParams = params && hasMapParams(params) ? params : undefined;

    if (parent) parent.navigate("Mapa", targetParams);
    else navigation.navigate("Mapa", targetParams);
  }, [navigation]);

  const RenderRun = useCallback(
    ({ item }) => {
      const raw = item.raw || item;
      const path = Array.isArray(item.path) && item.path.length > 0 ? item.path : (Array.isArray(raw.path) ? raw.path : []);
      const zoneCoords = getZoneCoords(item);
      const zoneActivity = isZoneActivityRun(item);
      const center = (zoneActivity && zoneCoords[0]) || path[0] || WAYPER_FALLBACK_COORD;
      const area = Math.round(safeNumber(item.areaM2 ?? raw.areaM2 ?? raw.area));
      const distance = item.distance ?? raw.distance ?? raw.totalMeters ?? 0;
      const duration = item.duration ?? raw.duration ?? 0;
      const title = item.title || raw.name || (zoneActivity ? "Captura por zonas" : "Corrida");

      return (
        <Pressable onPress={() => goToRun(raw)} style={styles.cardPressable}>
          <WPCard style={styles.card} accent={zoneActivity ? "cyan" : "green"} glow={path.length > 1 || zoneCoords.length >= 3}>
            <View style={styles.cardHeader}>
              <View style={[styles.runIcon, zoneActivity && styles.zoneIcon]}>
                <Ionicons name={zoneActivity ? "map-outline" : "walk-outline"} size={21} color={WayperTheme.colors.textInverse} />
              </View>
              <View style={styles.cardTitleWrap}>
                <Text style={[styles.runTitle, zoneActivity && styles.zoneTitle]}>{title}</Text>
                <Text style={styles.date}>{zoneActivity ? `Corrida por zonas - ${safeDate(item.date || raw.date)}` : safeDate(item.date || raw.date)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.textSubtle} />
            </View>

            {(zoneActivity && zoneCoords.length >= 3) || path.length > 1 ? (
              <View pointerEvents="none" style={styles.preview}>
                <WayperMapLibre
                  style={styles.previewMap}
                  routePath={zoneActivity && zoneCoords.length >= 3 ? [] : path}
                  routeMode="history"
                  zones={zoneActivity && zoneCoords.length >= 3 ? [{ coords: zoneCoords, area }] : []}
                  showZones={zoneActivity && zoneCoords.length >= 3}
                  centerCoordinate={center}
                  showUserLocation={false}
                  interactive={false}
                  fitToContent
                  contentPadding={{ top: 40, right: 40, bottom: 40, left: 40 }}
                />
              </View>
            ) : null}

            <View style={styles.metricRow}>
              <Metric label="Distancia" value={`${formatKm(distance)} km`} />
              <Metric label="Tempo" value={formatDuration(duration)} />
              <Metric label="RPE" value={raw.effort ?? "-"} />
            </View>

            {zoneActivity ? (
              <View style={styles.zoneDetailRow}>
                <Metric label="Area" value={`${area} m2`} accent="cyan" />
                <Metric label="Pontos" value={zoneCoords.length || 0} accent="cyan" />
              </View>
            ) : null}

            <View style={styles.footerRow}>
              <Text style={styles.tagText}>{zoneActivity ? `${zoneCoords.length || 0} pontos capturados` : raw.tags?.slice(0, 2).join(", ") || "Sem tags"}</Text>
              <Ionicons name="arrow-forward-circle" size={24} color={zoneActivity ? WayperTheme.colors.cyan : WayperTheme.colors.primary} />
            </View>
          </WPCard>
        </Pressable>
      );
    },
    [goToRun]
  );

  const RenderZone = useCallback(
    ({ item }) => {
      const raw = item.raw || item;
      const coords = getZoneCoords(item);
      const center = coords[0] || WAYPER_FALLBACK_COORD;
      const area = Math.round(safeNumber(item.areaM2 ?? raw.areaM2 ?? raw.area));

      return (
        <WPCard style={styles.card} accent="cyan">
          <View style={styles.cardHeader}>
            <View style={[styles.runIcon, styles.zoneIcon]}>
              <Ionicons name="map-outline" size={21} color={WayperTheme.colors.textInverse} />
            </View>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.zoneTitle}>{item.title || `Zona - ${area} m2`}</Text>
              <Text style={styles.date}>{safeDate(item.date || raw.date)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.textSubtle} onPress={() => goToZone(raw)} />
          </View>

          {coords.length >= 3 ? (
            <View style={styles.preview}>
              <WayperMapLibre
                style={styles.previewMap}
                zones={[{ coords, area }]}
                centerCoordinate={center}
                showUserLocation={false}
                interactive={false}
                fitToContent
                contentPadding={{ top: 40, right: 40, bottom: 40, left: 40 }}
              />
            </View>
          ) : null}

          <View style={styles.metricRow}>
            <Metric label="Area" value={`${area} m2`} accent="cyan" />
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
      if (String(item.__type || "").startsWith("territory_")) {
        return <TerritoryEventCard item={item} onPress={goToMap} onViewMap={goToMap} />;
      }
      if (item.__type === "run") return <RenderRun item={item} />;
      return <RenderZone item={item} />;
    },
    [RenderRun, RenderZone, goToMap]
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
            <WPSectionTitle title="Corridas" subtitle="Historico competitivo de rotas, capturas e liderancas." />
            <TerritoryFeedFilter value={filter} onChange={setFilter} />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nenhuma atividade encontrada.</Text>
            <WPButton title="Ir para o mapa" compact onPress={() => goToMap()} style={styles.emptyButton} />
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
  zoneDetailRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.sm,
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
