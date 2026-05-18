import React, { memo, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../../theme/wayperTheme";

function getInitials(name = "") {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return "";
  return parts.map((part) => part[0]?.toUpperCase()).join("");
}

function HomeAvatar({ uri, name, size = 54, style }) {
  const [failed, setFailed] = useState(false);
  const initials = useMemo(() => getInitials(name), [name]);
  const canRenderImage = !!uri && !failed;

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        style,
      ]}
    >
      {canRenderImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : initials ? (
        <Text style={[styles.initials, { fontSize: Math.max(13, size * 0.34) }]}>{initials}</Text>
      ) : (
        <Ionicons name="person-outline" size={Math.max(20, size * 0.42)} color={WayperTheme.colors.primary} />
      )}
    </View>
  );
}

export default memo(HomeAvatar);

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  initials: {
    color: WayperTheme.colors.text,
    fontWeight: "900",
  },
});
