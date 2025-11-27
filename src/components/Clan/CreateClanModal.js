// src/components/CreateClanModal.js
import React, { useState } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { colors } from "../../theme/colors";
import { Platform } from "react-native";


export default function CreateClanModal({ visible, onClose }) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !tag.trim()) return Alert.alert("Nome e tag são obrigatórios");
    if (tag.length > 6) return Alert.alert("Tag curta (<=6 chars)");
    setSaving(true);
    try {
      const ownerId = auth.currentUser.uid;
      const docRef = await addDoc(collection(db, "clans"), {
        name: name.trim(),
        tag: tag.trim().toUpperCase(),
        description: desc.trim(),
        avatar: null,
        ownerId,
        coLeaders: [],
        membersCount: 1,
        public: true,
        createdAt: serverTimestamp()
      });
      // add member record
      await addDoc(collection(db, "clans", docRef.id, "members"), {
        uid: ownerId, role: "owner", joinedAt: serverTimestamp()
      });
      // add user->clans index
      await addDoc(collection(db, "users", ownerId, "clans"), { clanId: docRef.id, role: "owner", joinedAt: serverTimestamp()});
      Alert.alert("Clã criado!");
      setName(""); setTag(""); setDesc("");
      onClose();
    } catch (e) {
      console.warn("create clan", e);
      Alert.alert("Erro ao criar clan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={mstyles.back}>
        <View style={mstyles.box}>
          <Text style={mstyles.title}>Criar Clã</Text>
          <TextInput placeholder="Nome do clã" value={name} onChangeText={setName} style={mstyles.input}/>
          <TextInput placeholder="TAG (ex: WPR)" value={tag} onChangeText={setTag} style={mstyles.input}/>
          <TextInput placeholder="Descrição (opcional)" value={desc} onChangeText={setDesc} style={[mstyles.input, {height:80}]} multiline/>
          <View style={{flexDirection:"row", justifyContent:"space-between", marginTop:10}}>
            <TouchableOpacity onPress={onClose} style={[mstyles.btn, {backgroundColor:colors.backgroundCard}]}>
              <Text style={{color:colors.textMain}}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCreate} disabled={saving} style={[mstyles.btn, {backgroundColor:colors.primary}]}>
              <Text style={{color:colors.white}}>{saving? "..." : "Criar"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const mstyles = StyleSheet.create({
  back:{flex:1, backgroundColor:"rgba(0,0,0,0.45)", justifyContent:"center", alignItems:"center"},
  box:{width:"92%", backgroundColor:colors.backgroundCard, padding:18, borderRadius:12},
  title:{fontSize:18, fontWeight:"800", color:colors.textMain, marginBottom:10},
  input:{backgroundColor: colors.background, borderRadius:8, padding:10, color:colors.textMain, marginTop:8},
  btn:{padding:12, borderRadius:8, paddingHorizontal:18},
});
