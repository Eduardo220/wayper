import React from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import {
  DrawerContentScrollView,
  DrawerItemList,
} from "@react-navigation/drawer";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { MotiView, MotiText } from "moti";
import { colors } from "../theme/colors";

export default function CustomDrawer(props) {
  const user = {
    name: "Eduardo Weissheimer",
    level: 7,
    xp: 3450,
    nextLevelXP: 5000,
    area: 4.3, // km² conquistados
    avatar: "https://i.pravatar.cc/150?img=12",
  };

  const progress = (user.xp / user.nextLevelXP) * 100;

  return (
    <View style={{ flex: 1 }}>
      {/* Cabeçalho com gradiente e animação */}
      <LinearGradient
        colors={[colors.primary, colors.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <MotiView
          from={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", duration: 600 }}
        >
          <Image source={{ uri: user.avatar }} style={styles.avatar} />
        </MotiView>

        <MotiText
          from={{ opacity: 0, translateY: -10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ delay: 300 }}
          style={styles.name}
        >
          {user.name}
        </MotiText>

        <MotiText
          from={{ opacity: 0, translateY: -10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ delay: 400 }}
          style={styles.level}
        >
          Nível {user.level}
        </MotiText>

        {/* Barra de XP */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <MotiView
              from={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
              transition={{ type: "timing", duration: 800 }}
              style={styles.progressFill}
            />
          </View>
          <MotiText
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 700 }}
            style={styles.xpText}
          >
            {user.xp} / {user.nextLevelXP} XP
          </MotiText>
        </View>

        {/* Área conquistada */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ delay: 800 }}
          style={styles.statsRow}
        >
          <Ionicons name="earth-outline" size={16} color={colors.white} />
          <Text style={styles.areaText}>{user.area} km² conquistados</Text>
        </MotiView>
      </LinearGradient>

      {/* Itens do Drawer */}
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.drawerContainer}
      >
        <DrawerItemList {...props} />
      </DrawerContentScrollView>

      {/* Rodapé */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={() => console.log("Logout")}
        >
          <Ionicons name="exit-outline" size={18} color={colors.white} />
          <Text style={styles.logoutText}>Sair</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingVertical: 40,
    alignItems: "center",
    borderBottomRightRadius: 25,
    borderBottomLeftRadius: 25,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 6,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: colors.white,
    marginBottom: 10,
  },
  name: {
    color: colors.white,
    fontSize: 18,
    fontWeight: "bold",
  },
  level: {
    color: "#e0ffff",
    fontSize: 14,
    marginBottom: 10,
  },
  progressContainer: {
    width: "80%",
    alignItems: "center",
  },
  progressBar: {
    height: 8,
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 5,
    marginBottom: 4,
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.white,
    borderRadius: 5,
  },
  xpText: {
    color: colors.white,
    fontSize: 12,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 6,
  },
  areaText: {
    color: colors.white,
    fontWeight: "600",
  },
  drawerContainer: {
    backgroundColor: colors.background,
    paddingTop: 10,
  },
  footer: {
    padding: 15,
    backgroundColor: colors.primary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.secondary,
    paddingVertical: 10,
    borderRadius: 12,
  },
  logoutText: {
    color: colors.white,
    fontWeight: "600",
  },
});
