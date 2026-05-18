import React from "react";
import { StyleSheet, View } from "react-native";

function TransparentPreviewBackground({ children, style }) {
  return (
    <View style={[styles.root, style]}>
      <View pointerEvents="none" style={styles.pattern}>
        {Array.from({ length: 18 }).map((_, row) => (
          <View style={styles.row} key={`checker-row-${row}`}>
            {Array.from({ length: 14 }).map((__, col) => (
              <View
                key={`checker-${row}-${col}`}
                style={[
                  styles.square,
                  (row + col) % 2 === 0 ? styles.squareA : styles.squareB,
                ]}
              />
            ))}
          </View>
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: "hidden",
    backgroundColor: "#10181D",
  },
  pattern: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  row: {
    flexDirection: "row",
  },
  square: {
    width: 28,
    height: 28,
  },
  squareA: {
    backgroundColor: "#111C22",
  },
  squareB: {
    backgroundColor: "#1A252B",
  },
});

export default TransparentPreviewBackground;
