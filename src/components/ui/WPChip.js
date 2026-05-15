import React, { useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { WayperTheme } from "../../theme/wayperTheme";

export function WPChip({ label, active = false, onPress, icon, color = "green", style }) {
  const scale = useRef(new Animated.Value(1)).current;
  const accentColor = color === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start()}
        style={[styles.chip, active && { backgroundColor: accentColor, borderColor: accentColor }]}
      >
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        <Text style={[styles.text, active && styles.activeText]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  text: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  activeText: {
    color: WayperTheme.colors.textInverse,
  },
  icon: {
    marginRight: 8,
  },
});
