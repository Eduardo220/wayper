// src/screens/Clan/ClanChatScreen.js
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { auth, db } from "../../firebaseConfig";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

import { colors } from "../../theme/colors";

export default function ClanChatScreen({ route }) {
  const { clanId } = route.params;

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  const flatRef = useRef(null);
  const user = auth.currentUser;

  useEffect(() => {
    if (!clanId) return;

    const msgRef = collection(db, "clans", clanId, "messages");
    const q = query(msgRef, orderBy("createdAt", "asc"));

    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      setMessages(arr);

      setTimeout(() => {
        if (flatRef.current) {
          flatRef.current.scrollToEnd({ animated: true });
        }
      }, 100);
    });

    return () => unsub();
  }, [clanId]);

  const sendMsg = async () => {
    if (!text.trim()) return;
    try {
      await addDoc(collection(db, "clans", clanId, "messages"), {
        text: text.trim(),
        userId: user.uid,
        username: user.displayName || "misterioso",
        createdAt: serverTimestamp(),
      });
      setText("");

      setTimeout(() => {
        if (flatRef.current) {
          flatRef.current.scrollToEnd({ animated: true });
        }
      }, 80);
    } catch (e) {
      console.log("Erro ao enviar msg", e);
    }
  };

  const renderItem = ({ item }) => {
    const mine = item.userId === user.uid;

    return (
      <View
        style={[
          styles.msgBox,
          mine ? styles.mine : styles.theirs,
        ]}
      >
        <Text style={styles.username}>{item.username}</Text>
        <Text style={styles.msg}>{item.text}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 70 : 0}
    >
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 90 }}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Fala algo pro clã..."
          placeholderTextColor={colors.textSoft}
          value={text}
          onChangeText={setText}
        />

        <TouchableOpacity style={styles.sendBtn} onPress={sendMsg}>
          <Ionicons name="send" color={colors.white} size={22} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  msgBox: {
    maxWidth: "78%",
    padding: 10,
    borderRadius: 12,
    marginVertical: 6,
  },

  mine: {
    backgroundColor: colors.primary,
    alignSelf: "flex-end",
  },

  theirs: {
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },

  username: {
    color: colors.textSoft,
    fontSize: 11,
    marginBottom: 3,
  },

  msg: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "600",
  },

  inputRow: {
    position: "absolute",
    bottom: 0,
    flexDirection: "row",
    width: "100%",
    padding: 12,
    backgroundColor: colors.backgroundCard,
    borderTopWidth: 1,
    borderColor: colors.border,
  },

  input: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.white,
    fontSize: 14,
  },

  sendBtn: {
    marginLeft: 10,
    backgroundColor: colors.primary,
    width: 46,
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
