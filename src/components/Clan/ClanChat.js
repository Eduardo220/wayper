// src/components/ClanChat.js
import React, { useEffect, useState, useRef } from "react";
import { View, TextInput, TouchableOpacity, FlatList, Text, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { collection, addDoc, serverTimestamp, query, orderBy, onSnapshot } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { colors } from "../../theme/colors";

export default function ClanChat({ clanId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const flatRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, "clans", clanId, "chat"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
      setMessages(arr);
      setTimeout(()=> flatRef.current?.scrollToEnd({animated:true}), 200);
    });
    return () => unsub();
  }, [clanId]);

  const send = async () => {
    if (!text.trim()) return;
    await addDoc(collection(db, "clans", clanId, "chat"), {
      fromUid: auth.currentUser.uid,
      text: text.trim(),
      createdAt: serverTimestamp(),
      type: "text"
    });
    setText("");
  };

  const renderItem = ({item}) => {
    const me = item.fromUid === auth.currentUser.uid;
    return (
      <View style={[cstyles.balloon, me ? cstyles.me : cstyles.other]}>
        <Text style={{color: me? colors.backgroundCard : colors.textMain}}>{item.text}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":"height"}>
      <FlatList ref={flatRef} data={messages} keyExtractor={i=>i.id} renderItem={renderItem} contentContainerStyle={{paddingVertical:8}}/>
      <View style={cstyles.composer}>
        <TextInput value={text} onChangeText={setText} placeholder="Escreve algo pro grupo..." placeholderTextColor={colors.textMuted} style={cstyles.input}/>
        <TouchableOpacity onPress={send} style={cstyles.sendBtn}>
          <Text style={{color:colors.white}}>Enviar</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const cstyles = StyleSheet.create({
  composer:{flexDirection:"row", alignItems:"center", padding:8, backgroundColor: colors.background, borderTopColor:colors.border, borderTopWidth:1},
  input:{flex:1, backgroundColor: colors.backgroundCard, padding:10, borderRadius:8, color: colors.textMain},
  sendBtn:{paddingVertical:10, paddingHorizontal:12, backgroundColor: colors.primary, borderRadius:8, marginLeft:8},
  balloon:{maxWidth:"78%", padding:10, borderRadius:10, marginHorizontal:12, marginVertical:6},
  me:{alignSelf:"flex-end", backgroundColor: colors.primary},
  other:{alignSelf:"flex-start", backgroundColor: colors.backgroundCard}
});
