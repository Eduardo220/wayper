import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WayperTheme } from "../theme/wayperTheme";
import { MAIN_TABS, openRunEntry } from "./mainTabsRoutes.js";

export default function MainTabs({ children, navigation, state }) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name === "PublicProfile" ? "Perfil" : state.routes[state.index]?.name;
  return <View style={styles.shell}>
    <View style={styles.content}>{children}</View>
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8),
      paddingLeft: insets.left, paddingRight: insets.right }]}>
      {MAIN_TABS.map((tab) => {
        const run = tab.name === "Correr";
        const selected = !run && current === tab.route;
        const color = selected ? WayperTheme.colors.primary : WayperTheme.colors.textMuted;
        return <Pressable key={tab.name} testID={"main-tab-" + tab.name}
          accessibilityRole={run ? "button" : "tab"} accessibilityLabel={tab.name}
          accessibilityState={run ? undefined : { selected }} style={styles.tab}
          onPress={run ? () => openRunEntry(navigation) : () => navigation.navigate(tab.route)}>
          <View style={run ? styles.run : styles.icon}>
            <Ionicons name={tab.icon} size={run ? 30 : 24}
              color={run ? WayperTheme.colors.textInverse : color} />
          </View>
          <Text style={[styles.label, { color: run ? WayperTheme.colors.primary : color }]}>{tab.name}</Text>
          <View style={[styles.indicator, { opacity: selected ? 1 : 0 }]} />
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: WayperTheme.colors.background },
  content: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "flex-end", paddingTop: 8,
    backgroundColor: WayperTheme.colors.backgroundAlt,
    borderTopWidth: 1, borderTopColor: WayperTheme.colors.border },
  tab: { flex: 1, minHeight: 64, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  icon: { height: 32, justifyContent: "center" },
  run: { width: 58, height: 58, borderRadius: 29, marginTop: -22,
    alignItems: "center", justifyContent: "center", backgroundColor: WayperTheme.colors.primary,
    borderWidth: 3, borderColor: WayperTheme.colors.backgroundAlt },
  label: { fontSize: 11, fontWeight: "700" },
  indicator: { width: 18, height: 3, borderRadius: 2, backgroundColor: WayperTheme.colors.primary },
});
