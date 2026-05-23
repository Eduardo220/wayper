import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import WayperMapLibre, { WAYPER_FALLBACK_COORD } from "../Map/WayperMapLibre";
import { WPCard, WPButton } from "../ui";
import { WayperTheme } from "../../theme/wayperTheme";

const safeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const formatArea = (areaM2 = 0) => {
  const area = Math.max(0, safeNumber(areaM2));
  if (area >= 1000000) return `${(area / 1000000).toFixed(2)} km2`;
  return `${Math.round(area).toLocaleString("pt-BR")} m2`;
};

const formatDate = (value) => {
  try {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "Agora";
    return date.toLocaleString();
  } catch {
    return "Agora";
  }
};

function getEventVisual(item = {}) {
  if (item.__type === "territory_steal") {
    return {
      icon: "repeat-outline",
      accent: "cyan",
      color: WayperTheme.colors.cyan,
      cta: "Ver no mapa",
    };
  }

  if (item.__type === "territory_leader_changed") {
    return {
      icon: "flag-outline",
      accent: "green",
      color: WayperTheme.colors.primary,
      cta: "Disputar area",
    };
  }

  if (item.__type === "territory_conquered") {
    return {
      icon: "trophy-outline",
      accent: "cyan",
      color: WayperTheme.colors.cyan,
      cta: "Ver no mapa",
    };
  }

  return {
    icon: "map-outline",
    accent: "cyan",
    color: WayperTheme.colors.cyan,
    cta: "Ver no mapa",
  };
}

function buildPreviewTerritory(item = {}) {
  if (!item.geometry) return null;
  return {
    id: item.territoryId || item.id,
    ownerId: item.userId,
    ownerName: item.userName,
    geometry: item.geometry,
    areaM2: item.areaM2,
    status: "active",
  };
}

function pickCenter(item = {}) {
  const coords = Array.isArray(item.coordsPreview) ? item.coordsPreview : [];
  return coords[0] || item.raw?.center || WAYPER_FALLBACK_COORD;
}

function TerritoryEventCard({ item, onPress, onViewMap }) {
  const visual = useMemo(() => getEventVisual(item), [item]);
  const previewTerritory = useMemo(() => buildPreviewTerritory(item), [item]);
  const coordsPreview = Array.isArray(item?.coordsPreview) ? item.coordsPreview : [];
  const canPreview = Boolean(previewTerritory || coordsPreview.length >= 3);

  if (!item) return null;

  return (
    <Pressable onPress={() => onPress?.(item)} style={styles.cardPressable}>
      <WPCard style={styles.card} accent={visual.accent} glow={canPreview}>
        <View style={styles.cardHeader}>
          <View style={[styles.eventIcon, { backgroundColor: visual.color }]}>
            <Ionicons name={visual.icon} size={21} color={WayperTheme.colors.textInverse} />
          </View>
          <View style={styles.cardTitleWrap}>
            <Text style={[styles.eventTitle, { color: visual.color }]}>{item.title}</Text>
            <Text style={styles.date}>{item.subtitle || formatDate(item.date)}</Text>
          </View>
          <Text style={[styles.areaText, { color: visual.color }]}>{formatArea(item.areaM2)}</Text>
        </View>

        {canPreview ? (
          <View pointerEvents="none" style={styles.preview}>
            <WayperMapLibre
              style={styles.previewMap}
              territories={previewTerritory ? [previewTerritory] : []}
              zones={!previewTerritory && coordsPreview.length >= 3 ? [{ coords: coordsPreview, area: item.areaM2 }] : []}
              showTerritories={Boolean(previewTerritory)}
              showZones={!previewTerritory && coordsPreview.length >= 3}
              showLeaderAreas={false}
              showUserLocation={false}
              centerCoordinate={pickCenter(item)}
              interactive={false}
              fitToContent
              contentPadding={{ top: 38, right: 38, bottom: 38, left: 38 }}
            />
          </View>
        ) : null}

        <View style={styles.metaRow}>
          <View style={styles.metaPill}>
            <Text style={styles.metaLabel}>Atleta</Text>
            <Text style={styles.metaValue} numberOfLines={1}>{item.userName || "Atleta Wayper"}</Text>
          </View>
          {item.targetUserName ? (
            <View style={styles.metaPill}>
              <Text style={styles.metaLabel}>Disputa</Text>
              <Text style={styles.metaValue} numberOfLines={1}>{item.targetUserName}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.visibilityText}>{item.visibility || "followers"}</Text>
          <WPButton title={visual.cta} compact onPress={() => onViewMap?.(item)} />
        </View>
      </WPCard>
    </Pressable>
  );
}

export default React.memo(TerritoryEventCard);

const styles = StyleSheet.create({
  cardPressable: {
    borderRadius: WayperTheme.radius.xxl,
  },
  card: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  eventIcon: {
    width: 46,
    height: 46,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitleWrap: {
    flex: 1,
    marginHorizontal: WayperTheme.spacing.md,
  },
  eventTitle: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "900",
  },
  date: {
    ...WayperTheme.typography.caption,
    marginTop: WayperTheme.spacing.xs,
  },
  areaText: {
    fontSize: 13,
    fontWeight: "900",
  },
  preview: {
    height: 132,
    borderRadius: WayperTheme.radius.lg,
    overflow: "hidden",
    marginTop: WayperTheme.spacing.lg,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  previewMap: {
    flex: 1,
  },
  metaRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.lg,
  },
  metaPill: {
    flex: 1,
    minHeight: 58,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.md,
  },
  metaLabel: {
    ...WayperTheme.typography.caption,
  },
  metaValue: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 2,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: WayperTheme.spacing.lg,
    gap: WayperTheme.spacing.md,
  },
  visibilityText: {
    ...WayperTheme.typography.caption,
    color: WayperTheme.colors.textMuted,
  },
});
