import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Rect,
} from "react-native-svg";

import { WayperTheme } from "../../theme/wayperTheme";

const START_MARKER_SIZE = 20;
const FINISH_MARKER_SIZE = 32;
const FINISH_CHECKER_SIZE = 24;
const CHECKER_GRID_SIZE = 4;
const CHECKER_CELL_SIZE = FINISH_CHECKER_SIZE / CHECKER_GRID_SIZE;

const checkerCells = Array.from({ length: CHECKER_GRID_SIZE * CHECKER_GRID_SIZE }, (_, index) => {
  const row = Math.floor(index / CHECKER_GRID_SIZE);
  const col = index % CHECKER_GRID_SIZE;
  return { row, col, dark: (row + col) % 2 === 0 };
});

export function RunStartMarker() {
  return (
    <View collapsable={false} style={styles.startMarker}>
      <View style={styles.startMarkerCore} />
    </View>
  );
}

export function RunFinishMarker() {
  return (
    <View collapsable={false} style={styles.finishMarker}>
      <Svg
        width={FINISH_CHECKER_SIZE}
        height={FINISH_CHECKER_SIZE}
        viewBox={`0 0 ${FINISH_CHECKER_SIZE} ${FINISH_CHECKER_SIZE}`}
      >
        <Defs>
          <ClipPath id="wayperFinishMarkerClip">
            <Circle cx="12" cy="12" r="12" />
          </ClipPath>
        </Defs>
        <G clipPath="url(#wayperFinishMarkerClip)">
          <Rect width="24" height="24" fill="#f8faf8" />
          {checkerCells.map(({ row, col, dark }) => (
            dark ? (
              <Rect
                key={`${row}-${col}`}
                x={col * CHECKER_CELL_SIZE}
                y={row * CHECKER_CELL_SIZE}
                width={CHECKER_CELL_SIZE}
                height={CHECKER_CELL_SIZE}
                fill="#031009"
              />
            ) : null
          ))}
        </G>
        <Circle cx="12" cy="12" r="11.6" fill="none" stroke="rgba(3, 16, 9, 0.28)" strokeWidth="1" />
      </Svg>
    </View>
  );
}

export function SvgRunStartMarker({ x, y, outerRadius = 8, innerRadius = 4.6 }) {
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;

  return (
    <>
      <Circle cx={x} cy={y} r={outerRadius} fill="#ecfff6" stroke="rgba(3, 16, 9, 0.7)" strokeWidth="1.4" />
      <Circle cx={x} cy={y} r={innerRadius} fill={WayperTheme.colors.primary} />
    </>
  );
}

export function SvgRunFinishMarker({
  x,
  y,
  radius = 11,
  clipId = "wayperSvgRunFinishMarkerClip",
}) {
  const centerX = Number(x);
  const centerY = Number(y);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;

  const innerRadius = Math.max(4, radius - 2.2);
  const diameter = innerRadius * 2;
  const cell = diameter / CHECKER_GRID_SIZE;
  const startX = centerX - innerRadius;
  const startY = centerY - innerRadius;

  return (
    <>
      <Defs>
        <ClipPath id={clipId}>
          <Circle cx={centerX} cy={centerY} r={innerRadius} />
        </ClipPath>
      </Defs>
      <Circle cx={centerX} cy={centerY} r={radius} fill="#ecfff6" stroke="rgba(3, 16, 9, 0.78)" strokeWidth="1.5" />
      <G clipPath={`url(#${clipId})`}>
        <Rect x={startX} y={startY} width={diameter} height={diameter} fill="#f8faf8" />
        {checkerCells.map(({ row, col, dark }) => (
          dark ? (
            <Rect
              key={`${clipId}-${row}-${col}`}
              x={startX + col * cell}
              y={startY + row * cell}
              width={cell}
              height={cell}
              fill="#031009"
            />
          ) : null
        ))}
      </G>
      <Circle cx={centerX} cy={centerY} r={innerRadius} fill="none" stroke="rgba(3, 16, 9, 0.28)" strokeWidth="0.9" />
    </>
  );
}

const styles = StyleSheet.create({
  startMarker: {
    width: START_MARKER_SIZE,
    height: START_MARKER_SIZE,
    borderRadius: START_MARKER_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ecfff6",
    borderWidth: 1,
    borderColor: "rgba(3, 16, 9, 0.72)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  startMarkerCore: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: WayperTheme.colors.primary,
  },
  finishMarker: {
    width: FINISH_MARKER_SIZE,
    height: FINISH_MARKER_SIZE,
    borderRadius: FINISH_MARKER_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ecfff6",
    borderWidth: 1.5,
    borderColor: "rgba(3, 16, 9, 0.82)",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 5,
  },
});
