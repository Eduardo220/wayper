import React, { memo } from "react";
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

export default memo(function CustomDrawer(props) {
  const user = props.user || {};

  const name =
    user.name ||
    user.displayName ||
    user.username ||
    user.email?.split("@")[0] ||
    "Usuário";

  const avatar =
    user.photoURL ||
    user.avatar ||
    "https://i.pravatar.cc/150?u=wayper_default";

  const level = Number(user.level) || 1;
  const xp = Number(user.xp) || 0;
  const nextXP = Number(user.nextLevelXP) || 1000;
  const area = Number(user.area) || 0;

  const progress = Math.max(
    0,
    Math.min((xp / nextXP) * 100 || 0, 100)
  );

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <LinearGradient colors={["#13161a", "#0d0f12"]} style={styles.header}>
        
        {/* AVATAR */}
        <MotiView
          from={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", duration: 450 }}
        >
          <Image source={{ uri: avatar }} style={styles.avatar} />
        </MotiView>

        {/* NOME */}
        <MotiText
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 120 }}
          style={styles.name}
        >
          {name}
        </MotiText>

        {/* LEVEL */}
        <MotiText
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 200 }}
          style={styles.level}
        >
          Nível {level}
        </MotiText>

        {/* XP BAR */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <MotiView
              from={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
              transition={{ type: "timing", duration: 700 }}
              style={styles.progressFill}
            />
          </View>
          <Text style={styles.xpText}>
            {xp} / {nextXP} XP
          </Text>
        </View>

        {/* AREA */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ delay: 280 }}
          style={styles.areaRow}
        >
          <Ionicons name="map-outline" size={16} color="#ffffff" />
          <Text style={styles.areaText}>
            {area} km² conquistados
          </Text>
        </MotiView>
      </LinearGradient>

      {/* MENU */}
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.scrollBody}
      >
        <DrawerItemList {...props} />
      </DrawerContentScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={props.onSignOut}
        >
          <Ionicons name="exit-outline" size={20} color="#fff" />
          <Text style={styles.logoutText}>Sair</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0d10",
  },

  header: {
    paddingTop: 45,
    paddingBottom: 30,
    alignItems: "center",
    borderBottomRightRadius: 25,
    borderBottomLeftRadius: 25,
    overflow: "hidden",
  },

  avatar: {
    width: 95,
    height: 95,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: "#ffffff",
    marginBottom: 12,
  },

  name: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },

  level: {
    color: "#c7d0d8",
    fontSize: 14,
    marginTop: 2,
    marginBottom: 12,
  },

  progressContainer: {
    width: "80%",
    alignItems: "center",
  },

  progressBar: {
    width: "100%",
    height: 8,
    backgroundColor: "#25282d",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 5,
  },

  progressFill: {
    height: "100%",
    backgroundColor: "#ff6b00",
    borderRadius: 6,
  },

  xpText: {
    color: "#ffffff",
    fontSize: 11,
  },

  areaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    gap: 6,
  },

  areaText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },

  scrollBody: {
    paddingTop: 10,
    backgroundColor: "#0b0d10",
  },

  footer: {
    padding: 16,
    backgroundColor: "#0d0f12",
    borderTopColor: "#1a1d21",
    borderTopWidth: 1,
  },

  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    backgroundColor: "#00e676",
    borderRadius: 12,
  },

  logoutText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
});
