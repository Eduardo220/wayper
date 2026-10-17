import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../../firebaseConfig";
import { WayperTheme } from "../../theme/wayperTheme";
import { normalizeProfileUserId, PROFILE_TABS } from "../../utils/profileModel";
import { subscribeProfileIdentity, loadProfileTab } from "../../repositories/profileScreenAdapter";
import ProfileHeader, { ProfileButton } from "./ProfileHeader";
import { ProfileAchievements, ProfileNotice, ProfileRuns, ProfileTerritory } from "./ProfilePanels";
import ProfileShareSheet from "./ProfileShareSheet";
import styles from "./Profile.styles";

export default function ProfileScreen({ route, navigation }) {
  const identity = normalizeProfileUserId(route?.params, auth.currentUser?.uid);
  const { userId, own, invalid } = identity;
  const preview = typeof __DEV__ !== "undefined" && __DEV__ && route?.params?.preview === true;
  const [state, setState] = useState({ userId: null, profile: null, loading: true });
  const [tab, setTab] = useState("runs");
  const [tabState, setTabState] = useState({ userId: null, tab: null, items: [], loading: true });
  const [retry, setRetry] = useState(0);
  const [limit, setLimit] = useState(12);
  const [share, setShare] = useState(false);
  const generation = useRef(0);
  const loadingMore = useRef(false);
  const current = state.userId === userId ? state : { loading: true };
  const profile = current.profile;
  const data = tabState.userId === userId && tabState.tab === tab ? tabState : { loading: true, items: [] };

  useFocusEffect(useCallback(() => {
    let active = true;
    setShare(false);
    setState({ userId, loading: true, profile: null });
    const unsubscribe = subscribeProfileIdentity({ userId, own, invalid, preview }, (result) => {
      if (!active) return;
      if (!result.profile || result.profile.restricted) setShare(false);
      setState({ ...result, userId, loading: false });
    }, preview ? require("../ranking/__fixtures__/playerProfilePreviewData").playerProfilePreviewData(userId) : null);
    return () => { active = false; unsubscribe(); };
  }, [userId, own, invalid, preview, retry]));

  useEffect(() => {
    let active = true;
    generation.current += 1;
    loadingMore.current = false;
    setLimit(12);
    setTabState({ userId, tab, items: [], loading: true });
    if (!profile) return () => { active = false; };
    loadProfileTab(profile, tab, auth.currentUser?.uid).then((result) => {
      if (active) setTabState({ ...result, userId, tab, loading: false });
    }).catch((error) => { if (active) setTabState({ userId, tab, items: [], error, loading: false }); });
    return () => { active = false; generation.current += 1; };
  }, [userId, tab, profile]);

  async function moreRuns() {
    if (limit < data.items.length) { setLimit((n) => n + 12); return; }
    if (!data.nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    const request = generation.current;
    try {
      const page = await loadProfileTab(profile, "runs", auth.currentUser?.uid, data.nextCursor);
      if (request !== generation.current) return;
      setTabState((previous) => ({ ...previous, ...page, items: [...previous.items, ...page.items] }));
      setLimit((n) => n + 12);
    } catch {
      if (request === generation.current) Alert.alert("Não foi possível carregar mais corridas", "Tente novamente.");
    } finally { if (request === generation.current) loadingMore.current = false; }
  }

  function manage(editing = false) {
    navigation.navigate("ProfileManagement", { editing });
  }
  function menu() {
    if (own) Alert.alert("Meu perfil", "Gerenciar dados e preferências do perfil.", [
      { text: "Cancelar", style: "cancel" }, { text: "Gerenciar perfil", onPress: () => manage() },
    ]);
    else Alert.alert("Perfil", "A Wayper usa amizades bilaterais.", [
      { text: "Fechar", style: "cancel" }, { text: "Abrir Amigos", onPress: () => navigation.navigate("Amigos") },
    ]);
  }
  return <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
    {current.loading ? <View style={styles.center}><ActivityIndicator color={WayperTheme.colors.primary} /><Text style={styles.text}>Carregando perfil…</Text></View>
      : !profile ? <View style={styles.center}><Text style={styles.title}>Perfil indisponível</Text><Text style={styles.text}>{invalid ? "Identificador de perfil inválido." : "Não foi possível obter dados reais deste perfil."}</Text>
        {navigation.canGoBack() ? <ProfileButton label="Voltar" onPress={() => navigation.goBack()} /> : null}
        {!invalid ? <ProfileButton label="Tentar novamente" onPress={() => setRetry((n) => n + 1)} /> : null}</View>
        : <>
          <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRetry((n) => n + 1)} tintColor={WayperTheme.colors.primary} />}>
            <ProfileHeader profile={profile} onBack={route.params?.profileEntry === "Perfil" && own ? null : () => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Perfil")}
              onOpenMenu={() => navigation.getParent()?.openDrawer?.()} onMenu={menu} onEdit={() => manage(true)} onShare={() => setShare(true)} onFriends={() => navigation.navigate("Amigos")} />
            {profile.restricted ? <View style={styles.body}><ProfileNotice title="Perfil privado" text="Este atleta mantém seus detalhes e atividades privados." /></View>
              : <>
                <View style={styles.tabs}>{PROFILE_TABS.map(([key, label, icon]) => <Pressable key={key} accessibilityRole="tab"
                  accessibilityLabel={label} accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]}>
                  <Ionicons name={icon} size={20} color={tab === key ? WayperTheme.colors.primary : WayperTheme.colors.textMuted} />
                  <Text style={[styles.tabLabel, tab === key && styles.activeText]}>{label.toLocaleUpperCase("pt-BR")}</Text>
                </Pressable>)}</View>
                <View style={styles.body}>
                  {data.loading ? <ActivityIndicator color={WayperTheme.colors.primary} accessibilityLabel={`Carregando ${tab}`} />
                    : <>
                      {data.error ? <><Text style={styles.error}>Não foi possível atualizar esta seção. Os dados disponíveis foram preservados.</Text><ProfileButton label="Tentar novamente" onPress={() => setRetry((n) => n + 1)} /></> : null}
                      {tab === "runs" ? <ProfileRuns items={data.items.slice(0, limit)} hasMore={limit < data.items.length || !!data.nextCursor} onMore={moreRuns}
                        onOpen={(run) => navigation.navigate("ActivityDetail", { run, readOnly: !own })} /> : null}
                      {tab === "territory" ? <ProfileTerritory profile={profile} items={data.items} events={data.events} onMap={() => navigation.navigate("Mapa", { focusUserId: userId })} /> : null}
                      {tab === "achievements" ? <ProfileAchievements profile={profile} items={data.items} /> : null}
                    </>}
                </View>
              </>}
          </ScrollView>
          {share && !profile.restricted && !profile.preview ? <ProfileShareSheet profile={profile} visible onClose={() => setShare(false)} /> : null}
        </>}
  </SafeAreaView>;
}
