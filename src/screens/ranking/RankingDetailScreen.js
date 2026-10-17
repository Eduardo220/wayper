import React from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import HomeAvatar from "../../components/Home/HomeAvatar";
import { auth } from "../../firebaseConfig";
import { WayperTheme } from "../../theme/wayperTheme";
import { badgeVariant, rankingContext, rankingMetric, rankingSecondary, rankingZoneCount, visibleRanking } from "./rankingDetailModel";
import styles from "./RankingDetailScreen.styles";

const { colors } = WayperTheme;

function SegmentedControl({ options, value, onChange, accent, label }) {
  return <View accessibilityLabel={label} style={styles.segment}>
    {options.map(([key, title, icon]) => {
      const selected = value === key;
      return <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ selected }}
        onPress={() => onChange(key)}
        style={[styles.segmentOption, selected && { backgroundColor: accent }]}
      >
        <Ionicons name={icon} size={15} color={selected ? colors.textInverse : colors.textMuted} />
        <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{title}</Text>
      </Pressable>;
    })}
  </View>;
}

function RankingRow({ item, mode, preview, period, onPress, me = false }) {
  const variant = badgeVariant(item.rank);
  const accent = mode === "km" ? colors.primary : colors.cyan;
  const zones = mode === "zones" ? rankingZoneCount(item, preview, period) : null;
  const secondary = me ? (preview ? "VOCÊ" : "VOCÊ • POSIÇÃO INDISPONÍVEL") : rankingSecondary(item, preview);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir perfil de ${item.name || "atleta"}${me ? ", você" : ""}`} onPress={() => onPress(item, preview)} style={[styles.row, me && styles.meRow, me && { borderColor: accent }]}>
    <View style={[styles.rankBadge, styles[variant], me && styles.meBadge]}>
      <Text style={[styles.rankText, variant === "neutral" && styles.rankNeutral]}>{me && !preview ? "—" : item.rank}</Text>
    </View>
    <HomeAvatar uri={item.avatar} name={item.name} size={34} style={styles.avatar} />
    <View style={styles.identity}>
      <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
      {secondary ? <Text style={styles.secondary} numberOfLines={1}>{secondary}</Text> : null}
    </View>
    <View style={styles.metricBlock}>
      <Text style={[styles.metric, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>{rankingMetric(item, mode)}</Text>
      {zones ? <Text style={styles.zoneCount}>{zones}</Text> : null}
    </View>
  </Pressable>;
}

export default function RankingDetailScreen({ selection, onSelect, onBack, onOpenPlayer, current, rows, profile, city, monthKey, refreshing, onRefresh }) {
  const accent = selection.mode === "km" ? colors.primary : colors.cyan;
  // O require só é executado em DEV; o preview não participa da consulta nem do cache.
  const previewData = __DEV__ && current && rows.length === 0
    ? require("./__fixtures__/rankingPreviewData").rankingPreviewData(selection)
    : null;
  const shown = current ? visibleRanking(rows, previewData, __DEV__) : { rows: [], preview: false, me: null };
  const me = shown.me || rows.find((row) => row.id === auth.currentUser?.uid) || {
    id: auth.currentUser?.uid || "current-user",
    name: profile.name || "Você",
    avatar: profile.avatar,
    metric: null,
  };
  const context = rankingContext(selection, city, monthKey, shown.preview);
  const empty = !current ? "Carregando classificação" : current.missingCity
    ? "Cidade indisponível no perfil." : current.error ? "Não foi possível carregar esta seleção."
      : "Nenhum atleta nesta seleção.";

  return <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar ao Ranking" onPress={onBack} hitSlop={12} style={styles.back}>
        <Ionicons name="chevron-back" size={25} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>Ranking</Text>
      <View style={styles.headerEnd} />
    </View>

    <View style={styles.filters}>
      <SegmentedControl label="Modalidade" options={[["km", "KM", "walk-outline"], ["zones", "ZONAS", "map-outline"]]} value={selection.mode} onChange={(value) => onSelect("mode", value)} accent={accent} />
      <SegmentedControl label="Abrangência" options={[["global", "GLOBAL", "globe-outline"], ["regional", "REGIONAL", "location-outline"]]} value={selection.scope} onChange={(value) => onSelect("scope", value)} accent={accent} />
      <SegmentedControl label="Período" options={[["monthly", "MENSAL", "calendar-outline"], ["allTime", "GERAL", "trophy-outline"]]} value={selection.period} onChange={(value) => onSelect("period", value)} accent={accent} />
    </View>

    <View style={[styles.contextCard, { borderColor: selection.mode === "km" ? colors.primaryBorder : colors.cyanBorder }]}>
      <Ionicons name={selection.scope === "global" ? "globe-outline" : "location-outline"} size={27} color={accent} style={styles.contextIcon} />
      <View style={styles.contextCopy}>
        <Text style={[styles.contextScope, { color: accent }]}>{context.scope}</Text>
        <Text style={styles.contextTitle}>{context.title}</Text>
        <Text style={styles.contextPeriod} numberOfLines={1}>{context.period}</Text>
      </View>
      <Ionicons name={selection.scope === "global" ? "globe-outline" : "map-outline"} size={72} color={accent} style={styles.contextWatermark} />
    </View>
    <Text style={styles.listHint}>{shown.preview ? "PRÉVIA VISUAL • DEV" : current ? "POSIÇÕES ENTRE ATLETAS CARREGADOS" : "CLASSIFICAÇÃO"}</Text>

    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={shown.rows}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <RankingRow item={item} mode={selection.mode} preview={shown.preview} period={selection.period} onPress={onOpenPlayer} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={<View style={styles.empty}>{!current ? <ActivityIndicator color={accent} /> : null}<Text style={styles.emptyText}>{empty}</Text></View>}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} colors={[accent]} />}
    />

    <View style={styles.currentBar}>
      <RankingRow item={me} mode={selection.mode} preview={shown.preview} period={selection.period} onPress={onOpenPlayer} me />
    </View>
  </SafeAreaView>;
}
