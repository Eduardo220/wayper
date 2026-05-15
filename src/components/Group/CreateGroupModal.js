import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";
import { WayperTheme } from "../../theme/wayperTheme";

export default function CreateGroupModal({ visible, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [desc, setDesc] = useState("");
  const [nextRun, setNextRun] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setTag("");
    setDesc("");
    setNextRun("");
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose?.();
  };

  const handleCreate = async () => {
    const cleanName = name.trim();
    const cleanTag = tag.trim().replace(/^#/, "").toUpperCase();

    if (!cleanName || !cleanTag) {
      Alert.alert("Criar grupo", "Nome e tag sao obrigatorios.");
      return;
    }

    if (cleanTag.length > 6) {
      Alert.alert("Criar grupo", "Use uma tag curta, com ate 6 caracteres.");
      return;
    }

    if (!auth.currentUser?.uid) {
      Alert.alert("Criar grupo", "Entre na sua conta para criar um grupo.");
      return;
    }

    setSaving(true);

    try {
      const ownerId = auth.currentUser.uid;
      const docRef = await addDoc(collection(db, "groups"), {
        name: cleanName,
        tag: cleanTag,
        description: desc.trim(),
        avatar: null,
        ownerId,
        coLeaders: [],
        membersCount: 1,
        public: true,
        nextRun: nextRun.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "groups", docRef.id, "members", ownerId), {
        uid: ownerId,
        role: "owner",
        joinedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "users", ownerId, "groups", docRef.id), {
        groupId: docRef.id,
        role: "owner",
        joinedAt: serverTimestamp(),
      });

      reset();
      onCreated?.(docRef.id);
      if (!onCreated) onClose?.();
    } catch (error) {
      console.warn("[Groups] create group failed", error);
      Alert.alert("Erro", "Nao foi possivel criar o grupo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardWrap}
        >
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <LinearGradient
              colors={["rgba(0,230,118,0.16)", "rgba(56,217,255,0.07)", WayperTheme.colors.surfaceElevated]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sheetGradient}
            >
              <View style={styles.handle} />

              <View style={styles.titleRow}>
                <View style={styles.titleIcon}>
                  <Ionicons name="people-outline" size={24} color={WayperTheme.colors.primary} />
                </View>
                <View style={styles.titleTextWrap}>
                  <Text style={styles.eyebrow}>Novo grupo</Text>
                  <Text style={styles.title}>Criar grupo</Text>
                </View>
              </View>

              <Text style={styles.label}>Nome</Text>
              <TextInput
                placeholder="Ex: Wayper Runners"
                value={name}
                onChangeText={setName}
                style={styles.input}
                placeholderTextColor={WayperTheme.colors.textSubtle}
              />

              <Text style={styles.label}>Tag</Text>
              <TextInput
                placeholder="WPR"
                value={tag}
                onChangeText={setTag}
                style={styles.input}
                placeholderTextColor={WayperTheme.colors.textSubtle}
                autoCapitalize="characters"
                maxLength={6}
              />

              <Text style={styles.label}>Descricao</Text>
              <TextInput
                placeholder="Conte a vibe do grupo..."
                value={desc}
                onChangeText={setDesc}
                style={[styles.input, styles.textArea]}
                placeholderTextColor={WayperTheme.colors.textSubtle}
                multiline
              />

              <Text style={styles.label}>Proxima corrida</Text>
              <TextInput
                placeholder="Ex: Sabado, 7h no parque"
                value={nextRun}
                onChangeText={setNextRun}
                style={styles.input}
                placeholderTextColor={WayperTheme.colors.textSubtle}
              />

              <View style={styles.actions}>
                <TouchableOpacity activeOpacity={0.84} onPress={close} style={styles.cancelButton}>
                  <Text style={styles.cancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.84} onPress={handleCreate} disabled={saving} style={styles.createButton}>
                  {saving ? (
                    <ActivityIndicator size="small" color={WayperTheme.colors.textInverse} />
                  ) : (
                    <Ionicons name="sparkles-outline" size={18} color={WayperTheme.colors.textInverse} />
                  )}
                  <Text style={styles.createText}>{saving ? "Criando" : "Criar grupo"}</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.90)",
    justifyContent: "flex-end",
  },
  keyboardWrap: {
    width: "100%",
  },
  sheet: {
    width: "100%",
  },
  sheetGradient: {
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: WayperTheme.spacing.md,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
    borderTopLeftRadius: WayperTheme.radius.xxl,
    borderTopRightRadius: WayperTheme.radius.xxl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    width: 54,
    height: 5,
    borderRadius: 3,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginBottom: WayperTheme.spacing.lg,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: WayperTheme.spacing.lg,
  },
  titleIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  titleTextWrap: {
    flex: 1,
  },
  eyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 25,
    fontWeight: "900",
  },
  label: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: WayperTheme.spacing.xs,
    marginTop: WayperTheme.spacing.sm,
  },
  input: {
    minHeight: 54,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    paddingHorizontal: WayperTheme.spacing.lg,
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  textArea: {
    minHeight: 98,
    paddingTop: WayperTheme.spacing.lg,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.xl,
  },
  cancelButton: {
    flex: 0.9,
    minHeight: 54,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  createButton: {
    flex: 1.35,
    minHeight: 54,
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
  createText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 14,
    fontWeight: "900",
  },
});
