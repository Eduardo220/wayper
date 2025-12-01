// src/screens/ProfileScreen.js
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";

import { getAuth } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { MotiView, MotiText } from "moti";

import MedalsWidget from "../components/MedalsWidget";

export default function ProfileScreen() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");

  /* -------------------------------------------
     LOAD USER
  ------------------------------------------- */
  const loadUser = useCallback(async () => {
    try {
      const auth = getAuth();
      const current = auth.currentUser;

      if (!current) {
        console.log("Nenhum usuário logado.");
        setLoading(false);
        return;
      }

      const snap = await getDoc(doc(db, "users", current.uid));

      if (snap.exists()) {
        const data = snap.data();

        setUser(data);
        setName(data.name || "");
        setBio(data.bio || "");
        setAvatar(data.avatar || "");
      }
    } catch (err) {
      console.log("Erro buscando usuário:", err);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  /* -------------------------------------------
     PICK IMAGE
  ------------------------------------------- */
  async function pickImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (!result.canceled) {
        setAvatar(result.assets[0].uri);
      }
    } catch (e) {
      console.log("Erro selecionando imagem:", e);
    }
  }

  /* -------------------------------------------
     SAVE EDITS
  ------------------------------------------- */
  async function saveChanges() {
    try {
      if (!name.trim()) {
        console.log("Nome inválido.");
        return;
      }

      const auth = getAuth();
      const uid = auth.currentUser?.uid;

      if (!uid) return;

      await updateDoc(doc(db, "users", uid), {
        name: name.trim(),
        bio: bio.trim(),
        avatar,
      });

      setUser({
        ...user,
        name: name.trim(),
        bio: bio.trim(),
        avatar,
      });

      setEditing(false);
    } catch (err) {
      console.log("Erro salvando perfil:", err);
    }
  }

  /* -------------------------------------------
     FORMAT DATE
  ------------------------------------------- */
  function formatDate(ts) {
    try {
      if (!ts || !ts.toDate) return "—";
      return ts.toDate().toLocaleDateString("pt-BR");
    } catch {
      return "—";
    }
  }

  /* -------------------------------------------
     LOADING
  ------------------------------------------- */
  if (loading || !user) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#ff6b00" />
        <Text style={styles.loadingText}>Carregando perfil...</Text>
      </View>
    );
  }

  const displayAvatar =
    avatar ||
    user.avatar ||
    "https://i.pravatar.cc/300?u=wayper_default_profile";

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* HEADER */}
      <LinearGradient colors={["#13161a", "#0d0f12"]} style={styles.header}>
        <TouchableOpacity
          onPress={editing ? pickImage : null}
          activeOpacity={editing ? 0.7 : 1}
        >
          <MotiView
            from={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", duration: 600 }}
          >
            <Image source={{ uri: displayAvatar }} style={styles.photo} />
          </MotiView>
        </TouchableOpacity>

        {/* EDIT MODE */}
        {editing ? (
          <>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Seu nome"
              placeholderTextColor="#666"
            />

            <Text style={styles.username}>@{user.username}</Text>

            <TextInput
              style={[styles.input, styles.bioInput]}
              value={bio}
              onChangeText={setBio}
              placeholder="Sua bio"
              placeholderTextColor="#666"
              multiline
            />
          </>
        ) : (
          <>
            <MotiText
              from={{ opacity: 0, translateY: -6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ delay: 200 }}
              style={styles.name}
            >
              {user.name}
            </MotiText>

            <Text style={styles.username}>@{user.username}</Text>

            {user.bio ? (
              <Text style={styles.bio}>{user.bio}</Text>
            ) : null}
          </>
        )}
      </LinearGradient>

      {/* STATS */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{user.level}</Text>
          <Text style={styles.statLabel}>Nível</Text>
        </View>

        <View style={styles.statBox}>
          <Text style={styles.statValue}>{user.totalZones}</Text>
          <Text style={styles.statLabel}>Zonas</Text>
        </View>

        <View style={styles.statBox}>
          <Text style={styles.statValue}>{user.totalArea}</Text>
          <Text style={styles.statLabel}>Km²</Text>
        </View>

        <View style={styles.statBox}>
          <Text style={styles.statValue}>{user.xp}</Text>
          <Text style={styles.statLabel}>XP</Text>
        </View>
      </View>

      {/* INFO CARD */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Informações</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email:</Text>
          <Text style={styles.infoValue}>{user.email}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Criado em:</Text>
          <Text style={styles.infoValue}>
            {formatDate(user.createdAt)}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Último acesso:</Text>
          <Text style={styles.infoValue}>
            {formatDate(user.lastActive)}
          </Text>
        </View>
      </View>

      {/* MEDALHAS */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Medalhas</Text>
        <MedalsWidget user={user} compact={false} />
      </View>

      {/* EDIT / SAVE */}
      {editing ? (
        <TouchableOpacity style={styles.saveButton} onPress={saveChanges}>
          <Text style={styles.saveText}>Salvar</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => setEditing(true)}
        >
          <Ionicons name="create-outline" size={18} color="#fff" />
          <Text style={styles.editText}>Editar Perfil</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

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
    paddingTop: 45,
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

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  infoLabel: { color: "#bbb", fontSize: 14 },

  infoValue: { color: "#fff", fontSize: 14 },

  editButton: {
    marginTop: 30,
    marginBottom: 40,
    marginHorizontal: 20,
    backgroundColor: "#00e676",
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
  },

  saveText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
