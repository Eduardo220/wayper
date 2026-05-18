import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import ViewShot from "react-native-view-shot";
import { auth, db, storage } from "../firebaseConfig";
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import MedalsWidget from "../components/MedalsWidget";
import { WayperTheme } from "../theme/wayperTheme";
import {
  DEFAULT_PROFILE,
  fetchRemoteProfile,
  loadProfile,
  saveProfile,
} from "../services/profile/profileService";
import { saveTempImageAsync } from "../utils/fileSystemLegacy";
import { formatPaceFromSeconds } from "../utils/pace";
import { sharePngFile } from "../utils/shareImage";

const DEFAULT_AVATAR = "https://i.pravatar.cc/300?u=wayper_default_profile";
const WAYPER_GREEN = WayperTheme.colors.primary;
const SHARE_CAPTURE_OPTIONS = {
  format: "png",
  quality: 1,
  result: "tmpfile",
};

async function requestImageLibraryPermission() {
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === "granted";
  } catch (error) {
    console.warn("[Profile] image permission failed", error);
    return false;
  }
}

async function uploadImageToFirebase(uri, storagePath) {
  if (!uri) throw new Error("missing_image_uri");
  const response = await fetch(uri);
  const blob = await response.blob();
  const ref = storageRef(storage, storagePath);
  const snap = await uploadBytes(ref, blob, { contentType: blob.type || "image/jpeg" });
  return getDownloadURL(snap.ref);
}

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const formatDate = (value) => {
  if (!value) return "--";
  try {
    const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "--";
  }
};

const formatKm = (meters = 0) => (safeNumber(meters) / 1000).toFixed(2);

const formatArea = (m2 = 0) => {
  const area = safeNumber(m2);
  const km2 = area / 1_000_000;
  return km2 >= 1 ? `${km2.toFixed(2)} km2` : `${Math.round(area)} m2`;
};

const formatDuration = (seconds = 0) => {
  const total = Math.max(0, Math.round(safeNumber(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
};

const formatPace = (secondsPerKm) => {
  const formatted = formatPaceFromSeconds(secondsPerKm);
  return formatted === "--:--" ? formatted : `${formatted}/km`;
};

export default function ProfileScreen() {
  const [profile, setProfile] = useState(null);
  const [userDoc, setUserDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUri, setAvatarUri] = useState(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const mountedRef = useRef(true);
  const unsubscribeRef = useRef(null);
  const profileShareRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const localProfile = await loadProfile();
      if (mountedRef.current) setProfile(localProfile);

      const current = auth.currentUser;
      if (!current) {
        if (mountedRef.current) {
          setUserDoc(null);
          setName("");
          setBio("");
          setAvatarUri(null);
          setIsPrivate(false);
        }
        return;
      }

      const snap = await getDoc(doc(db, "users", current.uid));
      if (snap.exists() && mountedRef.current) {
        const data = snap.data();
        setUserDoc(data);
        setName(data.name || "");
        setBio(data.bio || "");
        setAvatarUri(data.avatar || null);
        setIsPrivate(!!data.isPrivate || data.profileVisibility === "private");
      }
    } catch (error) {
      console.warn("[Profile] loadAll failed", error);
      Alert.alert("Erro", "Falha ao carregar perfil.");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const uid = auth.currentUser?.uid;

    if (uid) {
      unsubscribeRef.current = onSnapshot(doc(db, "users", uid), async (snap) => {
        if (!mountedRef.current || !snap.exists()) return;
        const data = snap.data();
        setUserDoc(data);
        setName(data.name || "");
        setBio(data.bio || "");
        setAvatarUri(data.avatar || null);
        setIsPrivate(!!data.isPrivate || data.profileVisibility === "private");

        const localProfile = await loadProfile();
        if (mountedRef.current) setProfile(localProfile);
      });
    }

    loadAll();

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        speed: 16,
        bounciness: 7,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      mountedRef.current = false;
      try {
        unsubscribeRef.current?.();
      } catch {}
    };
  }, [fadeAnim, loadAll, slideAnim]);

  const displayAvatar = useMemo(() => avatarUri || userDoc?.avatar || DEFAULT_AVATAR, [avatarUri, userDoc]);

  const stats = useMemo(() => {
    const p = profile || DEFAULT_PROFILE;
    const xp = safeNumber(p.xp);
    const nextLevelXp = Math.max(1, safeNumber(p.nextLevelXp, DEFAULT_PROFILE.nextLevelXp));
    const progressPct = Math.min(100, Math.max(0, Math.round((xp / nextLevelXp) * 100)));

    return {
      level: safeNumber(p.level, 1),
      xp,
      nextLevelXp,
      progressPct,
      totalDistance: safeNumber(p.totalDistance),
      totalArea: safeNumber(p.totalArea),
      totalRuns: safeNumber(p.totalRuns),
      totalZones: safeNumber(p.totalZones),
      totalTime: safeNumber(p.totalTime),
      longestRun: safeNumber(p.longestRun),
      largestZone: safeNumber(p.largestZone),
      bestPace: p.bestPace,
      weeklyPoints: safeNumber(p.weeklyPoints),
      monthlyPoints: safeNumber(p.monthlyPoints),
      globalPoints: safeNumber(p.globalPoints),
      lastUpdate: p.lastUpdate || null,
    };
  }, [profile]);

  const profileName = userDoc?.name || profile?.displayName || "Usuario";
  const username = userDoc?.username || auth.currentUser?.email?.split("@")[0] || "wayper";
  const privacyLabel = isPrivate ? "Privado" : "Publico";

  const pickImage = useCallback(async () => {
    try {
      const ok = await requestImageLibraryPermission();
      if (!ok) {
        Alert.alert("Permissao negada", "Permita acesso as imagens para trocar o avatar.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setAvatarUri(result.assets[0].uri);
      }
    } catch (error) {
      console.warn("[Profile] pickImage failed", error);
      Alert.alert("Erro", "Nao foi possivel selecionar a imagem.");
    }
  }, []);

  const saveChanges = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Nome invalido", "Preencha seu nome antes de salvar.");
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert("Erro", "Usuario nao autenticado.");
      return;
    }

    setSaving(true);
    try {
      let remoteAvatarUrl = avatarUri || userDoc?.avatar || DEFAULT_AVATAR;
      const isRemoteAvatar = /^https?:\/\//i.test(remoteAvatarUrl);

      if (avatarUri && !isRemoteAvatar) {
        try {
          remoteAvatarUrl = await uploadImageToFirebase(avatarUri, `avatars/${uid}_${Date.now()}.jpg`);
        } catch (error) {
          console.warn("[Profile] avatar upload failed", error);
          Alert.alert("Aviso", "Nao consegui enviar o avatar. O restante do perfil sera salvo.");
        }
      }

      const patch = {
        name: trimmedName,
        bio: bio.trim(),
        avatar: remoteAvatarUrl,
        isPrivate,
        profileVisibility: isPrivate ? "private" : "public",
        updatedAt: serverTimestamp(),
      };

      setUserDoc((prev) => ({ ...(prev || {}), ...patch }));
      await updateDoc(doc(db, "users", uid), patch);

      const currentProfile = (await loadProfile()) || DEFAULT_PROFILE;
      const updatedProfile = { ...currentProfile, displayName: trimmedName };
      await saveProfile(updatedProfile);
      setProfile(updatedProfile);
      setAvatarUri(remoteAvatarUrl);
      setEditing(false);
      Alert.alert("Sucesso", "Perfil atualizado.");
    } catch (error) {
      console.error("[Profile] saveChanges failed", error);
      Alert.alert("Erro", "Falha ao salvar o perfil. Tente novamente.");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [avatarUri, bio, isPrivate, name, userDoc]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setName(userDoc?.name || profile?.displayName || "");
    setBio(userDoc?.bio || "");
    setAvatarUri(userDoc?.avatar || null);
    setIsPrivate(!!userDoc?.isPrivate || userDoc?.profileVisibility === "private");
  }, [profile, userDoc]);

  const handleSyncProfile = useCallback(async () => {
    setSyncing(true);
    try {
      const remote = await fetchRemoteProfile();
      if (remote && mountedRef.current) {
        setProfile(remote);
        Alert.alert("Sincronizado", "Perfil sincronizado com o servidor.");
      } else {
        Alert.alert("Sincronizacao", "Nenhuma alteracao remota encontrada.");
      }
    } catch (error) {
      console.warn("[Profile] sync failed", error);
      Alert.alert("Erro", "Falha ao sincronizar perfil.");
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, []);

  const handleShareProfile = useCallback(async () => {
    const summary = [
      `Wayper - ${profileName}`,
      `Nivel ${stats.level}`,
      `${formatKm(stats.totalDistance)} km corridos`,
      `${stats.totalRuns} corridas`,
      `${stats.totalZones} zonas`,
      `${formatArea(stats.totalArea)} conquistados`,
    ].join("\n");

    try {
      const target = profileShareRef.current;
      if (!target || typeof target.capture !== "function") {
        await Share.share({ title: "Meu Perfil Wayper", message: summary });
        return;
      }

      const uri = await target.capture();
      const fileUri = await saveTempImageAsync(uri, `wayper_profile_${Date.now()}.png`);
      const result = await sharePngFile(fileUri, {
        dialogTitle: "Compartilhar perfil Wayper",
        visual: "profile",
        method: "view-shot",
      });

      if (!result.ok) {
        await Share.share({ title: "Meu Perfil Wayper", message: summary });
      }
    } catch (error) {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.warn("[Profile] share failed", error);
      }
      try {
        await Share.share({ title: "Meu Perfil Wayper", message: summary });
      } catch {
        Alert.alert("Erro", "Nao foi possivel compartilhar.");
      }
    }
  }, [profileName, stats]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll({ silent: true });
  }, [loadAll]);

  const updatePrivacy = useCallback(async (value) => {
    setIsPrivate(value);
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      await updateDoc(doc(db, "users", uid), {
        isPrivate: value,
        profileVisibility: value ? "private" : "public",
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("[Profile] privacy update failed", error);
      Alert.alert("Erro", "Nao foi possivel atualizar a privacidade.");
      setIsPrivate((prev) => !prev);
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={WAYPER_GREEN} />
        <Text style={styles.loadingText}>Carregando perfil...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={WayperTheme.colors.primary}
          colors={[WayperTheme.colors.primary]}
        />
      }
    >
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <LinearGradient
          colors={["rgba(0,230,118,0.18)", "rgba(56,217,255,0.08)", "rgba(11,20,29,0.92)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroGlow} />
          <View style={styles.heroTop}>
            <TouchableOpacity activeOpacity={editing ? 0.78 : 1} onPress={editing ? pickImage : undefined} style={styles.avatarShell}>
              <Image source={{ uri: displayAvatar }} style={styles.avatar} />
              <View style={styles.avatarRing} />
              {editing ? (
                <View style={styles.avatarEditBadge}>
                  <Ionicons name="camera-outline" size={16} color={WayperTheme.colors.textInverse} />
                </View>
              ) : null}
            </TouchableOpacity>

            <View style={styles.identity}>
              <Text style={styles.heroEyebrow}>Meu perfil</Text>
              {editing ? (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Seu nome"
                  placeholderTextColor={WayperTheme.colors.textSubtle}
                  style={styles.nameInput}
                />
              ) : (
                <Text style={styles.name} numberOfLines={1}>{profileName}</Text>
              )}
              <View style={styles.usernameRow}>
                <Text style={styles.username}>@{username}</Text>
                <View style={styles.privacyPill}>
                  <Ionicons name={isPrivate ? "lock-closed-outline" : "earth-outline"} size={13} color={WayperTheme.colors.primary} />
                  <Text style={styles.privacyPillText}>{privacyLabel}</Text>
                </View>
              </View>
            </View>
          </View>

          {editing ? (
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Conte um pouco sobre voce"
              placeholderTextColor={WayperTheme.colors.textSubtle}
              multiline
              style={styles.bioInput}
            />
          ) : (
            <Text style={styles.bio}>{userDoc?.bio || "Corredor Wayper em evolucao."}</Text>
          )}

          <View style={styles.levelPanel}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelNumber}>{stats.level}</Text>
              <Text style={styles.levelLabel}>Nivel</Text>
            </View>
            <View style={styles.xpBody}>
              <View style={styles.xpHeader}>
                <Text style={styles.xpTitle}>Progresso de XP</Text>
                <Text style={styles.xpValue}>{stats.xp} / {stats.nextLevelXp}</Text>
              </View>
              <View style={styles.progressTrack}>
                <LinearGradient
                  colors={[WayperTheme.colors.primaryLight, WayperTheme.colors.primaryDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressFill, { width: `${stats.progressPct}%` }]}
                />
              </View>
              <Text style={styles.progressHint}>{stats.progressPct}% para o proximo nivel</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.quickActions}>
          <ActionButton
            icon={editing ? "checkmark-outline" : "create-outline"}
            label={editing ? "Salvar" : "Editar"}
            primary
            loading={saving}
            onPress={editing ? saveChanges : () => setEditing(true)}
          />
          {editing ? (
            <ActionButton icon="close-outline" label="Cancelar" onPress={cancelEditing} />
          ) : (
            <ActionButton icon="share-social-outline" label="Compartilhar" onPress={handleShareProfile} />
          )}
          <ActionButton icon="sync-outline" label="Sync" loading={syncing} onPress={handleSyncProfile} />
        </View>

        <View style={styles.metricsGrid}>
          <MetricCard icon="navigate-outline" label="Distancia" value={`${formatKm(stats.totalDistance)} km`} />
          <MetricCard icon="walk-outline" label="Corridas" value={String(stats.totalRuns)} />
          <MetricCard icon="map-outline" label="Zonas" value={String(stats.totalZones)} accent="cyan" />
          <MetricCard icon="scan-outline" label="Area" value={formatArea(stats.totalArea)} accent="cyan" />
        </View>

        <SectionCard title="Recordes" icon="trophy-outline">
          <RecordRow icon="rocket-outline" label="Maior corrida" value={`${formatKm(stats.longestRun)} km`} />
          <RecordRow icon="speedometer-outline" label="Melhor pace" value={formatPace(stats.bestPace)} />
          <RecordRow icon="map-outline" label="Maior zona" value={formatArea(stats.largestZone)} accent="cyan" />
          <RecordRow icon="time-outline" label="Tempo total" value={formatDuration(stats.totalTime)} />
        </SectionCard>

        <SectionCard title="Ranking Wayper" icon="podium-outline">
          <View style={styles.pointsRow}>
            <PointPill label="Semana" value={stats.weeklyPoints} />
            <PointPill label="Mes" value={stats.monthlyPoints} />
            <PointPill label="Global" value={stats.globalPoints} accent="cyan" />
          </View>
        </SectionCard>

        <SectionCard title="Cartao para compartilhar" icon="image-outline">
          <ViewShot ref={profileShareRef} options={SHARE_CAPTURE_OPTIONS} style={styles.shareCard}>
            <LinearGradient
              colors={["rgba(0,230,118,0.24)", "rgba(56,217,255,0.10)", WayperTheme.colors.background]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.shareGradient}
            >
              <View style={styles.shareTopRow}>
                <View style={styles.shareAvatarWrap}>
                  <Image source={{ uri: displayAvatar }} style={styles.shareAvatar} />
                </View>
                <View style={styles.shareIdentity}>
                  <Text style={styles.shareBrand}>Wayper</Text>
                  <Text style={styles.shareName} numberOfLines={1}>{profileName}</Text>
                  <Text style={styles.shareUsername}>@{username}</Text>
                </View>
                <View style={styles.shareLevel}>
                  <Text style={styles.shareLevelNumber}>{stats.level}</Text>
                  <Text style={styles.shareLevelLabel}>Nivel</Text>
                </View>
              </View>

              <View style={styles.shareProgressWrap}>
                <View style={styles.shareProgressHeader}>
                  <Text style={styles.shareProgressLabel}>XP</Text>
                  <Text style={styles.shareProgressValue}>{stats.xp} / {stats.nextLevelXp}</Text>
                </View>
                <View style={styles.shareProgressTrack}>
                  <LinearGradient
                    colors={[WayperTheme.colors.primaryLight, WayperTheme.colors.primaryDark]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.shareProgressFill, { width: `${stats.progressPct}%` }]}
                  />
                </View>
              </View>

              <View style={styles.shareStatsGrid}>
                <ShareStat label="Km" value={formatKm(stats.totalDistance)} />
                <ShareStat label="Corridas" value={stats.totalRuns} />
                <ShareStat label="Zonas" value={stats.totalZones} accent="cyan" />
                <ShareStat label="Area" value={formatArea(stats.totalArea)} accent="cyan" />
              </View>

              <View style={styles.shareFooter}>
                <Ionicons name="flash" size={15} color={WayperTheme.colors.primary} />
                <Text style={styles.shareFooterText}>wayper.run</Text>
              </View>
            </LinearGradient>
          </ViewShot>

          <TouchableOpacity activeOpacity={0.86} style={styles.shareProfileButton} onPress={handleShareProfile}>
            <Ionicons name="share-social-outline" size={19} color={WayperTheme.colors.textInverse} />
            <Text style={styles.shareProfileButtonText}>Compartilhar perfil em PNG</Text>
          </TouchableOpacity>
        </SectionCard>

        <SectionCard title="Privacidade" icon="shield-checkmark-outline">
          <View style={styles.privacyRow}>
            <View style={styles.privacyTextWrap}>
              <Text style={styles.privacyTitle}>Perfil privado</Text>
              <Text style={styles.privacyText}>
                {isPrivate ? "Apenas seguidores veem detalhes e atividades." : "Perfil visivel no ranking e feed."}
              </Text>
            </View>
            <Switch
              value={isPrivate}
              onValueChange={updatePrivacy}
              trackColor={{ false: WayperTheme.colors.surfaceSoft, true: WayperTheme.colors.primary }}
              thumbColor={WayperTheme.colors.text}
            />
          </View>
          <InfoLine label="Email" value={auth.currentUser?.email || "--"} />
          <InfoLine label="Ultima atualizacao" value={formatDate(stats.lastUpdate)} />
        </SectionCard>

        <SectionCard title="Medalhas" icon="medal-outline">
          <MedalsWidget user={userDoc || {}} compact={false} onAward={() => {}} autoSaveToFirestore />
        </SectionCard>
      </Animated.View>
    </ScrollView>
  );
}

function ActionButton({ icon, label, onPress, primary = false, loading = false }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={loading ? undefined : onPress}
      style={[styles.actionButton, primary && styles.actionButtonPrimary]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={primary ? WayperTheme.colors.textInverse : WayperTheme.colors.primary} />
      ) : (
        <Ionicons name={icon} size={18} color={primary ? WayperTheme.colors.textInverse : WayperTheme.colors.primary} />
      )}
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </TouchableOpacity>
  );
}

function MetricCard({ icon, label, value, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={[styles.metricCard, accent === "cyan" && styles.metricCardCyan]}>
      <View style={[styles.metricIcon, { backgroundColor: accent === "cyan" ? WayperTheme.colors.cyanSoft : WayperTheme.colors.primarySoft }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SectionCard({ title, icon, children }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={20} color={WayperTheme.colors.primary} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function RecordRow({ icon, label, value, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={styles.recordRow}>
      <View style={[styles.recordIcon, { borderColor: accent === "cyan" ? WayperTheme.colors.cyanBorder : WayperTheme.colors.primaryBorder }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.recordLabel}>{label}</Text>
      <Text style={[styles.recordValue, { color }]}>{value}</Text>
    </View>
  );
}

function PointPill({ label, value, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={styles.pointPill}>
      <Text style={[styles.pointValue, { color }]}>{Math.round(safeNumber(value))}</Text>
      <Text style={styles.pointLabel}>{label}</Text>
    </View>
  );
}

function ShareStat({ label, value, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={styles.shareStat}>
      <Text style={[styles.shareStatValue, { color }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.shareStatLabel}>{label}</Text>
    </View>
  );
}

function InfoLine({ label, value }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
  content: {
    paddingBottom: 46,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.background,
  },
  loadingText: {
    marginTop: WayperTheme.spacing.md,
    color: WayperTheme.colors.textMuted,
    fontWeight: "700",
  },
  hero: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.xl,
    borderRadius: WayperTheme.radius.xxl,
    padding: WayperTheme.spacing.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  heroGlow: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    right: -54,
    top: -62,
    backgroundColor: WayperTheme.colors.primarySoft,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarShell: {
    width: 104,
    height: 104,
    borderRadius: 52,
    marginRight: WayperTheme.spacing.lg,
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: 52,
    backgroundColor: WayperTheme.colors.surfaceSoft,
  },
  avatarRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 52,
    borderWidth: 2,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  avatarEditBadge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 2,
    borderColor: WayperTheme.colors.surfaceElevated,
  },
  identity: {
    flex: 1,
  },
  heroEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  name: {
    marginTop: WayperTheme.spacing.xs,
    color: WayperTheme.colors.text,
    fontSize: 27,
    fontWeight: "900",
  },
  nameInput: {
    minHeight: 48,
    marginTop: WayperTheme.spacing.xs,
    paddingHorizontal: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.lg,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    color: WayperTheme.colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  usernameRow: {
    marginTop: WayperTheme.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.sm,
  },
  username: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "800",
  },
  privacyPill: {
    minHeight: 28,
    paddingHorizontal: WayperTheme.spacing.sm,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.xs,
  },
  privacyPillText: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  bio: {
    marginTop: WayperTheme.spacing.lg,
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  bioInput: {
    minHeight: 92,
    marginTop: WayperTheme.spacing.lg,
    padding: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "700",
    textAlignVertical: "top",
  },
  levelPanel: {
    marginTop: WayperTheme.spacing.xl,
    minHeight: 106,
    borderRadius: WayperTheme.radius.xl,
    padding: WayperTheme.spacing.lg,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
  },
  levelBadge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    marginRight: WayperTheme.spacing.lg,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    ...WayperTheme.shadows.greenGlow,
  },
  levelNumber: {
    color: WayperTheme.colors.textInverse,
    fontSize: 25,
    fontWeight: "900",
  },
  levelLabel: {
    color: WayperTheme.colors.textInverse,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  xpBody: {
    flex: 1,
  },
  xpHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
  },
  xpTitle: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  xpValue: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  progressTrack: {
    height: 12,
    marginTop: WayperTheme.spacing.sm,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: WayperTheme.radius.pill,
  },
  progressHint: {
    marginTop: WayperTheme.spacing.sm,
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
  },
  quickActions: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    paddingHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
  },
  actionButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.xs,
  },
  actionButtonPrimary: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
    ...WayperTheme.shadows.greenGlow,
  },
  actionText: {
    color: WayperTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  actionTextPrimary: {
    color: WayperTheme.colors.textInverse,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.md,
    paddingHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
  },
  metricCard: {
    width: "48%",
    minHeight: 126,
    borderRadius: WayperTheme.radius.xl,
    padding: WayperTheme.spacing.lg,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    ...WayperTheme.shadows.card,
  },
  metricCardCyan: {
    borderColor: WayperTheme.colors.cyanBorder,
  },
  metricIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: WayperTheme.spacing.md,
  },
  metricLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricValue: {
    marginTop: WayperTheme.spacing.xs,
    fontSize: 21,
    fontWeight: "900",
  },
  sectionCard: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
    padding: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    ...WayperTheme.shadows.card,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: WayperTheme.spacing.lg,
  },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  sectionTitle: {
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  recordRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: WayperTheme.colors.border,
  },
  recordIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    marginRight: WayperTheme.spacing.md,
  },
  recordLabel: {
    flex: 1,
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "800",
  },
  recordValue: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  pointsRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
  },
  pointPill: {
    flex: 1,
    minHeight: 82,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: WayperTheme.spacing.md,
  },
  pointValue: {
    fontSize: 22,
    fontWeight: "900",
  },
  pointLabel: {
    marginTop: WayperTheme.spacing.xs,
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
  },
  shareCard: {
    width: "100%",
    borderRadius: WayperTheme.radius.xxl,
    overflow: "hidden",
    backgroundColor: WayperTheme.colors.background,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  shareGradient: {
    padding: WayperTheme.spacing.lg,
  },
  shareTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  shareAvatarWrap: {
    width: 78,
    height: 78,
    borderRadius: 39,
    padding: 3,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  shareAvatar: {
    width: "100%",
    height: "100%",
    borderRadius: 36,
    backgroundColor: WayperTheme.colors.surfaceSoft,
  },
  shareIdentity: {
    flex: 1,
  },
  shareBrand: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  shareName: {
    marginTop: 2,
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  shareUsername: {
    marginTop: 3,
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  shareLevel: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
  },
  shareLevelNumber: {
    color: WayperTheme.colors.textInverse,
    fontSize: 22,
    fontWeight: "900",
  },
  shareLevelLabel: {
    color: WayperTheme.colors.textInverse,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  shareProgressWrap: {
    marginTop: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    padding: WayperTheme.spacing.md,
  },
  shareProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shareProgressLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  shareProgressValue: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  shareProgressTrack: {
    height: 10,
    marginTop: WayperTheme.spacing.sm,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    overflow: "hidden",
  },
  shareProgressFill: {
    height: "100%",
    borderRadius: WayperTheme.radius.pill,
  },
  shareStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.lg,
  },
  shareStat: {
    width: "48%",
    minHeight: 64,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.md,
  },
  shareStatValue: {
    fontSize: 19,
    fontWeight: "900",
  },
  shareStatLabel: {
    marginTop: 2,
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  shareFooter: {
    marginTop: WayperTheme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WayperTheme.spacing.xs,
  },
  shareFooterText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  shareProfileButton: {
    minHeight: 54,
    marginTop: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    ...WayperTheme.shadows.greenGlow,
  },
  shareProfileButtonText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 15,
    fontWeight: "900",
  },
  privacyRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 78,
  },
  privacyTextWrap: {
    flex: 1,
    paddingRight: WayperTheme.spacing.lg,
  },
  privacyTitle: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  privacyText: {
    marginTop: WayperTheme.spacing.xs,
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  infoLine: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: WayperTheme.colors.border,
  },
  infoLabel: {
    flex: 1,
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  infoValue: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "right",
  },
});
