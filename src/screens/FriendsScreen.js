import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from "react-native";
import { auth, db } from "../firebaseConfig";
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

export default function FriendsScreen() {
  const [friends, setFriends] = useState([]);
  const [usernameToAdd, setUsernameToAdd] = useState("");
  const [loading, setLoading] = useState(false);
  const currentUser = auth.currentUser;

  // 🔹 Carrega amigos em tempo real
  useEffect(() => {
    if (!currentUser) return;

    const friendsRef = collection(db, "users", currentUser.uid, "friends");

    const unsubscribe = onSnapshot(friendsRef, async (snapshot) => {
      const friendsData = [];
      for (const docSnap of snapshot.docs) {
        const friendId = docSnap.data().friendId;
        const friendData = await getDoc(doc(db, "users", friendId));
        if (friendData.exists()) {
          friendsData.push({ id: docSnap.id, friendId, ...friendData.data() });
        }
      }
      setFriends(friendsData);
    });

    return unsubscribe;
  }, [currentUser]);

  // 🔹 Adiciona amigo pelo nome de usuário
  const handleAddFriend = async () => {
    if (!usernameToAdd.trim()) return Alert.alert("Digite um nome de usuário!");
    if (!currentUser) return Alert.alert("Usuário não autenticado.");

    try {
      setLoading(true);

      const q = query(
        collection(db, "users"),
        where("username", "==", usernameToAdd.trim())
      );
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        Alert.alert("Usuário não encontrado!");
        setLoading(false);
        return;
      }

      const friendDoc = querySnapshot.docs[0];
      const friendId = friendDoc.id;

      if (friendId === currentUser.uid) {
        Alert.alert("Você não pode adicionar a si mesmo!");
        setLoading(false);
        return;
      }

      // Verifica se já é amigo
      const existing = friends.find((f) => f.friendId === friendId);
      if (existing) {
        Alert.alert("Esse usuário já é seu amigo!");
        setLoading(false);
        return;
      }

      await addDoc(collection(db, "users", currentUser.uid, "friends"), {
        friendId,
        addedAt: new Date(),
      });

      Alert.alert("Amigo adicionado com sucesso!");
      setUsernameToAdd("");
    } catch (error) {
      console.error(error);
      Alert.alert("Erro ao adicionar amigo", error.message);
    } finally {
      setLoading(false);
    }
  };

  // 🔹 Remove amigo
  const handleRemoveFriend = async (friendDocId, friendName) => {
    Alert.alert(
      "Remover amigo",
      `Deseja remover ${friendName} dos seus amigos?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Remover",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(
                doc(db, "users", currentUser.uid, "friends", friendDocId)
              );
              Alert.alert("Amigo removido com sucesso!");
            } catch (error) {
              console.error(error);
              Alert.alert("Erro ao remover amigo", error.message);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>👥 Meus Amigos</Text>

      {/* Campo para adicionar amigo */}
      <View style={styles.addContainer}>
        <TextInput
          style={styles.input}
          placeholder="Digite o nome de usuário"
          value={usernameToAdd}
          onChangeText={setUsernameToAdd}
        />
        <TouchableOpacity
          style={[styles.button, loading && { opacity: 0.6 }]}
          onPress={handleAddFriend}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? "Adicionando..." : "Adicionar"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Lista de amigos */}
      <FlatList
        data={friends}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.details}>@{item.username}</Text>
              <Text style={styles.details}>Nível: {item.level}</Text>
              <Text style={styles.details}>Área total: {item.totalArea} km²</Text>
            </View>
            <TouchableOpacity
              onPress={() => handleRemoveFriend(item.id, item.name)}
              style={styles.removeButton}
            >
              <Text style={styles.removeText}>🗑️</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            Você ainda não adicionou amigos.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 20 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 15 },
  addContainer: { flexDirection: "row", marginBottom: 20, gap: 8 },
  input: {
    flex: 1,
    borderColor: "#ccc",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  button: {
    backgroundColor: "#4CAF50",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 15,
  },
  buttonText: { color: "#fff", fontWeight: "bold" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f3f3",
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
  name: { fontSize: 16, fontWeight: "600" },
  details: { color: "#555" },
  removeButton: {
    padding: 8,
    backgroundColor: "#ff4d4d20",
    borderRadius: 8,
  },
  removeText: { fontSize: 18 },
  emptyText: { textAlign: "center", color: "#777", marginTop: 20 },
});
