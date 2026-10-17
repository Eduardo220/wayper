import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../theme/wayperTheme";
import { loadCurrentProfile, updateCurrentUserProfile } from "../repositories/userProfileRepository";
import { openAppSettings, requestImageLibraryPermission } from "../services/permissions";
import HomeAvatar from "../components/Home/HomeAvatar";
import { WPBottomSheet } from "../components/ui/WPBottomSheet";
import { ProfileButton } from "./profile/ProfileHeader";

const { colors: c, radius: r, spacing: s } = WayperTheme;

function EditField({ icon, label, value, onChangeText, limit, multiline }) {
  return <View style={styles.card}>
    <View style={styles.symbol}><Ionicons name={icon} size={24} color={c.primary} /></View>
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} maxLength={limit}
        multiline={multiline} textAlignVertical={multiline ? "top" : "center"} style={[styles.input, multiline && styles.bio]}
        placeholderTextColor={c.textMuted} selectionColor={c.primary} />
      <Text style={styles.counter}>{value.length}/{limit}</Text>
    </View>
  </View>;
}

function EditAction({ icon, label, value, onPress, disabled }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} onPress={onPress} style={styles.card}>
    <View style={styles.symbol}><Ionicons name={icon} size={24} color={c.primary} /></View>
    <View style={styles.field}><Text style={styles.label}>{label}</Text>{value ? <Text style={styles.muted}>{value}</Text> : null}</View>
    <Ionicons name="chevron-forward" size={22} color={c.textMuted} />
  </Pressable>;
}

export default function ProfileScreen({ navigation }) {
  const [loaded, setLoaded] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState(null);
  const busy = useRef(false);
  const active = useRef(true);
  const insets = useSafeAreaInsets();
  const [failedCover, setFailedCover] = useState(null);

  async function load() {
    setError(false);
    try {
      const result = await loadCurrentProfile();
      if (!active.current) return;
      const data = { ...result.data?.profile, ...result.data?.userDoc };
      if (!result.data?.profile && !result.data?.userDoc) throw new Error("missing_profile");
      setLoaded(data);
      setDraft({ name: data.name ?? data.displayName ?? "", city: data.city ?? "", bio: data.bio ?? "",
        avatar: data.avatar ?? data.photoURL ?? null, cover: data.cover ?? null, isPrivate: data.isPrivate === true || data.profileVisibility === "private" });
    } catch { if (active.current) setError(true); }
  }

  useEffect(() => {
    active.current = true;
    load();
    return () => { active.current = false; };
  }, []);

  function change(key, value) { setDraft((previous) => ({ ...previous, [key]: value })); }

  async function pickPhoto(camera, target = "avatar") {
    setSheet(null);
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await requestImageLibraryPermission({ force: true });
      if (!permission.granted) {
        Alert.alert("Permissão para foto", camera ? "Permita acesso à câmera para tirar uma foto." : "Permita acesso às fotos para escolher uma imagem.",
          permission.canAskAgain === false ? [{ text: "Cancelar", style: "cancel" }, { text: "Abrir configurações", onPress: openAppSettings }] : [{ text: "OK" }]);
        return;
      }
      const picker = camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const result = await picker({ mediaTypes: ["images"], allowsEditing: true, aspect: target === "cover" ? [16, 9] : [1, 1], quality: 0.85 });
      if (active.current && !result.canceled && result.assets?.[0]?.uri) change(target, result.assets[0].uri);
    } catch { Alert.alert("Não foi possível abrir a foto", "Tente novamente."); }
  }

  async function save() {
    if (busy.current) return;
    if (!draft.name.trim()) { Alert.alert("Nome inválido", "Preencha seu nome antes de salvar."); return; }
    busy.current = true;
    setSaving(true);
    try {
      const patch = {};
      if (draft.name.trim() !== (loaded.name ?? loaded.displayName ?? "")) patch.name = draft.name.trim();
      if (draft.city.trim() !== (loaded.city ?? "")) patch.city = draft.city.trim();
      if (draft.bio !== (loaded.bio ?? "")) patch.bio = draft.bio;
      if (draft.avatar !== (loaded.avatar ?? loaded.photoURL ?? null)) patch.avatarLocalUri = draft.avatar;
      if (draft.cover !== (loaded.cover ?? null)) patch.coverLocalUri = draft.cover;
      const wasPrivate = loaded.isPrivate === true || loaded.profileVisibility === "private";
      if (draft.isPrivate !== wasPrivate) {
        patch.isPrivate = draft.isPrivate;
        patch.profileVisibility = draft.isPrivate ? "private" : "public";
      }
      if (Object.keys(patch).length) await updateCurrentUserProfile(patch);
      if (active.current) navigation.goBack();
    } catch { Alert.alert("Não foi possível salvar", "Suas alterações continuam aqui. Tente novamente."); }
    finally { busy.current = false; if (active.current) setSaving(false); }
  }

  const level = loaded?.level ?? "—";
  const xp = loaded?.xp;
  const nextXp = loaded?.nextLevelXp;
  const progress = xp != null && nextXp > 0 ? Math.min(100, Math.max(0, xp / nextXp * 100)) : 0;
  const close = () => { if (!busy.current) navigation.goBack(); };
  return <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Image source={draft?.cover && failedCover !== draft.cover ? { uri: draft.cover } : require("../../assets/profile-cover.png")}
            onError={() => setFailedCover(draft?.cover)} style={styles.cover} resizeMode="cover" accessible={false} />
          <LinearGradient colors={["rgba(3,8,11,0.12)", "rgba(3,8,11,0.45)", c.background]} style={styles.cover} />
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Voltar" accessibilityState={{ disabled: saving }} disabled={saving} onPress={close} style={styles.back}>
              <Ionicons name="arrow-back" size={26} color={c.text} />
            </Pressable><Text style={styles.title}>Gerenciar perfil</Text>
          </View>
          {draft ? <Pressable accessibilityRole="button" accessibilityLabel="Alterar capa" disabled={saving} accessibilityState={{ disabled: saving }}
            onPress={() => setSheet("cover")} style={styles.coverAction}>
            <Ionicons name="image-outline" size={20} color={c.text} /><Text style={styles.coverActionText}>Alterar capa</Text>
          </Pressable> : null}
          {draft ? <View style={styles.avatarRow}>
            <View><HomeAvatar key={draft.avatar || "empty"} uri={draft.avatar} name={draft.name} size={88} style={styles.avatar} />
              <View style={styles.badge}><Text style={styles.level}>{level}</Text></View></View>
          </View> : null}
        </View>
        {error ? <View style={styles.body}><Text style={styles.muted}>Não foi possível carregar seu perfil.</Text><ProfileButton style={styles.optionButton} label="Tentar novamente" onPress={load} /></View>
          : !draft ? <ActivityIndicator color={c.primary} accessibilityLabel="Carregando perfil" />
            : <View style={styles.body} pointerEvents={saving ? "none" : "auto"}>
              <EditAction icon="camera-outline" label="Alterar foto" onPress={() => setSheet("photo")} disabled={saving} />
              <EditField icon="person-outline" label="Nome de exibição" value={draft.name} onChangeText={(value) => change("name", value)} limit={50} />
              <View style={styles.card}>
                <View style={styles.symbol}><Ionicons name="at" size={24} color={c.primary} /></View>
                <View style={styles.field}><Text style={styles.label}>Username</Text>
                  <View style={styles.readonly}><Text style={styles.muted}>{loaded.username ? `@${loaded.username}` : "—"}</Text><Ionicons name="lock-closed-outline" size={20} color={c.textMuted} /></View>
                  <Text style={styles.help}>Username é único e não pode ser alterado.</Text></View>
              </View>
              <EditField icon="location-outline" label="Cidade" value={draft.city} onChangeText={(value) => change("city", value)} limit={50} />
              <EditField icon="document-text-outline" label="Bio" value={draft.bio} onChangeText={(value) => change("bio", value)} limit={160} multiline />
              <EditAction icon="shield-checkmark-outline" label="Visibilidade do perfil" value={draft.isPrivate ? "Privado" : "Público"} onPress={() => setSheet("visibility")} disabled={saving} />
              <View style={styles.card}>
                <View style={styles.symbol}><Ionicons name="stats-chart" size={24} color={c.primary} /></View>
                <View style={styles.field}><Text style={styles.label}>Nível atual · {level}</Text>
                  <Text style={styles.muted}>{xp == null || nextXp == null ? "XP indisponível" : `${xp} / ${nextXp} XP`}</Text>
                  <View accessibilityRole="progressbar" accessibilityLabel="Progresso de XP" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }} style={styles.track}>
                    <View style={[styles.fill, { width: `${progress}%` }]} /></View></View>
              </View>
              <ProfileButton style={styles.optionButton} label={saving ? "Salvando…" : "Salvar alterações"} icon="checkmark" primary onPress={save} disabled={saving} />
              <ProfileButton style={styles.optionButton} label="Cancelar" icon="close" onPress={close} disabled={saving} />
            </View>}
      </ScrollView>
    </KeyboardAvoidingView>
    <WPBottomSheet visible={!!sheet} onClose={() => setSheet(null)} contentStyle={{ paddingBottom: Math.max(insets.bottom, s.lg) }}>
      <View style={styles.options}><Text style={styles.title}>{sheet === "photo" ? "Alterar foto" : sheet === "cover" ? "Alterar capa" : "Visibilidade do perfil"}</Text>
        {sheet === "photo" || sheet === "cover" ? <><ProfileButton style={styles.optionButton} label="Tirar foto" icon="camera-outline" onPress={() => pickPhoto(true, sheet === "cover" ? "cover" : "avatar")} />
          <ProfileButton style={styles.optionButton} label="Escolher da galeria" icon="image-outline" onPress={() => pickPhoto(false, sheet === "cover" ? "cover" : "avatar")} /></>
          : <><ProfileButton style={styles.optionButton} label="Público" icon="globe-outline" primary={!draft?.isPrivate} onPress={() => { change("isPrivate", false); setSheet(null); }} />
            <ProfileButton style={styles.optionButton} label="Privado" icon="lock-closed-outline" primary={draft?.isPrivate} onPress={() => { change("isPrivate", true); setSheet(null); }} /></>}
        <ProfileButton style={styles.optionButton} label="Cancelar" onPress={() => setSheet(null)} />
      </View>
    </WPBottomSheet>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  content: { paddingBottom: s.xl },
  hero: { height: 214, justifyContent: "space-between" },
  cover: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  header: { flexDirection: "row", alignItems: "center", gap: s.sm, paddingHorizontal: s.md },
  back: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  title: { ...WayperTheme.typography.title, fontSize: 22 },
  coverAction: { position: "absolute", top: 58, right: s.lg, flexDirection: "row", alignItems: "center", gap: s.sm, paddingHorizontal: s.md, minHeight: 48, borderRadius: r.pill, backgroundColor: c.blackGlass },
  coverActionText: { color: c.text, fontSize: 14, fontWeight: "600" },
  avatarRow: { paddingHorizontal: s.xl, paddingBottom: s.lg },
  avatar: { borderWidth: 2, borderColor: c.primary },
  badge: { position: "absolute", bottom: -4, left: -4, backgroundColor: c.surfaceElevated, borderWidth: 2, borderColor: c.primary, borderRadius: r.sm, paddingHorizontal: s.sm, paddingVertical: s.xs },
  level: { color: c.text, fontWeight: "800", fontSize: 18 },
  body: { paddingHorizontal: s.lg, gap: s.md },
  card: { flexDirection: "row", alignItems: "center", gap: s.md, padding: s.md, borderWidth: 1, borderColor: c.border, borderRadius: r.xl, backgroundColor: c.surface, minHeight: 72 },
  symbol: { width: 42, height: 42, borderRadius: r.pill, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  field: { flex: 1, gap: s.sm },
  label: { ...WayperTheme.typography.body, fontWeight: "600" },
  input: { color: c.text, fontSize: 15, paddingHorizontal: s.md, paddingVertical: s.sm, minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: r.sm, backgroundColor: c.background },
  bio: { minHeight: 76 },
  counter: { color: c.textMuted, fontSize: 12, textAlign: "right" },
  readonly: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 48, backgroundColor: c.surfaceElevated, borderRadius: r.sm, paddingHorizontal: s.md },
  muted: { color: c.textMuted, fontSize: 14, lineHeight: 20 },
  help: { color: c.textMuted, fontSize: 12, lineHeight: 18 },
  track: { height: 6, borderRadius: r.xs, backgroundColor: c.surfaceElevated, overflow: "hidden" },
  fill: { height: 6, backgroundColor: c.primary },
  options: { gap: s.md },
  optionButton: { flex: 0, minHeight: 48 },
});
