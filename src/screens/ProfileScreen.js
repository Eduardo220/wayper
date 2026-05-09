// src/screens/ProfileScreen.js
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
  Share,
  Switch,
} from "react-native";

import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { MotiView, MotiText } from "moti";

// Firebase (correto)
import { auth, db, storage } from "../firebaseConfig";

// Firestore
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onSnapshot } from "firebase/firestore";

// Storage
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

// Widgets & Services
import MedalsWidget from "../components/MedalsWidget";
import {
  loadProfile,
  saveProfile,
  fetchRemoteProfile,
  updateProfileStats,
  DEFAULT_PROFILE,
} from "../services/profile/profileService";

/* ---------------------- Config / Constants ---------------------- */
const LOG = (...args) => console.debug("[PROFILE]", ...args);
const DEFAULT_AVATAR = "https://i.pravatar.cc/300?u=wayper_default_profile";
const WAYPER_GREEN = "#00e676";

/* ---------------------- Small helpers ---------------------- */
async function requestImageLibraryPermission() {
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === "granted";
  } catch (e) {
    console.warn("PROFILE permission error", e);
    return false;
  }
}

async function uploadImageToFirebase(uri, storagePath) {
  try {
    if (!uri) throw new Error("No uri");
    const resp = await fetch(uri);
    const blob = await resp.blob();
    const ref = storageRef(storage, storagePath);
    const snap = await uploadBytes(ref, blob, { contentType: blob.type });
    const url = await getDownloadURL(snap.ref);
    return url;
  } catch (e) {
    console.warn("PROFILE uploadImageToFirebase error:", e);
    throw e;
  }
}

const formatDate = (ts) => {
  if (!ts) return "—";
  try {
    if (typeof ts.toDate === "function") {
      return ts.toDate().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    }
    const d = new Date(ts);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "—";
  }
};

const formatKm = (meters = 0) => (Number(meters) / 1000).toFixed(2);
const formatAreaKm2 = (m2 = 0) => {
  const km2 = Number(m2) / 1e6;
  return km2 >= 1 ? `${km2.toFixed(2)} km²` : `${Math.round(m2)} m²`;
};
const formatTimeHms = (sec = 0) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
};
const formatPace = (secPerKm) => {
  if (!secPerKm || !isFinite(secPerKm)) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

/* ---------------------- Component ---------------------- */
export default function ProfileScreen() {
  const [profile, setProfile] = useState(null); // profile from profileService
  const [userDoc, setUserDoc] = useState(null); // firestore users doc (for avatar, username, email)
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUri, setAvatarUri] = useState(null);
  const [isPrivate, setIsPrivate] = useState(false);

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const mountedRef = useRef(true);
  const firestoreListenerRef = useRef(null);


 useEffect(() => {
  mountedRef.current = true;

  const uid = auth.currentUser?.uid;
  if (!uid) {
    loadAll();
    return () => {
      mountedRef.current = false;
      firestoreListenerRef.current?.();
    };
  }

  // 🔥 LISTENER FIRESTORE EM TEMPO REAL
  const userRef = doc(db, "users", uid);

  firestoreListenerRef.current = onSnapshot(userRef, async (snap) => {
    if (!snap.exists()) return;

    const data = snap.data();
    if (!mountedRef.current) return;

    // Atualiza Firestore doc no estado
    setUserDoc(data);
    setName(data.name || "");
    setBio(data.bio || "");
    setAvatarUri(data.avatar || null);
    setIsPrivate(!!data.isPrivate || data.profileVisibility === "private");

    // 🔥 Recalcula perfil completo do profileService
    const p = await loadProfile();
    if (mountedRef.current) {
      setProfile(p);
    }
  });

  // 🔄 também carregamos uma vez ao abrir
  (async () => {
    await loadAll();
  })();

  return () => {
    mountedRef.current = false;
    firestoreListenerRef.current?.(); // remove o listener
  };
}, []);


  /* ---------------------- Load local profile + user doc  ---------------------- */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const p = await loadProfile();
      if (mountedRef.current) setProfile(p);

      // load firestore 'users' doc if logged
      const current = auth.currentUser;
      if (current) {
        const snap = await getDoc(doc(db, "users", current.uid));
        if (snap.exists()) {
          const data = snap.data();
          if (mountedRef.current) {
            setUserDoc(data);
            setName(data.name || "");
            setBio(data.bio || "");
            setAvatarUri(data.avatar || null);
            setIsPrivate(!!data.isPrivate || data.profileVisibility === "private");
          }
        } else {
          // if no user doc, still keep profile values
          setUserDoc(null);
        }
      } else {
        setUserDoc(null);
      }
    } catch (e) {
      console.warn("Profile loadAll error", e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  /* ---------------------- Pick image ---------------------- */
  const pickImage = useCallback(async () => {
    try {
      const ok = await requestImageLibraryPermission();
      if (!ok) {
        Alert.alert("Permissão negada", "Permita acesso às imagens para trocar o avatar.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (!result.canceled) {
        const uri = result.assets[0].uri;
        setAvatarUri(uri);
      }
    } catch (e) {
      console.warn("pickImage error", e);
      Alert.alert("Erro", "Não foi possível selecionar a imagem.");
    }
  }, []);

  /* ---------------------- Save profile edits (optimistic) ---------------------- */
  const saveChanges = useCallback(async () => {
    try {
      if (!name || !name.trim()) {
        Alert.alert("Nome inválido", "Preencha seu nome antes de salvar.");
        return;
      }

      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Erro", "Usuário não autenticado.");
        return;
      }

      setSaving(true);

      // optimistic update in UI
      const optimisticUserDoc = {
        ...(userDoc || {}),
        name: name.trim(),
        bio: bio.trim(),
        avatar: avatarUri || userDoc?.avatar || DEFAULT_AVATAR,
        isPrivate,
        profileVisibility: isPrivate ? "private" : "public",
      };
      setUserDoc(optimisticUserDoc);
      setEditing(false);

      // upload avatar if local uri
      let remoteAvatarUrl = optimisticUserDoc.avatar;
      if (avatarUri && !avatarUri.startsWith("https://")) {
        const path = `avatars/${uid}_${Date.now()}.jpg`;
        try {
          remoteAvatarUrl = await uploadImageToFirebase(avatarUri, path);
        } catch (uploadErr) {
          console.warn("avatar upload failed", uploadErr);
          Alert.alert("Aviso", "Não consegui enviar o avatar. Texto salvo.");
        }
      }

      // persist to Firestore users doc
      await updateDoc(doc(db, "users", uid), {
        name: name.trim(),
        bio: bio.trim(),
        avatar: remoteAvatarUrl,
        isPrivate,
        profileVisibility: isPrivate ? "private" : "public",
        updatedAt: serverTimestamp(),
      });

      // also update profile name in profileService if needed
      const currentProfile = (await loadProfile()) || DEFAULT_PROFILE;
      const updatedProfile = { ...currentProfile, displayName: name.trim() };
      await saveProfile(updatedProfile);
      setProfile(updatedProfile);

      setSaving(false);
      Alert.alert("Sucesso", "Perfil atualizado.");
    } catch (err) {
      console.error("saveChanges error:", err);
      Alert.alert("Erro", "Falha ao salvar o perfil. Tente novamente.");
      setSaving(false);
      setEditing(true);
    }
  }, [name, bio, avatarUri, userDoc, isPrivate]);

  /* ---------------------- Sync profile remote ---------------------- */
  const handleSyncProfile = useCallback(async () => {
    try {
      setSyncing(true);
      const remote = await fetchRemoteProfile();
      if (remote && mountedRef.current) {
        setProfile(remote);
        Alert.alert("Sincronizado", "Perfil sincronizado com o servidor.");
      } else {
        Alert.alert("Sincronização", "Nenhuma alteração remota encontrada.");
      }
    } catch (e) {
      console.warn("handleSyncProfile error", e);
      Alert.alert("Erro", "Falha ao sincronizar perfil.");
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, []);

  /* ---------------------- Export / Share profile ---------------------- */
  const handleExportProfile = useCallback(async () => {
    try {
      const p = (await loadProfile()) || profile || DEFAULT_PROFILE;
      const payload = {
        level: p.level,
        xp: p.xp,
        nextLevelXp: p.nextLevelXp,
        totalDistance: p.totalDistance,
        totalArea: p.totalArea,
        totalRuns: p.totalRuns,
        totalZones: p.totalZones,
        lastUpdate: p.lastUpdate,
      };
      await Share.share({ title: "Meu Perfil Wayper", message: JSON.stringify(payload, null, 2) });
    } catch (e) {
      console.warn("handleExportProfile error", e);
      Alert.alert("Erro", "Falha ao exportar perfil.");
    }
  }, [profile]);

  /* ---------------------- Derived UI values ---------------------- */
  const displayAvatar = useMemo(() => {
    if (avatarUri) return avatarUri;
    if (userDoc?.avatar) return userDoc.avatar;
    return DEFAULT_AVATAR;
  }, [avatarUri, userDoc]);

  const stats = useMemo(() => {
    const p = profile || DEFAULT_PROFILE;
    const percent = p.nextLevelXp ? Math.min(100, Math.round((p.xp / p.nextLevelXp) * 100)) : 0;
    return {
      level: p.level || 1,
      xp: p.xp || 0,
      nextLevelXp: p.nextLevelXp || 1000,
      progressPct: percent,
      totalDistance: p.totalDistance || 0,
      totalArea: p.totalArea || 0,
      totalRuns: p.totalRuns || 0,
      totalZones: p.totalZones || 0,
      longestRun: p.longestRun || 0,
      largestZone: p.largestZone || 0,
      bestPace: p.bestPace || null,
      lastUpdate: p.lastUpdate || null,
      totalTime: p.totalTime || 0,
    };
  }, [profile]);

  /* ---------------------- Quick manual award sample for testing (dev) ---------------------- */
  // Not shown in UI by default, but you can call updateProfileStats elsewhere after a run/zone is saved.

  /* ---------------------- Loading / No user handling ---------------------- */
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={WAYPER_GREEN} />
        <Text style={styles.loadingText}>Carregando perfil...</Text>
      </View>
    );
  }

  /* ---------------------- Render ---------------------- */
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={["#13161a", "#0d0f12"]} style={styles.header}>
        <TouchableOpacity onPress={editing ? pickImage : undefined} activeOpacity={editing ? 0.7 : 1}>
          <MotiView from={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", duration: 600 }}>
            <Image source={{ uri: displayAvatar }} style={styles.photo} />
          </MotiView>
        </TouchableOpacity>

        {editing ? (
          <>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Seu nome" placeholderTextColor="#666" />
            <Text style={styles.username}>@{userDoc?.username || "user"}</Text>
            <TextInput style={[styles.input, styles.bioInput]} value={bio} onChangeText={setBio} placeholder="Sua bio" placeholderTextColor="#666" multiline />
          </>
        ) : (
          <>
            <MotiText from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ delay: 200 }} style={styles.name}>
              {userDoc?.name || profile?.displayName || "Usuário"}
            </MotiText>

            <Text style={styles.username}>@{userDoc?.username || "user"}</Text>

            {userDoc?.bio ? <Text style={styles.bio}>{userDoc.bio}</Text> : null}
          </>
        )}
      </LinearGradient>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{stats.level}</Text>
          <Text style={styles.statLabel}>Nível</Text>
        </View>

        <View style={styles.statBox}>
          <Text style={styles.statValue}>{stats.totalZones}</Text>
          <Text style={styles.statLabel}>Zonas</Text>
        </View>

        <View style={styles.statBox}>
          <Text style={styles.statValue}>{formatAreaKm2(stats.totalArea)}</Text>
          <Text style={styles.statLabel}>Área</Text>
        </View>

        <View style={styles.statBox}>
          <Text style={styles.statValue}>{formatKm(stats.totalDistance)} km</Text>
          <Text style={styles.statLabel}>Km</Text>
        </View>
      </View>

      {/* XP Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Progresso</Text>

        <View style={{ marginVertical: 8 }}>
          <View style={styles.xpRow}>
            <Text style={styles.xpLabel}>XP</Text>
            <Text style={styles.xpValue}>
              {stats.xp} / {stats.nextLevelXp}
            </Text>
          </View>

          <View style={styles.progressBarBack}>
            <View style={[styles.progressBarFill, { width: `${stats.progressPct}%`, backgroundColor: WAYPER_GREEN }]} />
          </View>

          <Text style={styles.small}>Progresso para próximo nível: {stats.progressPct}%</Text>
        </View>

        <View style={styles.recordsRow}>
          <View style={styles.record}>
            <Text style={styles.recordLabel}>Melhor pace</Text>
            <Text style={styles.recordValue}>{formatPace(stats.bestPace)}</Text>
          </View>

          <View style={styles.record}>
            <Text style={styles.recordLabel}>Maior corrida</Text>
            <Text style={styles.recordValue}>{formatKm(stats.longestRun)} km</Text>
          </View>

          <View style={styles.record}>
            <Text style={styles.recordLabel}>Maior zona</Text>
            <Text style={styles.recordValue}>{formatAreaKm2(stats.largestZone)}</Text>
          </View>
        </View>

        <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <TouchableOpacity style={[styles.smallButton, { backgroundColor: "#263238" }]} onPress={handleSyncProfile} disabled={syncing}>
            {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.smallButtonText}>Sincronizar</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={[styles.smallButton, { backgroundColor: "#37474f" }]} onPress={handleExportProfile}>
            <Text style={styles.smallButtonText}>Exportar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.smallButton, { backgroundColor: WAYPER_GREEN }]}
            onPress={async () => {
              try {
                // quick share summary
                const summary = `Nível ${stats.level} • ${formatKm(stats.totalDistance)} km • ${stats.totalZones} zonas • ${formatAreaKm2(stats.totalArea)}`;
                await Share.share({ title: "Meu resumo Wayper", message: summary });
              } catch (e) {
                console.warn("share error", e);
                Alert.alert("Erro", "Não foi possível compartilhar.");
              }
            }}
          >
            <Text style={[styles.smallButtonText, { color: "#000" }]}>Compartilhar</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Details card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Informações</Text>

        <View style={styles.infoRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.infoLabel}>Perfil privado</Text>
            <Text style={styles.privacyHint}>
              {isPrivate ? "Apenas seguidores veem detalhes e atividades." : "Perfil visivel no ranking e feed."}
            </Text>
          </View>
          <Switch
            value={isPrivate}
            onValueChange={async (value) => {
              setIsPrivate(value);
              const uid = auth.currentUser?.uid;
              if (!uid) return;
              try {
                await updateDoc(doc(db, "users", uid), {
                  isPrivate: value,
                  profileVisibility: value ? "private" : "public",
                  updatedAt: serverTimestamp(),
                });
              } catch (e) {
                console.warn("privacy update failed", e);
              }
            }}
            trackColor={{ false: "#263238", true: WAYPER_GREEN }}
            thumbColor="#ffffff"
          />
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email:</Text>
          <Text style={styles.infoValue}>{auth.currentUser?.email || "—"}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Última atualização:</Text>
          <Text style={styles.infoValue}>{formatDate(stats.lastUpdate)}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Tempo total:</Text>
          <Text style={styles.infoValue}>{formatTimeHms(stats.totalTime)}</Text>
        </View>
      </View>

      {/* Medals */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Medalhas</Text>
        <MedalsWidget user={userDoc || {}} compact={false} onAward={() => {}} autoSaveToFirestore />
      </View>

      {/* Edit / Save */}
      {editing ? (
        <TouchableOpacity style={styles.saveButton} onPress={saveChanges} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Salvar</Text>}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.editButton} onPress={() => setEditing(true)}>
          <Ionicons name="create-outline" size={18} color="#fff" />
          <Text style={styles.editText}>Editar Perfil</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

/* ---------------------- Styles (mantive e ampliei visual) ---------------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0d10" },

  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0b0d10",
  },

  loadingText: { color: "#fff", marginTop: 10 },

  header: {
    paddingTop: Platform.OS === "ios" ? 55 : 45,
    paddingBottom: 35,
    alignItems: "center",
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
  },

  photo: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 3,
    borderColor: "#ffffff",
    backgroundColor: "#0b0d10",
  },

  name: {
    fontSize: 22,
    color: "#fff",
    marginTop: 12,
    fontWeight: "800",
  },

  username: {
    fontSize: 14,
    color: "#aaa",
    marginTop: 4,
  },

  bio: {
    color: "#ccc",
    fontSize: 14,
    marginTop: 6,
    paddingHorizontal: 30,
    textAlign: "center",
  },

  input: {
    backgroundColor: "#1b1c20",
    color: "#fff",
    padding: 10,
    marginTop: 10,
    borderRadius: 10,
    width: 230,
    textAlign: "center",
  },

  bioInput: { height: 85, textAlignVertical: "top" },

  statsRow: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    marginTop: 25,
  },

  statBox: { alignItems: "center" },

  statValue: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },

  statLabel: {
    fontSize: 13,
    color: "#aaa",
    marginTop: 2,
  },

  card: {
    backgroundColor: "#13161a",
    marginHorizontal: 20,
    marginTop: 25,
    padding: 18,
    borderRadius: 14,
  },

  cardTitle: {
    fontSize: 18,
    color: "#fff",
    fontWeight: "700",
    marginBottom: 12,
  },

  xpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  xpLabel: { color: "#bbb", fontWeight: "700" },
  xpValue: { color: "#fff", fontWeight: "800" },

  progressBarBack: {
    height: 12,
    backgroundColor: "#0b1113",
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 8,
  },
  progressBarFill: {
    height: 12,
  },

  small: { color: "#9aa6ad", marginTop: 6 },

  recordsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },

  record: { alignItems: "flex-start" },
  recordLabel: { color: "#9aa6ad", fontSize: 12 },
  recordValue: { color: "#fff", fontWeight: "700" },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  infoLabel: { color: "#bbb", fontSize: 14 },

  infoValue: { color: "#fff", fontSize: 14 },

  privacyHint: {
    color: "#8f9aa3",
    fontSize: 12,
    marginTop: 4,
  },

  editButton: {
    marginTop: 30,
    marginBottom: 40,
    marginHorizontal: 20,
    backgroundColor: WAYPER_GREEN,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },

  editText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },

  saveButton: {
    marginTop: 30,
    marginBottom: 40,
    marginHorizontal: 20,
    backgroundColor: "#2ecc71",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  saveText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },

  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },

  smallButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
});
