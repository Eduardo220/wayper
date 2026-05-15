import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../../theme/wayperTheme";

export function WPHeader({ title, logoSource, onMenuPress, onBackPress, back = false, right, style }) {
  return (
    <View style={[styles.header, style]}>
      <Pressable onPress={back ? onBackPress : onMenuPress} style={styles.menuButton}>
        <Ionicons name={back ? "chevron-back" : "menu"} size={27} color={WayperTheme.colors.text} />
      </Pressable>

      {logoSource ? <Image source={logoSource} style={styles.logo} resizeMode="contain" /> : null}

      <Text style={styles.brand}>Wayper</Text>

      <View style={styles.divider} />

      <Text numberOfLines={1} style={styles.title}>{title}</Text>

      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 76,
    paddingHorizontal: WayperTheme.spacing.page,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: WayperTheme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  menuButton: {
    width: 52,
    height: 52,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  logo: {
    width: 42,
    height: 28,
    marginLeft: WayperTheme.spacing.lg,
  },
  brand: {
    color: WayperTheme.colors.text,
    fontSize: 23,
    fontWeight: "800",
    marginLeft: WayperTheme.spacing.sm,
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginHorizontal: WayperTheme.spacing.lg,
  },
  title: {
    flexShrink: 1,
    color: WayperTheme.colors.primary,
    fontSize: 22,
    fontWeight: "800",
  },
  right: {
    marginLeft: "auto",
  },
});
