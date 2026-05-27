import React, { forwardRef, useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Polyline,
  Rect,
  Stop,
} from "react-native-svg";
import WayperMapLibre, { WAYPER_FALLBACK_COORD } from "../Map/WayperMapLibre";
import { SvgRunFinishMarker, SvgRunStartMarker } from "../Map/RunRouteMarkers";
import { WayperTheme } from "../../theme/wayperTheme";
import { getRunBoundaryPoints } from "../../services/runTracking";

export const RUN_SHARE_CARD_SIZE = {
  card: { width: 1080, height: 1350 },
  trace: { width: 1080, height: 1080 },
};

const CARD_VIEWBOX = { width: 1080, height: 760 };
const TRACE_VIEWBOX = { width: 900, height: 620 };
const WAYPER_LOGO = require("../../../assets/logo.png");
const MAX_MERCATOR_LATITUDE = 85.05112878;

const safeNumber = (value, fallback = NaN) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeCoord = (coord) => {
  if (!coord) return null;

  if (Array.isArray(coord)) {
    const first = safeNumber(coord[0]);
    const second = safeNumber(coord[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

    const looksLatLng = Math.abs(first) <= 90 && Math.abs(second) <= 180;
    const latitude = looksLatLng ? first : second;
    const longitude = looksLatLng ? second : first;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { latitude, longitude };
  }

  const latitude = safeNumber(coord.latitude ?? coord.lat ?? coord.coords?.latitude);
  const longitude = safeNumber(coord.longitude ?? coord.lon ?? coord.lng ?? coord.coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude };
};

const normalizeCoords = (coords = []) =>
  (Array.isArray(coords) ? coords : [])
    .map(normalizeCoord)
    .filter(Boolean);

const normalizeSegments = (segments = []) =>
  (Array.isArray(segments) ? segments : [])
    .map((segment) =>
      normalizeCoords(
        Array.isArray(segment)
          ? segment
          : segment?.displayPoints ||
              segment?.summaryRenderPath ||
              segment?.renderPath ||
              segment?.displayPath ||
              segment?.filteredPoints ||
              segment?.trustedPath ||
              []
      )
    )
    .filter((segment) => segment.length >= 2);

const closePolygon = (coords = []) => {
  if (coords.length < 3) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first.latitude === last.latitude && first.longitude === last.longitude) return coords;
  return coords.concat(first);
};

const projectCoord = (point) => {
  const latitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, point.latitude));
  const latRad = (latitude * Math.PI) / 180;
  return {
    x: point.longitude,
    y: Math.log(Math.tan(Math.PI / 4 + latRad / 2)),
  };
};

const buildSvgPoints = (coords = [], { width, height, padding = 72, closed = false } = {}) => {
  const clean = normalizeCoords(coords);
  if (clean.length === 0) return { points: "", hasShape: false };

  const points = closed ? closePolygon(clean) : clean;
  if (points.length < (closed ? 4 : 2)) {
    const only = points[0];
    return {
      points: `${width / 2},${height / 2}`,
      dot: only ? { x: width / 2, y: height / 2 } : null,
      hasShape: false,
    };
  }

  const projected = points.map(projectCoord);

  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 0.000001);
  const rangeY = Math.max(maxY - minY, 0.000001);
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;
  const scale = Math.min(drawWidth / rangeX, drawHeight / rangeY);
  const shapeWidth = rangeX * scale;
  const shapeHeight = rangeY * scale;
  const offsetX = (width - shapeWidth) / 2;
  const offsetY = (height - shapeHeight) / 2;

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

const buildSvgSegmentShapes = (segments = [], { width, height, padding = 72 } = {}) => {
  const cleanSegments = normalizeSegments(segments);
  const allPoints = cleanSegments.flat();
  if (allPoints.length < 2) return [];

  const projectedSegments = cleanSegments.map((segment) => segment.map(projectCoord));
  const projected = projectedSegments.flat();
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 0.000001);
  const rangeY = Math.max(maxY - minY, 0.000001);
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;
  const scale = Math.min(drawWidth / rangeX, drawHeight / rangeY);
  const shapeWidth = rangeX * scale;
  const shapeHeight = rangeY * scale;
  const offsetX = (width - shapeWidth) / 2;
  const offsetY = (height - shapeHeight) / 2;

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

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Artwork({ mode, coords, segments = [], isZone }) {
  const viewBox = mode === "trace" ? TRACE_VIEWBOX : CARD_VIEWBOX;
  const segmentShapes = useMemo(
    () =>
      !isZone
        ? buildSvgSegmentShapes(segments, {
            width: viewBox.width,
            height: viewBox.height,
            padding: mode === "trace" ? 120 : 110,
          })
        : [],
    [isZone, mode, segments, viewBox.height, viewBox.width]
  );
  const shape = useMemo(
    () =>
      buildSvgPoints(coords, {
        width: viewBox.width,
        height: viewBox.height,
        padding: mode === "trace" ? 120 : 110,
        closed: isZone,
      }),
    [coords, isZone, mode, viewBox.height, viewBox.width]
  );
  const routeMarkerPoints = useMemo(
    () => (!isZone && (shape.hasShape || segmentShapes.length > 0) ? getSvgBoundaryPoints(segmentShapes, shape.points) : null),
    [isZone, segmentShapes, shape.hasShape, shape.points]
  );

  const gradientId = mode === "trace" ? "wayperTraceGradient" : "wayperCardGradient";
  const glowId = mode === "trace" ? "wayperTraceGlow" : "wayperCardGlow";

  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={WayperTheme.colors.primaryLight} stopOpacity="1" />
          <Stop offset="0.52" stopColor={WayperTheme.colors.primary} stopOpacity="1" />
          <Stop offset="1" stopColor={WayperTheme.colors.cyan} stopOpacity="0.92" />
        </LinearGradient>
        <LinearGradient id={glowId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={WayperTheme.colors.primary} stopOpacity="0.52" />
          <Stop offset="1" stopColor={WayperTheme.colors.cyan} stopOpacity="0.22" />
        </LinearGradient>
      </Defs>

      <Rect x="0" y="0" width={viewBox.width} height={viewBox.height} fill={WayperTheme.colors.background} />
      <Path d={`M0 ${viewBox.height * 0.16} L${viewBox.width * 0.28} ${viewBox.height * 0.03} L${viewBox.width * 0.56} ${viewBox.height * 0.22} L${viewBox.width} ${viewBox.height * 0.08} L${viewBox.width} 0 L0 0 Z`} fill="#0B141D" opacity="0.92" />
      <Path d={`M0 ${viewBox.height * 0.86} L${viewBox.width * 0.24} ${viewBox.height * 0.72} L${viewBox.width * 0.56} ${viewBox.height * 0.92} L${viewBox.width} ${viewBox.height * 0.76} L${viewBox.width} ${viewBox.height} L0 ${viewBox.height} Z`} fill="#081018" opacity="0.96" />
      <Line x1={-80} y1={viewBox.height * 0.26} x2={viewBox.width + 80} y2={viewBox.height * 0.52} stroke="#263542" strokeWidth={mode === "trace" ? 36 : 30} opacity="0.58" />
      <Line x1={-80} y1={viewBox.height * 0.26} x2={viewBox.width + 80} y2={viewBox.height * 0.52} stroke="#6F7A86" strokeWidth={mode === "trace" ? 8 : 6} opacity="0.24" />
      <Line x1={viewBox.width * 0.17} y1={viewBox.height + 80} x2={viewBox.width * 0.78} y2={-80} stroke="#263542" strokeWidth={mode === "trace" ? 30 : 22} opacity="0.40" />
      <Line x1={viewBox.width * 0.17} y1={viewBox.height + 80} x2={viewBox.width * 0.78} y2={-80} stroke="#6F7A86" strokeWidth={mode === "trace" ? 7 : 5} opacity="0.18" />

      {segmentShapes.length > 0 ? (
        <>
          {segmentShapes.map((points, index) => (
            <Polyline key={`segment-glow-${index}`} points={points} fill="none" stroke={`url(#${glowId})`} strokeWidth={mode === "trace" ? 54 : 42} strokeLinecap="round" strokeLinejoin="round" opacity="0.58" />
          ))}
          {segmentShapes.map((points, index) => (
            <Polyline key={`segment-line-${index}`} points={points} fill="none" stroke={`url(#${gradientId})`} strokeWidth={mode === "trace" ? 24 : 17} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </>
      ) : shape.hasShape && isZone ? (
        <>
          <Polygon points={shape.points} fill="rgba(0, 230, 118, 0.18)" stroke={`url(#${glowId})`} strokeWidth={mode === "trace" ? 54 : 44} strokeLinejoin="round" opacity="0.64" />
          <Polygon points={shape.points} fill="rgba(0, 230, 118, 0.30)" stroke={`url(#${gradientId})`} strokeWidth={mode === "trace" ? 24 : 18} strokeLinejoin="round" />
        </>
      ) : shape.hasShape ? (
        <>
          <Polyline points={shape.points} fill="none" stroke={`url(#${glowId})`} strokeWidth={mode === "trace" ? 54 : 42} strokeLinecap="round" strokeLinejoin="round" opacity="0.58" />
          <Polyline points={shape.points} fill="none" stroke={`url(#${gradientId})`} strokeWidth={mode === "trace" ? 24 : 17} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <Circle cx={viewBox.width / 2} cy={viewBox.height / 2} r={mode === "trace" ? 42 : 32} fill={WayperTheme.colors.primary} opacity="0.96" />
      )}

      {routeMarkerPoints ? (
        <>
          <SvgRunStartMarker x={routeMarkerPoints.start.x} y={routeMarkerPoints.start.y} outerRadius={mode === "trace" ? 18 : 13} innerRadius={mode === "trace" ? 10 : 7} />
          {routeMarkerPoints.finish ? (
            <SvgRunFinishMarker
              x={routeMarkerPoints.finish.x}
              y={routeMarkerPoints.finish.y}
              radius={mode === "trace" ? 22 : 16}
              clipId={`${gradientId}FinishMarkerClip`}
            />
          ) : null}
        </>
      ) : null}
    </Svg>
  );
}

function getArtworkCenter(coords = []) {
  if (!Array.isArray(coords) || coords.length === 0) return WAYPER_FALLBACK_COORD;
  return coords[Math.floor(coords.length / 2)] || coords[0] || WAYPER_FALLBACK_COORD;
}

function MapArtwork({ coords = [], routeCoords = [], segments = [], isZone = false, area = "0 m2", mapStyle }) {
  const zones = isZone && coords.length >= 3 ? [{ coords, area }] : [];
  const endpointPath = routeCoords.length > 0 ? routeCoords : (isZone ? [] : coords);
  const routeBoundary = useMemo(
    () => getRunBoundaryPoints(endpointPath.length > 0 ? endpointPath : segments, { fallbackPath: endpointPath }),
    [endpointPath, segments]
  );

  return (
    <WayperMapLibre
      style={styles.mapArtwork}
      routePath={isZone ? [] : coords}
      routeSegments={isZone ? [] : segments}
      routeMode="share"
      zones={zones}
      showZones={isZone}
      showUserLocation={false}
      showTerritories={false}
      showLeaderAreas={false}
      interactive={false}
      fitToContent={coords.length > 1}
      centerCoordinate={getArtworkCenter(coords)}
      showRouteEndpoints={routeBoundary.hasStart}
      routeStartCoordinate={routeBoundary.start}
      routeEndCoordinate={routeBoundary.finishCandidate}
      contentPadding={{ top: 82, right: 78, bottom: 82, left: 78 }}
      mapStyle={mapStyle}
    />
  );
}

const RunShareCard = forwardRef(function RunShareCard(
  {
    mode = "card",
    path = [],
    segments = [],
    zoneCoords = [],
    isZone = false,
    title = "Corrida Wayper",
    subtitle,
    distance = "0.00 km",
    duration = "0:00",
    pace = "--",
    date = "",
    area = "0 m2",
    mapStyle,
    style,
  },
  ref
) {
  const size = RUN_SHARE_CARD_SIZE[mode] || RUN_SHARE_CARD_SIZE.card;
  const routeCoords = normalizeCoords(path);
  const segmentCoords = normalizeSegments(segments);
  const zoneShape = normalizeCoords(zoneCoords);
  const useZoneShape = Boolean(isZone && (zoneShape.length >= 3 || routeCoords.length >= 3));
  const artworkCoords = useZoneShape ? (zoneShape.length >= 3 ? zoneShape : routeCoords) : routeCoords;
  const displayTitle = title || "Corrida Wayper";
  const displaySubtitle = subtitle && subtitle !== displayTitle
    ? subtitle
    : (useZoneShape ? "Corrida por zonas" : "Corrida livre");

  if (mode === "trace") {
    return (
      <View ref={ref} collapsable={false} style={[styles.root, styles.traceRoot, { width: size.width, height: size.height }, style]}>
        <View style={styles.traceHeader}>
          <View style={styles.traceTitleColumn}>
            <Text style={styles.traceEyebrow}>Wayper Trace</Text>
            <Text style={styles.traceTitle} numberOfLines={2}>{displayTitle}</Text>
          </View>
          <View style={styles.traceBadge}>
            <Image source={WAYPER_LOGO} style={styles.shareLogoImage} resizeMode="contain" />
          </View>
        </View>

        <View style={styles.traceArtwork}>
          <Artwork mode="trace" coords={artworkCoords} segments={segmentCoords} isZone={useZoneShape} />
        </View>

        <View style={styles.traceMetrics}>
          <Metric label="km" value={distance} />
          <Metric label="tempo" value={duration} />
          <Metric label="pace" value={pace} />
        </View>
      </View>
    );
  }

  return (
    <View ref={ref} collapsable={false} style={[styles.root, styles.cardRoot, { width: size.width, height: size.height }, style]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleColumn}>
          <Text style={styles.cardEyebrow}>Wayper finalizado</Text>
          <Text style={styles.cardTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62}>
            {displayTitle}
          </Text>
          <Text style={styles.cardSubtitle}>{displaySubtitle}</Text>
        </View>
        <View style={styles.logoMark}>
          <Image source={WAYPER_LOGO} style={styles.shareLogoImage} resizeMode="contain" />
        </View>
      </View>

      <View collapsable={false} style={styles.cardArtwork}>
        <MapArtwork coords={artworkCoords} routeCoords={routeCoords} segments={segmentCoords} isZone={useZoneShape} area={area} mapStyle={mapStyle} />
      </View>

      <View style={styles.cardInfo}>
        <Text style={styles.runName} numberOfLines={2}>{displaySubtitle}</Text>
        <Text style={styles.runDate}>{date}</Text>
      </View>

      <View style={styles.cardMetrics}>
        <Metric label="Distancia" value={distance} />
        <Metric label="Tempo" value={duration} />
        <Metric label="Pace" value={pace} />
      </View>

      {useZoneShape ? (
        <View style={styles.zonePill}>
          <Text style={styles.zonePillLabel}>Area conquistada</Text>
          <Text style={styles.zonePillValue}>{area}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    backgroundColor: WayperTheme.colors.background,
    overflow: "hidden",
  },
  cardRoot: {
    padding: 70,
  },
  traceRoot: {
    padding: 58,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 46,
  },
  cardEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 31,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  cardTitleColumn: {
    flex: 1,
    paddingRight: 34,
  },
  cardTitle: {
    color: WayperTheme.colors.text,
    fontSize: 74,
    fontWeight: "900",
    marginTop: 12,
  },
  cardSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 34,
    fontWeight: "800",
    marginTop: 10,
  },
  logoMark: {
    width: 104,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  shareLogoImage: {
    width: "100%",
    height: "100%",
  },
  cardArtwork: {
    height: 690,
    borderRadius: 64,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.surface,
  },
  mapArtwork: {
    flex: 1,
  },
  cardInfo: {
    marginTop: 44,
  },
  runName: {
    color: WayperTheme.colors.text,
    fontSize: 48,
    fontWeight: "900",
  },
  runDate: {
    color: WayperTheme.colors.textMuted,
    fontSize: 28,
    fontWeight: "700",
    marginTop: 10,
  },
  cardMetrics: {
    flexDirection: "row",
    gap: 18,
    marginTop: 36,
  },
  metric: {
    flex: 1,
    minHeight: 132,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: WayperTheme.colors.borderStrong,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  metricValue: {
    color: WayperTheme.colors.primary,
    fontSize: 38,
    fontWeight: "900",
  },
  metricLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 23,
    fontWeight: "800",
    marginTop: 8,
    textTransform: "uppercase",
  },
  zonePill: {
    marginTop: 26,
    minHeight: 86,
    borderRadius: 43,
    paddingHorizontal: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 2,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  zonePillLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 24,
    fontWeight: "800",
  },
  zonePillValue: {
    color: WayperTheme.colors.primary,
    fontSize: 34,
    fontWeight: "900",
  },
  traceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 36,
  },
  traceEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 28,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  traceTitleColumn: {
    flex: 1,
    paddingRight: 28,
  },
  traceTitle: {
    color: WayperTheme.colors.text,
    fontSize: 58,
    fontWeight: "900",
    marginTop: 8,
  },
  traceBadge: {
    width: 92,
    height: 92,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  traceArtwork: {
    flex: 1,
    borderRadius: 54,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.surface,
  },
  traceMetrics: {
    flexDirection: "row",
    gap: 16,
    marginTop: 34,
  },
});

export default RunShareCard;
