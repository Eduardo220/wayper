// src/components/MedalsWidget.js
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Image, ActivityIndicator } from "react-native";
import { colors } from "../theme/colors"; // usa mesmo padrão do Navigator/Profile

// Medalhas disponíveis
const MEDALS = [
  {
    id: "zone100",
    label: "Conquistador",
    desc: "100 zonas conquistadas",
    icon: "https://img.icons8.com/emoji/48/medal-emoji.png",
  },
  {
    id: "area100",
    label: "Territorial",
    desc: "100 km² dominados",
    icon: "https://img.icons8.com/emoji/48/trophy-emoji.png",
  },
  {
    id: "streak7",
    label: "Consistente",
    desc: "7 dias seguidos",
    icon: "https://img.icons8.com/emoji/48/fire.png",
  },
];

export default function MedalsWidget({ user, compact = false }) {
  const [earned, setEarned] = useState(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Aqui deveria ler do Firestore, mas tu nem configurou isso ainda
        // Então vamos só exibir algo consistente
        const mock = {
          zone100: (user?.totalZones ?? 0) >= 100,
          area100: (user?.totalArea ?? 0) >= 100,
          streak7: (user?.streak ?? 0) >= 7,
        };

        if (!mounted) return;
        setEarned(mock);
      } catch (err) {
        console.log("medals error:", err);
        if (mounted) setEarned({});
      }
    })();

    return () => (mounted = false);
  }, [user]);

  if (!earned) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, compact && { paddingVertical: 6 }]}>
      {MEDALS.map((m) => {
        const unlocked = earned[m.id];

        return (
          <View key={m.id} style={styles.medalBox}>
            <View style={[styles.iconWrapper, unlocked && styles.iconGlow]}>
              <Image
                source={{ uri: m.icon }}
                style={[
                  styles.icon,
                  !unlocked && { opacity: 0.32 },
                ]}
              />
            </View>

            <Text
              style={[
                styles.label,
                unlocked ? styles.labelOn : styles.labelOff,
              ]}
              numberOfLines={1}
            >
              {m.label}
            </Text>

            {!compact && (
              <Text
                style={[
                  styles.desc,
                  unlocked ? styles.descOn : styles.descOff,
                ]}
                numberOfLines={1}
              >
                {m.desc}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

// —————————————————————————————————————————————
// STYLES REFORMULADOS (MESMO PADRÃO DO APP)
const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#0b151d",
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderColor: "#12333f",
    borderWidth: 1,
    marginTop: 12,
  },

  loadingBox: {
    paddingVertical: 20,
    alignItems: "center",
  },

  medalBox: {
    width: "33%",
    alignItems: "center",
  },

  iconWrapper: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#08141b",
    justifyContent: "center",
    alignItems: "center",
    borderColor: "#12333f",
    borderWidth: 1.2,
    marginBottom: 6,
  },

  iconGlow: {
    shadowColor: colors.accent,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },

  icon: {
    width: 30,
    height: 30,
  },

  label: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  labelOn: { color: colors.accent },
  labelOff: { color: colors.textMuted },

  desc: {
    fontSize: 11,
    marginTop: 2,
    textAlign: "center",
  },
  descOn: { color: colors.textMain },
  descOff: { color: "#677079" },
});
