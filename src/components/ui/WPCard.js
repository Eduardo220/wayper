import React from "react";
import { View, StyleSheet } from "react-native";
import { WayperTheme } from "../../theme/wayperTheme";

export function WPCard({ children, style, accent = "green", glow = false, glass = false }) {
  const accentStyle =
    accent === "cyan" ? styles.cyanAccent : accent === "danger" ? styles.dangerAccent : styles.greenAccent;

  return (
    <View style={[styles.card, accentStyle, glass && styles.glass, glow && styles.glow, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderRadius: WayperTheme.radius.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.lg,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  glass: {
    backgroundColor: WayperTheme.colors.surfaceGlass,
  },
  greenAccent: {
    borderColor: WayperTheme.colors.border,
  },
  cyanAccent: {
    borderColor: WayperTheme.colors.cyanBorder,
  },
  dangerAccent: {
    borderColor: WayperTheme.colors.dangerBorder,
  },
  glow: {
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.greenGlow,
  },
});
