// src/screens/Friends/FriendsScreen.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { auth, db } from "../../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  getDoc,
  deleteDoc,
  onSnapshot,
} from "firebase/firestore";
import { colors } from "../../theme";

export default function FriendsScreen({ navigation }) {
  const [friends, setFriends] = useState([]);
  const [usernameToAdd, setUsernameToAdd] = useState("");
  const [loading, setLoading] = useState(false);

  const currentUser = auth.currentUser;

  // LOAD FRIENDS LIVE
  useEffect(() => {
    if (!currentUser) return;

    const friendsRef = collection(db, "users", currentUser.uid, "friends");

    const unsubscribe = onSnapshot(friendsRef, async (snapshot) => {
      const list = [];

      for (const docSnap of snapshot.docs) {
        const friendId = docSnap.data().friendId;
        const friendDoc = await getDoc(doc(db, "users", friendId));

        if (friendDoc.exists()) {
          list.push({
            id: docSnap.id,
            friendUid: friendId,
            ...friendDoc.data(),
          });
        }
      }

      list.sort((a, b) => b.level - a.level);
      setFriends(list);
    });

    return unsubscribe;
  }, []);

  // ADD FRIEND
  const handleAddFriend = async () => {
    if (!usernameToAdd.trim()) return Alert.alert("Digite um usuário.");

    try {
      setLoading(true);

      const q = query(
        collection(db, "users"),
        where("username", "==", usernameToAdd.trim())
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        Alert.alert("Usuário não encontrado.");
        setLoading(false);
        return;
      }

      const friendData = snap.docs[0];
      const friendId = friendData.id;

      if (friendId === currentUser.uid) {
        Alert.alert("Tu não pode adicionar tu mesmo.");
        setLoading(false);
        return;
      }

      const already = friends.some((f) => f.friendUid === friendId);
      if (already) {
        Alert.alert("Esse usuário já é teu amigo.");
        setLoading(false);
        return;
      }

      await addDoc(collection(db, "users", currentUser.uid, "friends"), {
        friendId,
        addedAt: new Date(),
      });

      setUsernameToAdd("");
      Alert.alert("Amigo adicionado.");
    } catch (err) {
      console.log(err);
      Alert.alert("Erro ao adicionar.");
    } finally {
      setLoading(false);
    }
  };

  // REMOVE FRIEND
  const handleRemove = (id, name) => {
    Alert.alert("Remover amigo", `Quer remover ${name}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover",
        style: "destructive",
        onPress: async () => {
          await deleteDoc(doc(db, "users", currentUser.uid, "friends", id));
        },
      },
    ]);
  };

  const FriendCard = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        navigation.navigate("FriendProfile", { friendId: item.friendUid })
      }
    >
      <Image
        source={{ uri: item.avatar || "https://i.pravatar.cc/150" }}
        style={styles.avatar}
      />

      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.username}>@{item.username}</Text>

        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statText}>Nível {item.level}</Text>
          </View>

          <View style={styles.statPill}>
            <Text style={styles.statText}>{item.totalArea || 0} km²</Text>
          </View>

          <View style={styles.statPill}>
            <Text style={styles.statText}>{item.zones || 0} zonas</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        onPress={() => handleRemove(item.id, item.name)}
        style={styles.removeBtn}
      >
        <Ionicons name="trash-outline" size={22} color={colors.primary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="Nome de usuário"
          placeholderTextColor="#aaa"
          value={usernameToAdd}
          onChangeText={setUsernameToAdd}
        />
        <TouchableOpacity
          style={styles.addBtn}
          onPress={handleAddFriend}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.addText}>+</Text>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={friends}
        keyExtractor={(item) => item.id}
        renderItem={FriendCard}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.empty}>Nenhum amigo por aqui ainda.</Text>
        }
      />
    </View>
  );
}

// -----------------------------------------------------------
// STYLES
// -----------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 20,
  },

  addRow: {
    flexDirection: "row",
    marginBottom: 22,
    gap: 12,
  },

  input: {
    flex: 1,
    backgroundColor: "#f1f1f1",
    padding: 14,
    borderRadius: 12,
    fontWeight: "600",
    color: colors.text,
  },

  addBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },

  addText: {
    color: colors.white,
    fontSize: 26,
    fontWeight: "900",
  },

  card: {
    flexDirection: "row",
    padding: 16,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grayLight,
    alignItems: "center",
    marginBottom: 18,
  },

  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 14,
  },

  name: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
  },

  username: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },

  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },

  statPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },

  statText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 12,
  },

  removeBtn: {
    padding: 8,
    marginLeft: 10,
  },

  empty: {
    marginTop: 40,
    textAlign: "center",
    color: "#777",
    fontSize: 15,
  },
});
