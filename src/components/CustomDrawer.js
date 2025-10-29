import React from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import {
  DrawerContentScrollView,
  DrawerItemList,
} from "@react-navigation/drawer";

export default function CustomDrawer(props) {
  const user = {
    name: "Eduardo Weissheimer",
    level: 7,
    xp: 3450,
    nextLevelXP: 5000,
    area: 4.3, // km² conquistados
    avatar:
      "https://i.pravatar.cc/150?img=12", // imagem aleatória, depois tu pode puxar do perfil real
  };

  const progress = (user.xp / user.nextLevelXP) * 100;

  return (
    <View style={{ flex: 1 }}>
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={{ backgroundColor: "#00b894" }}
      >
        <View style={styles.profileContainer}>
          <Image source={{ uri: user.avatar }} style={styles.avatar} />
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.level}>Nível {user.level}</Text>

          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.xpText}>
            {user.xp} / {user.nextLevelXP} XP
          </Text>

          <Text style={styles.area}>🌍 {user.area} km² conquistados</Text>
        </View>

        <View style={{ flex: 1, backgroundColor: "#fff", paddingTop: 10 }}>
          <DrawerItemList {...props} />
        </View>
      </DrawerContentScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          onPress={() => console.log("Sair")}
          style={styles.logoutBtn}
        >
          <Text style={styles.logoutText}>🚪 Sair</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  profileContainer: {
    padding: 20,
    alignItems: "center",
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: "#fff",
  },
  name: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  level: { color: "#dfe6e9", marginBottom: 6 },
  progressBar: {
    height: 8,
    width: "80%",
    backgroundColor: "#006a52",
    borderRadius: 5,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#fff",
  },
  xpText: {
    color: "#fff",
    fontSize: 12,
    marginTop: 4,
  },
  area: {
    color: "#fff",
    marginTop: 8,
    fontWeight: "600",
  },
  footer: {
    padding: 15,
    borderTopWidth: 1,
    borderColor: "#eee",
  },
  logoutBtn: {
    padding: 10,
    backgroundColor: "#eee",
    borderRadius: 8,
    alignItems: "center",
  },
  logoutText: { color: "#333", fontWeight: "600" },
});
