import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { auth } from "../firebaseConfig";
import HomeAvatar from "../components/Home/HomeAvatar";
import { loadCurrentProfile } from "../repositories/userProfileRepository";
import { listRanking, RANKING_SOURCE } from "../repositories/rankingRepository";
import { getRankingMonthKey } from "../services/ranking/constants";
import { WayperTheme } from "../theme/wayperTheme";
import { formatRankingMetric, hasCurrentPosition, INITIAL_RANKING_SELECTION, rankingRequest, rankingRows } from "./rankingHomeModel";
import styles from "./RankingScreen.styles";
import RankingDetailScreen from "./ranking/RankingDetailScreen";
import { visibleRanking } from "./ranking/rankingDetailModel";
import { localProfileSnapshot } from "./ranking/playerProfileModel";

const SOURCE_LABEL = {
  [RANKING_SOURCE.REMOTE]: "Dados online",
  [RANKING_SOURCE.CACHE]: "Dados salvos • podem estar desatualizados",
  [RANKING_SOURCE.LOCAL]: "Dados locais deste aparelho",
};

function Choice({ label, icon, selected, onPress, accent = WayperTheme.colors.primary }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      activeOpacity={0.82}
      onPress={onPress}
      style={[styles.choice, selected && { backgroundColor: accent }]}
    >
      <Ionicons name={icon} size={15} color={selected ? WayperTheme.colors.textInverse : WayperTheme.colors.textMuted} />
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ModeCard({ label, description, icon, selected, accent, accentSoft, onPress }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${description}`}
      accessibilityState={{ selected }}
      activeOpacity={0.84}
      onPress={onPress}
      style={[styles.modeCard, selected && { borderColor: accent, backgroundColor: accentSoft }]}
    >
      <View style={[styles.modeIcon, selected && { borderColor: accent, backgroundColor: accentSoft }]}>
        <Ionicons name={icon} size={20} color={selected ? accent : WayperTheme.colors.textMuted} />
      </View>
      <Text style={[styles.modeTitle, selected && { color: accent }]}>{label}</Text>
      <Text style={styles.modeDescription}>{description}</Text>
    </TouchableOpacity>
  );
}

function SummaryBody({ current, shown, rows, accent }) {
  if (!current) return <ActivityIndicator style={styles.summaryLoading} color={accent} accessibilityLabel="Carregando ranking" />;
  if (shown.preview) return <View style={styles.summaryCountRow}>
    <Text style={[styles.athleteCount, { color: accent }]}>{shown.rows.length}</Text>
    <Text style={styles.athleteCaption}>atletas{"\n"}Prévia visual • DEV</Text>
  </View>;
  if (current.missingCity) return <Text style={styles.summaryEmpty}>Cidade indisponível no perfil. O ranking regional não pode ser exibido.</Text>;
  if (current.error && !rows.length) return <Text style={styles.summaryEmpty}>Não foi possível carregar o ranking desta seleção.</Text>;
  if (!rows.length) return <Text style={styles.summaryEmpty}>Nenhum resultado real nesta seleção.</Text>;
  return <View style={styles.summaryCountRow}>
    <Text style={[styles.athleteCount, { color: accent }]}>{rows.length}</Text>
    <Text style={styles.athleteCaption}>{current.source === RANKING_SOURCE.LOCAL
      ? `${rows.length === 1 ? "atleta" : "atletas"} com dados locais`
      : `${rows.length === 1 ? "atleta" : "atletas"} nesta lista de até 300`}</Text>
  </View>;
}

export default function RankingScreen({ navigation }) {
  const [selection, setSelection] = useState(INITIAL_RANKING_SELECTION);
  const [detailOpen, setDetailOpen] = useState(false);
  const [profile, setProfile] = useState({ city: "", name: "", avatar: null });
  const [result, setResult] = useState({ key: null, rows: [], source: RANKING_SOURCE.EMPTY });
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const city = profile.city;
  const regionalCity = selection.scope === "regional" ? city : null;
  const request = useMemo(() => rankingRequest(selection, regionalCity), [selection, regionalCity]);
  const monthKey = getRankingMonthKey();
  const requestKey = `${selection.mode}:${selection.scope}:${selection.period}:${request.city || ""}:${selection.period === "monthly" ? monthKey : ""}`;
  const current = result.key === requestKey ? result : null;
  const rows = current?.rows || [];
  const previewData = __DEV__ && current && rows.length === 0
    ? require("./ranking/__fixtures__/rankingPreviewData").rankingPreviewData(selection)
    : null;
  const shown = current ? visibleRanking(rows, previewData, __DEV__) : { rows: [], preview: false, me: null };
  const myRank = shown.me || rows.find((item) => item.id === auth.currentUser?.uid);
  const competitiveRank = shown.preview || hasCurrentPosition(current?.source, myRank);
  const accent = selection.mode === "km" ? WayperTheme.colors.primary : WayperTheme.colors.cyan;
  const [year, month] = monthKey.split("-").map(Number);
  const periodLabel = selection.period === "monthly"
    ? `Mensal • ${new Date(year, month - 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`
    : "Histórico geral";

  useEffect(() => {
    let active = true;
    loadCurrentProfile().then((loaded) => {
      if (!active) return;
      const user = loaded.data?.userDoc || {};
      const local = loaded.data?.profile || {};
      setProfile({
        city: String(user.city || local.city || "").trim(),
        name: user.name || user.displayName || local.name || local.displayName || auth.currentUser?.displayName || "",
        avatar: user.avatar || user.photoURL || local.avatar || local.photoURL || auth.currentUser?.photoURL || null,
      });
    }).catch((error) => console.warn("Ranking profile load failed:", error));
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (request.scope === "regional" && !request.city) {
      setResult({ key: requestKey, rows: [], source: RANKING_SOURCE.EMPTY, missingCity: true });
      return;
    }
    try {
      const response = await listRanking({ ...request, criterion: request.mode, allowCache: true });
      if (id !== requestId.current) return;
      setResult({
        key: requestKey,
        rows: rankingRows(
          response.data?.map((item) => item.localOnly && item.id === auth.currentUser?.uid
            ? { ...item, city: request.city || item.city }
            : item),
          selection,
          request.city,
          monthKey
        ),
        source: response.source,
        error: response.error,
      });
    } catch (error) {
      if (id !== requestId.current) return;
      console.warn("Ranking load failed:", error);
      setResult({ key: requestKey, rows: [], source: RANKING_SOURCE.EMPTY, error });
    }
  }, [monthKey, request, requestKey, selection]);

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const select = (key, value) => setSelection((previous) => ({ ...previous, [key]: value }));
  useFocusEffect(useCallback(() => {
    navigation.getParent()?.setOptions({ headerShown: !detailOpen });
    if (!detailOpen) return undefined;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      setDetailOpen(false);
      return true;
    });
    return () => back.remove();
  }, [detailOpen, navigation]));
  const scopeLabel = selection.scope === "global" ? "GLOBAL" : "REGIONAL";
  const regionLabel = selection.scope === "regional" && city ? ` • ${city}` : "";
  const summaryStatus = !current ? "Carregando" : shown.preview ? "Prévia visual DEV"
    : current.missingCity ? "Cidade indisponível"
    : current.error && !rows.length ? "Falha ao carregar" : `${rows.length} atletas carregados`;

  if (detailOpen) {
    return <RankingDetailScreen
      selection={selection}
      onSelect={select}
      onBack={() => setDetailOpen(false)}
      onOpenPlayer={(item, preview) => navigation.navigate("PlayerProfile", { playerId: item.id, playerName: item.name, playerAvatar: item.avatar, localSnapshot: localProfileSnapshot(item), preview })}
      current={current}
      rows={rows}
      profile={profile}
      city={city}
      monthKey={monthKey}
      refreshing={refreshing}
      onRefresh={onRefresh}
    />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} colors={[accent]} />}
    >
      <View style={styles.modeRow}>
        <ModeCard label="KM" description="Maior distância percorrida" icon="walk-outline" selected={selection.mode === "km"} accent={WayperTheme.colors.primary} accentSoft={WayperTheme.colors.primarySoft} onPress={() => select("mode", "km")} />
        <ModeCard label="ZONAS" description="Maior domínio territorial" icon="map-outline" selected={selection.mode === "zones"} accent={WayperTheme.colors.cyan} accentSoft={WayperTheme.colors.cyanSoft} onPress={() => select("mode", "zones")} />
      </View>

      <View accessibilityLabel="Abrangência" style={styles.choiceRow}>
        <Choice label="GLOBAL" icon="globe-outline" selected={selection.scope === "global"} onPress={() => select("scope", "global")} accent={accent} />
        <Choice label="REGIONAL" icon="location-outline" selected={selection.scope === "regional"} onPress={() => select("scope", "regional")} accent={accent} />
      </View>

      <View accessibilityLabel="Período" style={styles.choiceRow}>
        <Choice label="MENSAL" icon="calendar-outline" selected={selection.period === "monthly"} onPress={() => select("period", "monthly")} accent={accent} />
        <Choice label="GERAL" icon="trophy-outline" selected={selection.period === "allTime"} onPress={() => select("period", "allTime")} accent={accent} />
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Ranking ${scopeLabel}${regionLabel}, ${selection.mode === "km" ? "quilômetros percorridos" : "área dominada"}, ${periodLabel}, ${summaryStatus}. Ver ranking`}
        activeOpacity={0.84}
        onPress={() => setDetailOpen(true)}
        style={[styles.summaryCard, { borderColor: selection.mode === "km" ? WayperTheme.colors.primaryBorder : WayperTheme.colors.cyanBorder }]}
      >
        <View style={styles.summaryHeader}>
          <Ionicons name={selection.scope === "global" ? "globe-outline" : "location-outline"} size={24} color={accent} style={styles.summaryIcon} />
          <View style={styles.summaryHeaderCopy}>
            <Text style={[styles.summaryScope, { color: accent }]}>RANKING {scopeLabel}{regionLabel}</Text>
            <Text style={styles.summaryTitle}>{selection.mode === "km" ? "KM PERCORRIDOS" : "ÁREA DOMINADA"}</Text>
            <Text style={styles.summaryPeriod}>{periodLabel}</Text>
          </View>
        </View>
        <SummaryBody current={current} shown={shown} rows={rows} accent={accent} />
        {!shown.preview && current?.source && SOURCE_LABEL[current.source] ? <Text style={styles.sourceLabel}>{SOURCE_LABEL[current.source]}</Text> : null}
        <View style={[styles.cta, { backgroundColor: accent }]}>
          <Text style={styles.ctaText}>VER RANKING</Text>
          <Ionicons name="chevron-forward" size={18} color={WayperTheme.colors.textInverse} />
        </View>
      </TouchableOpacity>

      <View style={styles.positionCard}>
        <View style={styles.positionHeader}>
          <Text style={styles.positionHeading}>SUA POSIÇÃO</Text>
          <Text style={styles.positionContext}>{selection.mode === "km" ? "KM" : "ZONAS"} • {scopeLabel} • {selection.period === "monthly" ? "MENSAL" : "GERAL"}</Text>
        </View>
        <View style={styles.positionRow}>
          <Text style={[styles.positionNumber, { color: accent }]}>{myRank && competitiveRank ? `#${myRank.rank}` : "#—"}</Text>
          <HomeAvatar uri={myRank?.avatar || profile.avatar} name={myRank?.name || profile.name || "Atleta"} size={38} />
          <View style={styles.positionNameWrap}>
            <Text style={styles.positionName} numberOfLines={1}>{myRank?.name || profile.name || "Você"}</Text>
            <Text style={styles.positionNote} numberOfLines={1}>{shown.preview ? "VOCÊ • PRÉVIA DEV" : competitiveRank ? "Entre atletas carregados" : "Posição indisponível"}</Text>
          </View>
          <Text style={[styles.positionMetric, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>{myRank ? formatRankingMetric(myRank.metric, selection.mode) : "—"}</Text>
        </View>
      </View>
    </ScrollView>
  );
}
