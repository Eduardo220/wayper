import React, { useState } from "react";
import { Alert, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";
import { colors } from "../../theme/colors";

export default function CreateGroupModal({ visible, onClose }) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [desc, setDesc] = useState("");
  const [nextRun, setNextRun] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !tag.trim()) {
      Alert.alert("Nome e tag são obrigatórios");
      return;
    }

    if (tag.length > 6) {
      Alert.alert("Use uma tag curta, com até 6 caracteres");
      return;
    }

    setSaving(true);

    try {
      const ownerId = auth.currentUser.uid;
      const docRef = await addDoc(collection(db, "groups"), {
        name: name.trim(),
        tag: tag.trim().toUpperCase(),
        description: desc.trim(),
        avatar: null,
        ownerId,
        coLeaders: [],
        membersCount: 1,
        public: true,
        nextRun: nextRun.trim(),
        createdAt: serverTimestamp(),
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

      Alert.alert("Grupo criado!");
      setName("");
      setTag("");
      setDesc("");
      setNextRun("");
      onClose();
    } catch (error) {
      console.warn("create group", error);
      Alert.alert("Erro ao criar grupo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.back}>
        <View style={styles.box}>
          <Text style={styles.title}>Criar Grupo</Text>
          <TextInput
            placeholder="Nome do grupo"
            value={name}
            onChangeText={setName}
            style={styles.input}
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            placeholder="TAG (ex: WPR)"
            value={tag}
            onChangeText={setTag}
            style={styles.input}
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            placeholder="Descrição (opcional)"
            value={desc}
            onChangeText={setDesc}
            style={[styles.input, styles.descriptionInput]}
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <TextInput
            placeholder="Próxima corrida do grupo (opcional)"
            value={nextRun}
            onChangeText={setNextRun}
            style={styles.input}
            placeholderTextColor={colors.textMuted}
          />

          <View style={styles.btnRow}>
            <TouchableOpacity onPress={onClose} style={[styles.btn, { backgroundColor: colors.backgroundCard }]}>
              <Text style={{ color: colors.textMain }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCreate} disabled={saving} style={[styles.btn, { backgroundColor: colors.primary }]}>
              <Text style={{ color: colors.white }}>{saving ? "..." : "Criar"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 20 : 0,
  },
  box: { width: "92%", backgroundColor: colors.backgroundCard, padding: 18, borderRadius: 12 },
  title: { fontSize: 18, fontWeight: "800", color: colors.textMain, marginBottom: 10 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: 10,
    color: colors.textMain,
    marginTop: 8,
  },
  descriptionInput: { height: 80 },
  btnRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  btn: { padding: 12, borderRadius: 8, paddingHorizontal: 18 },
});
