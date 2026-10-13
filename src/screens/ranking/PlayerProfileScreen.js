import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import HomeAvatar from "../../components/Home/HomeAvatar";
import { auth } from "../../firebaseConfig";
import { getPublicProfile } from "../../repositories/userProfileRepository";
import { getUserProgress } from "../../repositories/progressionRepository";
import { loadProfile } from "../../services/profile/profileService";
import { WayperTheme } from "../../theme/wayperTheme";
import { formatProfileStat, selectCompetitiveProfile } from "./playerProfileModel";
import styles from "./PlayerProfileScreen.styles";

const { colors } = WayperTheme;
const STATS = [
  ["totalKm", "KM TOTAL", "km", colors.primary, "quilômetros percorridos"],
  ["areaKm2", "ÁREA DOMINADA", "area", colors.cyan, "quilômetros quadrados dominados"],
  ["runs", "CORRIDAS", "count", colors.primary, "corridas"],
  ["zonesCaptured", "ZONAS CONQUISTADAS", "count", colors.cyan, "zonas conquistadas"],
  ["retakes", "RETOMADAS", "count", colors.cyan, "retomadas"],
  ["totalXp", "XP TOTAL", "count", colors.primary, "pontos de experiência"],
];

function PlayerStatCard({ field, label, kind, accent, spoken, profile }) {
  const value = profile[field];
  const display = formatProfileStat(value, kind);
  const speech = value == null ? `${spoken} indisponível` : `${String(display.split(" ")[0]).replace(",", " vírgula ")} ${spoken}`;
  return <View accessible accessibilityLabel={speech} style={styles.statCard}>
    <Text style={[styles.statValue, { color: accent }]}>{display}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>;
}

export default function PlayerProfileScreen({ route, navigation }) {
  const playerId = route?.params?.playerId;
  const playerName = route?.params?.playerName;
  const playerAvatar = route?.params?.playerAvatar;
  const localSnapshot = route?.params?.localSnapshot;
  const preview = route?.params?.preview === true;
  const [state, setState] = useState({ loading: true, profile: null, error: null });
  const [tab, setTab] = useState("overview");
  const [retry, setRetry] = useState(0);

  useFocusEffect(React.useCallback(() => {
    navigation.getParent()?.getParent()?.setOptions({ headerShown: false });
  }, [navigation]));

  useEffect(() => {
    let active = true;
    setState({ loading: true, profile: null, error: null });
    const load = async () => {
      if (!playerId) return { profile: null, error: null };
      if (__DEV__ && preview && playerId.startsWith("preview-")) {
        const fixture = require("./__fixtures__/playerProfilePreviewData").playerProfilePreviewData(playerId);
        return { profile: selectCompetitiveProfile(null, null, fixture, __DEV__), error: null };
      }
      if (localSnapshot?.id === playerId) {
        return { profile: selectCompetitiveProfile(null, localSnapshot, null, __DEV__), error: null };
      }
      const remote = await getPublicProfile(playerId);
      let local = null;
      if (!remote.data && playerId === auth.currentUser?.uid) {
        const [saved, progress] = await Promise.all([loadProfile(), getUserProgress({ userId: playerId })]);
        if (saved.lastUpdate || progress.totalXp > 0) {
          local = {
            ...saved, id: playerId,
            totalXp: progress.totalXp > 0 ? progress.totalXp : saved.totalXp ?? saved.globalPoints,
            level: progress.totalXp > 0 ? progress.level : saved.level,
            progressToNextLevelPct: progress.totalXp > 0 ? progress.progressToNextLevelPct : null,
          };
        }
      }
      return { profile: selectCompetitiveProfile(remote.data, local, null, __DEV__), error: remote.error };
    };
    load().then(({ profile, error }) => {
      if (active) setState({ loading: false, profile, error });
    }).catch((error) => {
      if (active) setState({ loading: false, profile: null, error });
    });
    return () => { active = false; };
  }, [playerId, preview, localSnapshot, retry]);

  const { loading, profile, error } = state;
  const me = playerId === auth.currentUser?.uid || (__DEV__ && preview && playerId?.startsWith("preview-me-"));
  return <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar à classificação" onPress={() => navigation.goBack()} hitSlop={12} style={styles.back}>
        <Ionicons name="chevron-back" size={25} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>Perfil</Text>
      <View style={styles.headerEnd} />
    </View>
    {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>Carregando perfil</Text></View>
      : !profile ? <View style={styles.center}>
        <Ionicons name={error ? "cloud-offline-outline" : "person-outline"} size={34} color={colors.textMuted} />
        <Text style={styles.stateTitle}>{error ? "Não foi possível carregar o perfil" : "Perfil indisponível"}</Text>
        <Text style={styles.stateText}>{error ? "Verifique sua conexão e tente novamente." : "Ainda não há dados públicos suficientes deste atleta."}</Text>
        {error ? <Pressable accessibilityRole="button" accessibilityLabel="Tentar carregar perfil novamente" onPress={() => setRetry((value) => value + 1)} style={styles.retry}>
          <Text style={styles.retryText}>TENTAR NOVAMENTE</Text>
        </Pressable> : null}
      </View>
        : <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {profile.preview ? <Text style={styles.preview}>PRÉVIA VISUAL • DEV</Text> : null}
          <View style={styles.identity}>
            <HomeAvatar uri={profile.avatar || playerAvatar} name={profile.username || playerName} size={88} />
            <Text style={styles.username}>{profile.username || playerName || "Atleta"}</Text>
            {profile.secondary ? <Text style={styles.secondary}>{profile.secondary}</Text> : null}
            {me ? <Text style={styles.you}>VOCÊ</Text> : null}
            {profile.level != null ? <Text style={styles.level}>Nível {profile.level}</Text> : null}
            {profile.progressPct != null ? <View accessibilityLabel={`Progresso do nível: ${profile.progressPct} por cento`} style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(100, profile.progressPct)}%` }]} />
            </View> : null}
          </View>
          <View style={styles.tabs}>
            {[["overview", "VISÃO GERAL"], ["achievements", "CONQUISTAS"]].map(([key, label]) => <Pressable
              key={key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabSelected]}>
              <Text style={[styles.tabText, tab === key && styles.tabTextSelected]}>{label}</Text>
            </Pressable>)}
          </View>
          {tab === "overview" ? <View style={styles.grid}>
            {STATS.map(([field, label, kind, accent, spoken]) => <PlayerStatCard key={field} field={field} label={label} kind={kind} accent={accent} spoken={spoken} profile={profile} />)}
          </View> : <View style={styles.achievements}>
            <Ionicons name="ribbon-outline" size={34} color={colors.cyan} />
            <Text style={styles.stateTitle}>CONQUISTAS</Text>
            <Text style={styles.stateText}>Nenhuma conquista disponível ainda.</Text>
          </View>}
        </ScrollView>}
  </SafeAreaView>;
}
