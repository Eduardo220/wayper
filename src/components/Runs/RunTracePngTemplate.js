import React, { forwardRef, useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Polygon, Polyline, Stop } from "react-native-svg";

import { SvgRunFinishMarker, SvgRunStartMarker } from "../Map/RunRouteMarkers";
import { WayperTheme } from "../../theme/wayperTheme";
import { getRenderableTraceSource } from "../../utils/runShareImage";

export const RUN_TRACE_PNG_SIZE = {
  width: 1080,
  height: 1080,
};

const TRACE_VIEWBOX = {
  width: 900,
  height: 650,
};
const WAYPER_LOGO = require("../../../assets/logo.png");

const closePolygon = (points = []) => {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.latitude === last.latitude && first.longitude === last.longitude) {
    return points;
  }
  return points.concat(first);
};

const buildTracePoints = (coords = [], { closed = false, padding = 64 } = {}) => {
  const source = closed ? closePolygon(coords) : coords;
  const minPoints = closed ? 4 : 2;

  if (!Array.isArray(source) || source.length < minPoints) {
    return { points: "", hasShape: false };
  }

  const avgLat = source.reduce((sum, point) => sum + point.latitude, 0) / source.length;
  const lngScale = Math.max(0.2, Math.cos((avgLat * Math.PI) / 180));
  const projected = source.map((point) => ({
    x: point.longitude * lngScale,
    y: point.latitude,
  }));

  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 0.000001);
  const rangeY = Math.max(maxY - minY, 0.000001);
  const drawWidth = TRACE_VIEWBOX.width - padding * 2;
  const drawHeight = TRACE_VIEWBOX.height - padding * 2;
  const scale = Math.min(drawWidth / rangeX, drawHeight / rangeY);
  const shapeWidth = rangeX * scale;
  const shapeHeight = rangeY * scale;
  const offsetX = (TRACE_VIEWBOX.width - shapeWidth) / 2;
  const offsetY = (TRACE_VIEWBOX.height - shapeHeight) / 2;

  return {
    hasShape: true,
    points: projected
      .map((point) => {
        const x = offsetX + (point.x - minX) * scale;
        const y = offsetY + (1 - (point.y - minY) / rangeY) * shapeHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" "),
  };
};

const buildTraceSegmentShapes = (segments = [], { padding = 64 } = {}) => {
  const cleanSegments = (Array.isArray(segments) ? segments : []).filter((segment) => Array.isArray(segment) && segment.length >= 2);
  const allPoints = cleanSegments.flat();
  if (allPoints.length < 2) return [];

  const avgLat = allPoints.reduce((sum, point) => sum + point.latitude, 0) / allPoints.length;
  const lngScale = Math.max(0.2, Math.cos((avgLat * Math.PI) / 180));
  const projectedSegments = cleanSegments.map((segment) =>
    segment.map((point) => ({
      x: point.longitude * lngScale,
      y: point.latitude,
    }))
  );
  const projected = projectedSegments.flat();
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 0.000001);
  const rangeY = Math.max(maxY - minY, 0.000001);
  const drawWidth = TRACE_VIEWBOX.width - padding * 2;
  const drawHeight = TRACE_VIEWBOX.height - padding * 2;
  const scale = Math.min(drawWidth / rangeX, drawHeight / rangeY);
  const shapeWidth = rangeX * scale;
  const shapeHeight = rangeY * scale;
  const offsetX = (TRACE_VIEWBOX.width - shapeWidth) / 2;
  const offsetY = (TRACE_VIEWBOX.height - shapeHeight) / 2;

  return projectedSegments.map((segment) =>
    segment
      .map((point) => {
        const x = offsetX + (point.x - minX) * scale;
        const y = offsetY + (1 - (point.y - minY) / rangeY) * shapeHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ")
  );
};

const parseSvgPoint = (pointText) => {
  const [x, y] = String(pointText || "").split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
};

const getSvgBoundaryPoints = (segmentShapes = [], shapePoints = "") => {
  const shapes = segmentShapes.length > 0 ? segmentShapes : (shapePoints ? [shapePoints] : []);
  const firstShape = shapes[0] || "";
  const lastShape = shapes[shapes.length - 1] || "";
  const firstTokens = firstShape.split(" ").filter(Boolean);
  const lastTokens = lastShape.split(" ").filter(Boolean);
  const start = parseSvgPoint(firstTokens[0]);
  const finish = parseSvgPoint(lastTokens[lastTokens.length - 1]);
  if (!start) return null;

  const distance = finish
    ? Math.hypot(start.x - finish.x, start.y - finish.y)
    : 0;

  return {
    start,
    finish: distance > 3 ? finish : null,
  };
};

const Metric = ({ label, value }) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
);

const RunTracePngTemplate = forwardRef(function RunTracePngTemplate(
  {
    path = [],
    segments = [],
    zoneCoords = [],
    isZone = false,
    title = "Corrida Wayper",
    distance = "0.00 km",
    duration = "--:--",
    pace = "--:--/km",
    area = "0 m2",
    style,
  },
  ref
) {
  const source = useMemo(
    () => getRenderableTraceSource({ path, segments, zoneCoords, isZone }),
    [isZone, path, segments, zoneCoords]
  );
  const isZoneShape = source.type === "zone";
  const segmentShapes = useMemo(
    () => (!isZoneShape ? buildTraceSegmentShapes(source.segments, { padding: 70 }) : []),
    [isZoneShape, source.segments]
  );
  const shape = useMemo(
    () => buildTracePoints(source.points, { closed: isZoneShape, padding: isZoneShape ? 86 : 70 }),
    [isZoneShape, source.points]
  );
  const routeMarkerPoints = useMemo(
    () => (!isZoneShape && (shape.hasShape || segmentShapes.length > 0) ? getSvgBoundaryPoints(segmentShapes, shape.points) : null),
    [isZoneShape, segmentShapes, shape.hasShape, shape.points]
  );

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.root, { width: RUN_TRACE_PNG_SIZE.width, height: RUN_TRACE_PNG_SIZE.height }, style]}
    >
      <View style={styles.brandRow}>
        <View style={styles.titleColumn}>
          <Text style={styles.eyebrow}>Wayper</Text>
          <Text style={styles.title} numberOfLines={2}>{title || "Corrida Wayper"}</Text>
        </View>
        <View style={styles.mark}>
          <Image source={WAYPER_LOGO} style={styles.markLogo} resizeMode="contain" />
        </View>
      </View>

      <View style={styles.artwork}>
        {shape.hasShape ? (
          <Svg width="100%" height="100%" viewBox={`0 0 ${TRACE_VIEWBOX.width} ${TRACE_VIEWBOX.height}`}>
            <Defs>
              <LinearGradient id="wayperTracePngStroke" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={WayperTheme.colors.primaryLight} stopOpacity="1" />
                <Stop offset="0.58" stopColor={WayperTheme.colors.primary} stopOpacity="1" />
                <Stop offset="1" stopColor={WayperTheme.colors.cyan} stopOpacity="0.92" />
              </LinearGradient>
            </Defs>
            {segmentShapes.length > 0 ? (
              <>
                {segmentShapes.map((points, index) => (
                  <Polyline
                    key={`trace-glow-${index}`}
                    points={points}
                    fill="none"
                    stroke="rgba(0, 230, 118, 0.34)"
                    strokeWidth="70"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {segmentShapes.map((points, index) => (
                  <Polyline
                    key={`trace-line-${index}`}
                    points={points}
                    fill="none"
                    stroke="url(#wayperTracePngStroke)"
                    strokeWidth="30"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </>
            ) : isZoneShape ? (
              <>
                <Polygon
                  points={shape.points}
                  fill="rgba(0, 230, 118, 0.18)"
                  stroke="rgba(0, 230, 118, 0.36)"
                  strokeWidth="62"
                  strokeLinejoin="round"
                />
                <Polygon
                  points={shape.points}
                  fill="rgba(0, 230, 118, 0.24)"
                  stroke="url(#wayperTracePngStroke)"
                  strokeWidth="28"
                  strokeLinejoin="round"
                />
              </>
            ) : (
              <>
                <Polyline
                  points={shape.points}
                  fill="none"
                  stroke="rgba(0, 230, 118, 0.34)"
                  strokeWidth="70"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Polyline
                  points={shape.points}
                  fill="none"
                  stroke="url(#wayperTracePngStroke)"
                  strokeWidth="30"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            )}
            {routeMarkerPoints ? (
              <>
                <SvgRunStartMarker x={routeMarkerPoints.start.x} y={routeMarkerPoints.start.y} outerRadius={24} innerRadius={13} />
                {routeMarkerPoints.finish ? (
                  <SvgRunFinishMarker
                    x={routeMarkerPoints.finish.x}
                    y={routeMarkerPoints.finish.y}
                    radius={29}
                    clipId="wayperTracePngFinishMarkerClip"
                  />
                ) : null}
              </>
            ) : null}
          </Svg>
        ) : (
          <View style={styles.emptyTrace}>
            <Text style={styles.emptyTraceText}>Traçado indisponível para esta corrida.</Text>
          </View>
        )}
      </View>

      <View style={styles.metrics}>
        {isZoneShape ? <Metric label="Área" value={area} /> : <Metric label="Distância" value={distance} />}
        <Metric label="Tempo" value={duration} />
        <Metric label="Ritmo" value={pace} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    padding: 72,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  brandRow: {
    minHeight: 118,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 34,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  titleColumn: {
    flex: 1,
    paddingRight: 28,
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 70,
    fontWeight: "900",
    marginTop: 8,
  },
  mark: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  markLogo: {
    width: "100%",
    height: "100%",
  },
  artwork: {
    flex: 1,
    marginTop: 38,
    justifyContent: "center",
  },
  emptyTrace: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 56,
  },
  emptyTraceText: {
    color: WayperTheme.colors.text,
    fontSize: 42,
    fontWeight: "900",
    textAlign: "center",
  },
  metrics: {
    flexDirection: "row",
    gap: 22,
    marginTop: 44,
  },
  metric: {
    flex: 1,
    minHeight: 124,
    justifyContent: "center",
  },
  metricValue: {
    color: WayperTheme.colors.primary,
    fontSize: 40,
    fontWeight: "900",
  },
  metricLabel: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
    marginTop: 8,
    textTransform: "uppercase",
  },
});

export default RunTracePngTemplate;
