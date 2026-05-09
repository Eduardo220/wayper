// src/components/MedalsWidget.js
/**
 * MedalsWidget — ULTIMATE / PRO / EXTREME
 *
 * Features:
 *  - automatic evaluation of medal conditions
 *  - persistent local awarded set (AsyncStorage)
 *  - custom medals via props
 *  - onAward callback for UI/telemetry
 *  - animated glow for newly awarded medals
 *  - safe integration with optional sync.saveLocalMedal
 *
 * Usage:
 *  <MedalsWidget user={userObj} compact={false} onAward={(medal, user)=>{}} customMedals={[...]} />
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  AccessibilityInfo,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../theme/colors";
import sync from "../utils/sync";

const STORAGE_KEY = "@wayper:medals_awarded_v1";
const WAYPER_ACCENT = colors.accent || "#26c6da";

/* ---------------------- Default medals (kept & extended) ---------------------- */
const DEFAULT_MEDALS = [
  {
    id: "zone100",
    label: "Conquistador",
    desc: "100 zonas conquistadas",
    icon: "https://img.icons8.com/emoji/48/medal-emoji.png",
    // condition receives ({ user, runs, zones, meta }) and must return boolean
    condition: ({ user }) => (user?.totalZones ?? user?.totalZonesCount ?? 0) >= 100,
  },
  {
    id: "area100",
    label: "Territorial",
    desc: "100 km² dominados",
    icon: "https://img.icons8.com/emoji/48/trophy-emoji.png",
    condition: ({ user }) => (user?.totalArea ?? 0) >= 100000000 /* 100 km² in m²? keep flexible */,
  },
  {
    id: "streak7",
    label: "Consistente",
    desc: "7 dias seguidos",
    icon: "https://img.icons8.com/emoji/48/fire.png",
    condition: ({ user }) => (user?.streak ?? 0) >= 7,
  },
  {
    id: "monthly_rank_100",
    label: "Top 100",
    desc: "Ranking mensal Top 100",
    icon: "https://img.icons8.com/emoji/48/sports-medal-emoji.png",
    condition: ({ user }) => Number(user?.bestMonthlyRank ?? user?.monthlyRankPreview ?? Infinity) <= 100,
  },
  {
    id: "monthly_rank_50",
    label: "Top 50",
    desc: "Ranking mensal Top 50",
    icon: "https://img.icons8.com/emoji/48/medal-emoji.png",
    condition: ({ user }) => Number(user?.bestMonthlyRank ?? user?.monthlyRankPreview ?? Infinity) <= 50,
  },
  {
    id: "monthly_rank_10",
    label: "Top 10",
    desc: "Ranking mensal Top 10",
    icon: "https://img.icons8.com/emoji/48/trophy-emoji.png",
    condition: ({ user }) => Number(user?.bestMonthlyRank ?? user?.monthlyRankPreview ?? Infinity) <= 10,
  },
  {
    id: "monthly_rank_3",
    label: "Top 3",
    desc: "Ranking mensal Top 3",
    icon: "https://img.icons8.com/emoji/48/3rd-place-medal-emoji.png",
    condition: ({ user }) => Number(user?.bestMonthlyRank ?? user?.monthlyRankPreview ?? Infinity) <= 3,
  },
  {
    id: "monthly_rank_2",
    label: "Top 2",
    desc: "Ranking mensal Top 2",
    icon: "https://img.icons8.com/emoji/48/2nd-place-medal-emoji.png",
    condition: ({ user }) => Number(user?.bestMonthlyRank ?? user?.monthlyRankPreview ?? Infinity) <= 2,
  },
  {
    id: "monthly_rank_1",
    label: "Top 1",
    desc: "Ranking mensal Top 1",
    icon: "https://img.icons8.com/emoji/48/1st-place-medal-emoji.png",
    condition: ({ user }) => Number(user?.bestMonthlyRank ?? user?.monthlyRankPreview ?? Infinity) <= 1,
  },
];

/* ---------------------- small helpers ---------------------- */
const debug = (..._args) => {
  // toggle if needed
  // console.log("[MedalsWidget]", ..._args);
};

const safeArray = (v) => (Array.isArray(v) ? v : []);
const nowIso = () => new Date().toISOString();

/* ---------------------- component ---------------------- */
export default function MedalsWidget({
  user = null,
  compact = false,
  customMedals = null,
  onAward = null,
  autoSaveToFirestore = false, // optional: attempts to call sync.saveLocalMedal if available
  telemetry = null, // optional telemetry object with .track(event, payload)
}) {
  const [awarded, setAwarded] = useState(null); // Set of medal ids
  const [loading, setLoading] = useState(true);
  const [newlyAwarded, setNewlyAwarded] = useState([]); // ids awarded in this session
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(true);

  // Combine default + custom medals (custom can override by id)
  const medals = useMemo(() => {
    const base = DEFAULT_MEDALS.slice();
    if (!customMedals) return base;
    const map = new Map(base.map((m) => [m.id, m]));
    customMedals.forEach((cm) => map.set(cm.id, { ...map.get(cm.id), ...cm }));
    return Array.from(map.values());
  }, [customMedals]);

  /* -------------------------- Load persisted awarded ------------------------- */
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        const userKey = `${STORAGE_KEY}:${user?.uid || user?.id || "local"}`;
        const raw = await AsyncStorage.getItem(userKey);
        let parsed = {};
        if (raw) {
          parsed = JSON.parse(raw);
        }
        if (!mountedRef.current) return;
        setAwarded(parsed || {});
      } catch (e) {
        debug("load persist failed", e);
        setAwarded({});
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, [user?.uid, user?.id]);

  /* ------------------------- Evaluate medal conditions ---------------------- */
  const evaluate = useCallback(
    ({ userObj }) => {
      try {
        if (!userObj) return {};
        const result = {};
        for (const m of medals) {
          try {
            // condition may throw; guard it
            const pass = typeof m.condition === "function" ? !!m.condition({ user: userObj }) : false;
            result[m.id] = pass;
          } catch (e) {
            debug("medal condition error", m.id, e);
            result[m.id] = false;
          }
        }
        return result;
      } catch (e) {
        debug("evaluate error", e);
        return {};
      }
    },
    [medals]
  );

  /* ------------------- Persist awarded locally ------------------- */
  const persistAwarded = useCallback(async (obj) => {
    try {
      const userKey = `${STORAGE_KEY}:${user?.uid || user?.id || "local"}`;
      await AsyncStorage.setItem(userKey, JSON.stringify(obj || {}));
    } catch (e) {
      debug("persistAwarded failed", e);
    }
  }, [user?.uid, user?.id]);

  /* ------------------ Handle awarding logic ------------------ */
  useEffect(() => {
    if (!user || !medals) return;
    // Wait until persisted awarded loaded
    if (awarded === null) return;

    (async () => {
      try {
        const evalMap = evaluate({ userObj: user });
        const newly = [];
        const next = { ...(awarded || {}) };

        for (const m of medals) {
          const ok = !!evalMap[m.id];
          const already = !!next[m.id];
          if (ok && !already) {
            // award it
            next[m.id] = { awardedAt: nowIso() };
            newly.push(m.id);

            // async side-effects
            try {
              // optional telemetry
              if (telemetry && typeof telemetry.track === "function") {
                telemetry.track("medal.awarded", { medalId: m.id, userId: user?.id || user?.uid || null });
              }
            } catch {}

            // optional save to firestore via sync (if implemented)
            if (autoSaveToFirestore && sync && typeof sync.saveLocalMedal === "function") {
              try {
                // non-blocking
                sync.saveLocalMedal({ id: m.id, userId: user?.id ?? user?.uid, date: next[m.id].awardedAt, meta: { label: m.label } }).catch((e) => debug("saveLocalMedal failed", e));
              } catch (e) {
                debug("sync.saveLocalMedal call failed", e);
              }
            }

            // callback
            if (typeof onAward === "function") {
              try {
                onAward(m, user);
              } catch (e) {
                debug("onAward callback error", e);
              }
            }
          }
        }

        if (newly.length > 0) {
          // update local state + persist
          setAwarded(next);
          await persistAwarded(next);
          setNewlyAwarded((prev) => {
            const merged = Array.from(new Set([...(prev || []), ...newly]));
            // start pulse animation
            Animated.sequence([
              Animated.timing(pulseAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
              Animated.timing(pulseAnim, { toValue: 0.6, duration: 350, useNativeDriver: true }),
            ]).start();
            return merged;
          });
        } else {
          // ensure state is synced with persisted version if changed externally
          if (JSON.stringify(awarded) !== JSON.stringify(next)) {
            setAwarded(next);
            await persistAwarded(next);
          }
        }
      } catch (e) {
        debug("award flow error", e);
      }
    })();
  }, [user, medals, awarded, evaluate, persistAwarded, onAward, autoSaveToFirestore, telemetry, pulseAnim]);

  /* ------------------ UI helpers ------------------ */
  const isUnlocked = useCallback((id) => !!(awarded && awarded[id]), [awarded]);
  const isNew = useCallback((id) => newlyAwarded.includes(id), [newlyAwarded]);

  const handlePressMedal = useCallback(
    (m) => {
      // announce to screen reader
      const msg = `${m.label}. ${m.desc}. ${isUnlocked(m.id) ? "Conquistada" : "Não conquistada"}`;
      AccessibilityInfo.announceForAccessibility && AccessibilityInfo.announceForAccessibility(msg);
      // optional: show details modal/tooltip - consumer can hook via onAward or pass custom onPress via medal object
      if (typeof m.onPress === "function") {
        m.onPress({ medal: m, user });
      }
    },
    [user, isUnlocked]
  );

  /* ------------------ Render ------------------ */
  if (loading || awarded === null) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="small" color={WAYPER_ACCENT} />
      </View>
    );
  }

  return (
    <View style={[styles.container, compact && styles.compactContainer]} accessibilityRole="list">
      {medals.map((m) => {
        const unlocked = isUnlocked(m.id);
        const justNow = isNew(m.id);
        const glow = pulseAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.12],
        });

        return (
          <TouchableOpacity
            key={m.id}
            style={styles.medalBox}
            onPress={() => handlePressMedal(m)}
            accessibilityRole="button"
            accessibilityLabel={`${m.label} — ${unlocked ? "Conquistada" : "Não conquistada"}`}
          >
            <Animated.View style={[styles.iconWrapper, unlocked && styles.iconGlow, justNow && { transform: [{ scale: glow }] }]}>
              <Image
                source={typeof m.icon === "string" ? { uri: m.icon } : m.icon}
                style={[styles.icon, !unlocked && styles.iconLocked]}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </Animated.View>

            <Text style={[styles.label, unlocked ? styles.labelOn : styles.labelOff]} numberOfLines={1}>
              {m.label}
            </Text>

            {!compact && (
              <Text style={[styles.desc, unlocked ? styles.descOn : styles.descOff]} numberOfLines={1}>
                {m.desc}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ---------------------- styles ---------------------- */
const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    backgroundColor: colors.backgroundCard || "#0b151d",
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderColor: colors.border || "#12333f",
    borderWidth: 1,
    marginTop: 12,
  },

  compactContainer: { paddingVertical: 6 },

  loadingBox: {
    paddingVertical: 20,
    alignItems: "center",
  },

  medalBox: {
    width: `${100 / 3}%`, // support 3 across; custom styling possible via container
    alignItems: "center",
  },

  iconWrapper: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.background || "#08141b",
    justifyContent: "center",
    alignItems: "center",
    borderColor: colors.border || "#12333f",
    borderWidth: 1.2,
    marginBottom: 6,
  },

  iconGlow: {
    shadowColor: WAYPER_ACCENT,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },

  icon: {
    width: 30,
    height: 30,
  },

  iconLocked: {
    opacity: 0.28,
  },

  label: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  labelOn: { color: colors.accent || WAYPER_ACCENT },
  labelOff: { color: colors.textMuted || "#7a8b94" },

  desc: {
    fontSize: 11,
    marginTop: 2,
    textAlign: "center",
  },
  descOn: { color: colors.textMain || "#e6f1f5" },
  descOff: { color: colors.textSoft || "#9aa6ad" },
});
