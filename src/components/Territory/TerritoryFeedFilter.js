import React from "react";
import { StyleSheet, View } from "react-native";
import { WPChip } from "../ui";
import { WayperTheme } from "../../theme/wayperTheme";

export const TERRITORY_FEED_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "free", label: "Corridas" },
  { id: "captures", label: "Capturas", color: "cyan" },
  { id: "steals", label: "Roubos", color: "cyan" },
  { id: "leaders", label: "Liderancas" },
];

function TerritoryFeedFilter({ value = "all", onChange }) {
  return (
    <View style={styles.filterRow}>
      {TERRITORY_FEED_FILTERS.map((filter) => (
        <WPChip
          key={filter.id}
          label={filter.label}
          active={value === filter.id}
          onPress={() => onChange?.(filter.id)}
          color={filter.color}
        />
      ))}
    </View>
  );
}

export default React.memo(TerritoryFeedFilter);

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.sm,
  },
});
