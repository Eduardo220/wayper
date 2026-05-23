import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import { fetchAllRanking, fetchLocalLeadersRanking, fetchMonthlyRanking } from "../services/ranking";
import { getMonthlyMedalForRank, getRankingMonthKey } from "../services/ranking/constants";
import { WayperTheme } from "../theme/wayperTheme";

const DEFAULT_AVATAR = "https://i.pravatar.cc/150?u=wayper";

const makeMockRanking = (city = "Santa Maria", count = 40) =>
  Array.from({ length: count }, (_, index) => {
    const distance = Math.round((Math.random() * 220 + 5) * 1000);
    const area = Math.round(Math.random() * 2_500_000 + 20_000);
    return {
      id: `mock-${index + 1}`,
      name: `Atleta ${index + 1}`,
      avatar: `https://i.pravatar.cc/150?img=${(index % 70) + 1}`,
      city,
      area,
      distance,
      monthlyArea: area * 0.35,
      monthlyDistance: distance * 0.35,
      totalRuns: Math.floor(Math.random() * 70),
      level: Math.floor(Math.random() * 40) + 1,
      xp: Math.floor(Math.random() * 25000),
      totalStolenAreaM2: Math.round(Math.random() * 450000),
      cellsLedCount: Math.floor(Math.random() * 12),
      leaderAreaM2: Math.round(Math.random() * 600000),
    };
  });

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const formatKm = (meters = 0) => `${(safeNumber(meters) / 1000).toFixed(2)} km`;

const formatArea = (m2 = 0) => {
  const safe = safeNumber(m2);
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(2)} km2`;
  return `${Math.round(safe)} m2`;
};

const getMetricValue = (item, mode, period) => {
  if (mode === "localLeaders") {
    return safeNumber(item.cellsLedCount);
  }
  if (mode === "stolenArea") {
    return safeNumber(item.totalStolenAreaM2);
  }
  if (mode === "cellsLed") {
    return safeNumber(item.cellsLedCount);
  }
  if (mode === "distance") {
    return safeNumber(period === "monthly" ? item.monthlyDistance ?? item.distance : item.distance);
  }
  return safeNumber(period === "monthly" ? item.monthlyArea ?? item.area : item.area);
};

const getMetricLabel = (item, mode, period) => {
  const value = getMetricValue(item, mode, period);
  if (mode === "localLeaders" || mode === "cellsLed") return `${Math.round(value)} regioes`;
  if (mode === "stolenArea") return formatArea(value);
  return mode === "distance" ? formatKm(value) : formatArea(value);
};

const getMetricTitle = (mode) => {
  if (mode === "distance") return "Km percorridos";
  if (mode === "localLeaders") return "Lideres locais";
  if (mode === "stolenArea") return "Area retomada";
  if (mode === "cellsLed") return "Regioes lideradas";
  return "Area capturada";
};

const getMedalLabel = (rank) => {
  if (rank === 1) return "Campeao";
  if (rank === 2) return "Vice";
  if (rank === 3) return "Bronze";
  const medal = getMonthlyMedalForRank(rank);
  if (!medal) return null;
  return medal.label;
};

const normalizeRanking = (list, mode, period) =>
  (Array.isArray(list) ? list : [])
    .map((item) => ({
      ...item,
      avatar: item.avatar || item.photoURL || DEFAULT_AVATAR,
      name: item.name || item.displayName || item.username || "Atleta",
    }))
    .sort((a, b) => getMetricValue(b, mode, period) - getMetricValue(a, mode, period))
    .map((item, index) => ({ ...item, rank: index + 1 }));

function SegmentButton({ label, active, onPress, icon }) {
  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={[styles.segmentButton, active && styles.segmentButtonActive]}>
      {icon ? (
        <Ionicons
          name={icon}
          size={15}
          color={active ? WayperTheme.colors.textInverse : WayperTheme.colors.textMuted}
        />
      ) : null}
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function RankItem({ item, mode, period, maxValue, isMe }) {
  const value = getMetricValue(item, mode, period);
  const ratio = Math.max(0.06, Math.min(1, value / Math.max(maxValue, 1)));
  const medalLabel = period === "monthly" ? getMedalLabel(item.rank) : null;
  const isLeader = item.rank === 1;
  const isCyanMode = mode === "area" || mode === "stolenArea";
  const accent = isCyanMode ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  const borderAccent = isCyanMode ? WayperTheme.colors.cyanBorder : WayperTheme.colors.primaryBorder;

  return (
    <View style={[styles.rankCard, isLeader && styles.rankCardLeader, isMe && styles.rankCardMe]}>
      <View style={styles.rankLeft}>
        <LinearGradient
          colors={
            isLeader
              ? [WayperTheme.colors.primary, WayperTheme.colors.primaryDark]
              : [WayperTheme.colors.surfaceSoft, WayperTheme.colors.surfaceElevated]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.rankBadge, { borderColor: isLeader ? WayperTheme.colors.primaryLight : borderAccent }]}
        >
          <Text style={[styles.rankText, isLeader && styles.rankTextLeader]}>{item.rank}</Text>
        </LinearGradient>
      </View>

      <View style={styles.avatarWrap}>
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        {isMe ? (
          <View style={styles.meDot}>
            <Ionicons name="person" size={10} color={WayperTheme.colors.textInverse} />
          </View>
        ) : null}
      </View>

      <View style={styles.rankBody}>
        <View style={styles.rankTopLine}>
          <View style={styles.nameWrap}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            {isMe ? <Text style={styles.meLabel}>Voce</Text> : null}
          </View>
          <Text style={[styles.metric, { color: accent }]}>{getMetricLabel(item, mode, period)}</Text>
        </View>

        <View style={styles.rankMetaRow}>
          <Text style={styles.info} numberOfLines={1}>
            {mode === "localLeaders"
              ? `${formatArea(item.leaderAreaM2 || item.area)} dominados`
              : `${item.totalRuns || 0} corridas - Nivel ${item.level || 1}`}
          </Text>
          {medalLabel ? (
            <View style={[styles.medalPill, { borderColor: borderAccent }]}>
              <Text style={[styles.medalText, { color: accent }]}>{medalLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.progressTrack}>
          <LinearGradient
            colors={!isCyanMode
              ? [WayperTheme.colors.primaryLight, WayperTheme.colors.primaryDark]
              : [WayperTheme.colors.cyan, WayperTheme.colors.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${ratio * 100}%` }]}
          />
        </View>
      </View>
    </View>
  );
}

export default function RankingScreen({ route, navigation }) {
  const injectedCity = route?.params?.city || "Santa Maria";
  const currentUid = auth.currentUser?.uid;

  const [city, setCity] = useState(injectedCity);
  const [scope, setScope] = useState("global");
  const [period, setPeriod] = useState("monthly");
  const [mode, setMode] = useState("area");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState([]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  const persistMyMonthlyPreview = useCallback(
    async (ranking) => {
      const uid = auth.currentUser?.uid;
      if (!uid || period !== "monthly" || !["area", "distance"].includes(mode)) return;

      const me = ranking.find((item) => item.id === uid);
      if (!me?.rank) return;

      const field = mode === "distance" ? "bestMonthlyRankDistance" : "bestMonthlyRankArea";
      try {
        await setDoc(
          doc(db, "users", uid),
          {
            monthlyRankPreview: me.rank,
            [field]: me.rank,
            bestMonthlyRank: me.rank,
            rankingMonth: getRankingMonthKey(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (error) {
        console.warn("Ranking preview persist failed:", error);
      }
    },
    [mode, period]
  );

  const loadRanking = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const args = {
          scope,
          city: scope === "regional" ? city.trim() || null : null,
          criterion: mode,
          limitTo: 300,
        };

        const territoryAggregateMode = mode === "stolenArea" || mode === "cellsLed";
        const remote = mode === "localLeaders"
          ? await fetchLocalLeadersRanking({ limitTo: 300 })
          : period === "monthly" && !territoryAggregateMode
            ? await fetchMonthlyRanking(args)
            : await fetchAllRanking(args);

        const source = Array.isArray(remote) && remote.length
          ? remote
          : mode === "localLeaders"
            ? []
            : makeMockRanking(city);
        const normalized = normalizeRanking(source, mode, period);
        setData(normalized);
        persistMyMonthlyPreview(normalized);
      } catch (error) {
        console.warn("Ranking load error:", error);
        setData(mode === "localLeaders" ? [] : normalizeRanking(makeMockRanking(city), mode, period));
        Alert.alert("Ranking", mode === "localLeaders" ? "Nao foi possivel carregar lideres locais agora." : "Usando dados locais de exemplo porque o ranking remoto falhou.");
      } finally {
        setLoading(false);
      }
    },
    [city, mode, period, persistMyMonthlyPreview, scope]
  );

  useEffect(() => {
    loadRanking();
  }, [loadRanking]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 360,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        speed: 17,
        bounciness: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRanking({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadRanking]);

  const goToMap = useCallback(
    (item = null) => {
      navigation?.navigate("Mapa", {
        focusUserId: item?.id || currentUid || null,
        focusCellId: item?.bestCellId || route?.params?.focusCellId || route?.params?.cellId || null,
      });
    },
    [currentUid, navigation, route?.params?.cellId, route?.params?.focusCellId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((item) => {
      const name = String(item.name || "").toLowerCase();
      const username = String(item.username || "").toLowerCase();
      const cityName = String(item.city || "").toLowerCase();
      return name.includes(q) || username.includes(q) || cityName.includes(q);
    });
  }, [data, search]);

  const leader = filtered[0] || null;
  const myRank = useMemo(() => filtered.find((item) => item.id === currentUid) || null, [currentUid, filtered]);
  const maxValue = useMemo(() => Math.max(...filtered.map((item) => getMetricValue(item, mode, period)), 1), [filtered, mode, period]);
  const monthLabel = getRankingMonthKey();
  const subtitle = `${period === "monthly" ? `Mensal ${monthLabel}` : "Geral"} • ${scope === "regional" ? city : "Global"}`;

  const Header = useCallback(
    () => (
      <Animated.View style={[styles.headerContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <LinearGradient
          colors={["rgba(0,230,118,0.22)", "rgba(56,217,255,0.08)", "rgba(11,20,29,0.92)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Ionicons name="podium-outline" size={28} color={WayperTheme.colors.primary} />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroEyebrow}>Wayper ranking</Text>
              <Text style={styles.title}>Ranking</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <TouchableOpacity activeOpacity={0.84} style={styles.refreshButton} onPress={onRefresh}>
              <Ionicons name="sync-outline" size={21} color={WayperTheme.colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{filtered.length}</Text>
              <Text style={styles.heroStatLabel}>Atletas</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{getMetricTitle(mode)}</Text>
              <Text style={styles.heroStatLabel}>Criterio</Text>
            </View>
          </View>

          {leader ? (
            <View style={styles.leaderPanel}>
              <View style={styles.leaderAvatarShell}>
                <Image source={{ uri: leader.avatar }} style={styles.leaderAvatar} />
              </View>
              <View style={styles.leaderBody}>
                <Text style={styles.leaderLabel}>Lider atual</Text>
                <Text style={styles.leaderName} numberOfLines={1}>{leader.name}</Text>
                <Text style={styles.leaderMeta}>{getMetricLabel(leader, mode, period)} • Nivel {leader.level || 1}</Text>
              </View>
              <View style={styles.leaderBadge}>
                <Text style={styles.leaderBadgeText}>#1</Text>
              </View>
              {mode === "localLeaders" ? (
                <TouchableOpacity activeOpacity={0.86} style={styles.leaderMapButton} onPress={() => goToMap(leader)}>
                  <Ionicons name="map-outline" size={17} color={WayperTheme.colors.textInverse} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </LinearGradient>

        <View style={styles.controlsCard}>
          <View style={styles.segmentGroup}>
            <SegmentButton label="Mensal" active={period === "monthly"} onPress={() => setPeriod("monthly")} icon="calendar-outline" />
            <SegmentButton label="Geral" active={period === "all"} onPress={() => setPeriod("all")} icon="infinite-outline" />
          </View>

          <View style={styles.segmentGroup}>
            <SegmentButton label="Global" active={scope === "global"} onPress={() => setScope("global")} icon="earth-outline" />
            <SegmentButton label="Regional" active={scope === "regional"} onPress={() => setScope("regional")} icon="location-outline" />
          </View>

          <View style={styles.modeRow}>
            <TouchableOpacity activeOpacity={0.86} onPress={() => setMode("area")} style={[styles.modeButton, mode === "area" && styles.modeButtonActiveCyan]}>
              <Ionicons name="map-outline" size={18} color={mode === "area" ? WayperTheme.colors.textInverse : WayperTheme.colors.cyan} />
              <Text style={[styles.modeText, mode === "area" && styles.modeTextActive]}>Area</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.86} onPress={() => setMode("distance")} style={[styles.modeButton, mode === "distance" && styles.modeButtonActive]}>
              <Ionicons name="walk-outline" size={18} color={mode === "distance" ? WayperTheme.colors.textInverse : WayperTheme.colors.primary} />
              <Text style={[styles.modeText, mode === "distance" && styles.modeTextActive]}>Km</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modeRow}>
            <TouchableOpacity activeOpacity={0.86} onPress={() => setMode("localLeaders")} style={[styles.modeButton, mode === "localLeaders" && styles.modeButtonActive]}>
              <Ionicons name="flag-outline" size={18} color={mode === "localLeaders" ? WayperTheme.colors.textInverse : WayperTheme.colors.primary} />
              <Text style={[styles.modeText, mode === "localLeaders" && styles.modeTextActive]}>Lideres locais</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.86} onPress={() => setMode("stolenArea")} style={[styles.modeButton, mode === "stolenArea" && styles.modeButtonActiveCyan]}>
              <Ionicons name="repeat-outline" size={18} color={mode === "stolenArea" ? WayperTheme.colors.textInverse : WayperTheme.colors.cyan} />
              <Text style={[styles.modeText, mode === "stolenArea" && styles.modeTextActive]}>Retomada</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.86} onPress={() => setMode("cellsLed")} style={[styles.modeButton, mode === "cellsLed" && styles.modeButtonActive]}>
              <Ionicons name="podium-outline" size={18} color={mode === "cellsLed" ? WayperTheme.colors.textInverse : WayperTheme.colors.primary} />
              <Text style={[styles.modeText, mode === "cellsLed" && styles.modeTextActive]}>Regioes</Text>
            </TouchableOpacity>
          </View>

          {scope === "regional" ? (
            <View style={styles.inputShell}>
              <Ionicons name="business-outline" size={17} color={WayperTheme.colors.textSubtle} />
              <TextInput
                value={city}
                onChangeText={setCity}
                placeholder="Cidade"
                placeholderTextColor={WayperTheme.colors.textSubtle}
                style={styles.input}
              />
            </View>
          ) : null}

          <View style={styles.inputShell}>
            <Ionicons name="search-outline" size={17} color={WayperTheme.colors.textSubtle} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar atleta, usuario ou cidade"
              placeholderTextColor={WayperTheme.colors.textSubtle}
              style={styles.input}
            />
          </View>
        </View>

        {mode === "localLeaders" ? (
          <View style={styles.localLeaderCard}>
            <View style={styles.localLeaderIcon}>
              <Ionicons name="flag" size={22} color={WayperTheme.colors.primary} />
            </View>
            <View style={styles.localLeaderBody}>
              <Text style={styles.localLeaderTitle}>Voce lidera {myRank?.cellsLedCount || 0} regioes</Text>
              <Text style={styles.localLeaderText}>
                Area dominada: {formatArea(myRank?.leaderAreaM2 || myRank?.area || 0)}
                {myRank?.bestCellId ? ` - melhor disputa: ${myRank.bestCellId}` : ""}
              </Text>
            </View>
            <TouchableOpacity activeOpacity={0.86} style={styles.mapButton} onPress={() => goToMap(myRank || leader)}>
              <Ionicons name="map-outline" size={17} color={WayperTheme.colors.textInverse} />
              <Text style={styles.mapButtonText}>Mapa</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {myRank ? (
          <View style={styles.myRankCard}>
            <Ionicons name="person-circle-outline" size={22} color={WayperTheme.colors.primary} />
            <Text style={styles.myRankText}>Sua posicao: #{myRank.rank}</Text>
            <Text style={styles.myRankValue}>{getMetricLabel(myRank, mode, period)}</Text>
          </View>
        ) : null}

        <View style={styles.listTitleRow}>
          <Text style={styles.listTitle}>Classificacao</Text>
          <Text style={styles.listSubtitle}>{filtered.length} resultados</Text>
        </View>
      </Animated.View>
    ),
    [city, fadeAnim, filtered.length, goToMap, leader, mode, monthLabel, myRank, onRefresh, period, scope, search, slideAnim, subtitle]
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={WayperTheme.colors.primary} />
          <Text style={styles.loadingText}>Carregando ranking...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <RankItem
              item={item}
              mode={mode}
              period={period}
              maxValue={maxValue}
              isMe={item.id === currentUid}
            />
          )}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={<Header />}
          ListEmptyComponent={<EmptyRanking />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={WayperTheme.colors.primary}
              colors={[WayperTheme.colors.primary]}
            />
          }
        />
      )}
    </View>
  );
}

function EmptyRanking() {
  return (
    <View style={styles.emptyCard}>
      <Ionicons name="search-outline" size={26} color={WayperTheme.colors.textSubtle} />
      <Text style={styles.emptyTitle}>Sem resultados</Text>
      <Text style={styles.emptyText}>Tente mudar os filtros ou atualizar o ranking.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.background,
  },
  loadingText: {
    color: WayperTheme.colors.textMuted,
    marginTop: WayperTheme.spacing.md,
    fontWeight: "700",
  },
  listContent: {
    paddingBottom: 44,
  },
  headerContainer: {
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: WayperTheme.spacing.xl,
  },
  hero: {
    borderRadius: WayperTheme.radius.xxl,
    padding: WayperTheme.spacing.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  heroText: {
    flex: 1,
  },
  heroEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 31,
    fontWeight: "900",
    marginTop: 2,
  },
  subtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 3,
  },
  refreshButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
  },
  heroStats: {
    flexDirection: "row",
    gap: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.xl,
  },
  heroStat: {
    flex: 1,
    minHeight: 76,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.lg,
  },
  heroStatValue: {
    color: WayperTheme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  heroStatLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  leaderPanel: {
    minHeight: 92,
    marginTop: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    padding: WayperTheme.spacing.md,
  },
  leaderAvatarShell: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 3,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  leaderAvatar: {
    width: "100%",
    height: "100%",
    borderRadius: 29,
    backgroundColor: WayperTheme.colors.surfaceSoft,
  },
  leaderBody: {
    flex: 1,
  },
  leaderLabel: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  leaderName: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  leaderMeta: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  leaderBadge: {
    minWidth: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
  },
  leaderBadgeText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 16,
    fontWeight: "900",
  },
  leaderMapButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    marginLeft: WayperTheme.spacing.sm,
  },
  controlsCard: {
    marginTop: WayperTheme.spacing.lg,
    padding: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    ...WayperTheme.shadows.card,
  },
  segmentGroup: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginBottom: WayperTheme.spacing.sm,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.xs,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  segmentButtonActive: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
    ...WayperTheme.shadows.greenGlow,
  },
  segmentText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  segmentTextActive: {
    color: WayperTheme.colors.textInverse,
  },
  modeRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.xs,
  },
  modeButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: WayperTheme.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
  },
  modeButtonActive: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
  },
  modeButtonActiveCyan: {
    backgroundColor: WayperTheme.colors.cyan,
    borderColor: WayperTheme.colors.cyanBorder,
  },
  modeText: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  modeTextActive: {
    color: WayperTheme.colors.textInverse,
  },
  inputShell: {
    minHeight: 48,
    marginTop: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: WayperTheme.spacing.md,
    gap: WayperTheme.spacing.sm,
  },
  input: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  myRankCard: {
    minHeight: 58,
    marginTop: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: WayperTheme.spacing.lg,
    gap: WayperTheme.spacing.sm,
  },
  localLeaderCard: {
    minHeight: 76,
    marginTop: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    padding: WayperTheme.spacing.md,
    gap: WayperTheme.spacing.md,
    ...WayperTheme.shadows.card,
  },
  localLeaderIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  localLeaderBody: {
    flex: 1,
  },
  localLeaderTitle: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  localLeaderText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: 2,
  },
  mapButton: {
    minHeight: 40,
    paddingHorizontal: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.xs,
  },
  mapButtonText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 12,
    fontWeight: "900",
  },
  myRankText: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  myRankValue: {
    color: WayperTheme.colors.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  listTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: WayperTheme.spacing.xl,
    marginBottom: WayperTheme.spacing.sm,
  },
  listTitle: {
    color: WayperTheme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  listSubtitle: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
  },
  rankCard: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.md,
    minHeight: 104,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    ...WayperTheme.shadows.card,
  },
  rankCardLeader: {
    borderColor: WayperTheme.colors.primaryBorder,
  },
  rankCardMe: {
    borderColor: WayperTheme.colors.cyanBorder,
  },
  rankLeft: {
    width: 42,
    alignItems: "center",
    marginRight: WayperTheme.spacing.sm,
  },
  rankBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  rankText: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  rankTextLeader: {
    color: WayperTheme.colors.textInverse,
  },
  avatarWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    marginRight: WayperTheme.spacing.md,
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: 29,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
  },
  meDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.cyan,
    borderWidth: 2,
    borderColor: WayperTheme.colors.surfaceElevated,
  },
  rankBody: {
    flex: 1,
  },
  rankTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: WayperTheme.spacing.md,
  },
  nameWrap: {
    flex: 1,
  },
  name: {
    color: WayperTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  meLabel: {
    color: WayperTheme.colors.cyan,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 1,
  },
  metric: {
    fontSize: 15,
    fontWeight: "900",
  },
  rankMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.xs,
  },
  info: {
    flex: 1,
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  medalPill: {
    minHeight: 25,
    paddingHorizontal: WayperTheme.spacing.sm,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  medalText: {
    fontSize: 11,
    fontWeight: "900",
  },
  progressTrack: {
    height: 7,
    marginTop: WayperTheme.spacing.sm,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: WayperTheme.radius.pill,
  },
  emptyCard: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.xl,
    minHeight: 160,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: WayperTheme.spacing.xl,
  },
  emptyTitle: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: WayperTheme.spacing.md,
  },
  emptyText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: WayperTheme.spacing.xs,
  },
});
