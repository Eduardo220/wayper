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
import { WayperTheme } from "../../theme/wayperTheme";
import { buildSummaryRenderPath } from "../../services/tracking";

export const RUN_SHARE_CARD_SIZE = {
  card: { width: 1080, height: 1350 },
  trace: { width: 1080, height: 1080 },
};

const CARD_VIEWBOX = { width: 1080, height: 760 };
const TRACE_VIEWBOX = { width: 900, height: 620 };
const WAYPER_LOGO = require("../../../assets/logo.png");

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

const closePolygon = (coords = []) => {
  if (coords.length < 3) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first.latitude === last.latitude && first.longitude === last.longitude) return coords;
  return coords.concat(first);
};

const buildSvgPoints = (coords = [], { width, height, padding = 72, smooth = false, closed = false } = {}) => {
  const clean = normalizeCoords(coords);
  if (clean.length === 0) return { points: "", hasShape: false };

  const source = smooth && clean.length > 2 ? buildSummaryRenderPath(clean) : clean;

  const points = closed ? closePolygon(source) : source;
  if (points.length < (closed ? 4 : 2)) {
    const only = points[0];
    return {
      points: `${width / 2},${height / 2}`,
      dot: only ? { x: width / 2, y: height / 2 } : null,
      hasShape: false,
    };
  }

  const avgLat = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const lngScale = Math.max(0.2, Math.cos((avgLat * Math.PI) / 180));
  const projected = points.map((point) => ({
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

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Artwork({ mode, coords, isZone }) {
  const viewBox = mode === "trace" ? TRACE_VIEWBOX : CARD_VIEWBOX;
  const shape = useMemo(
    () =>
      buildSvgPoints(coords, {
        width: viewBox.width,
        height: viewBox.height,
        padding: mode === "trace" ? 120 : 110,
        smooth: !isZone,
        closed: isZone,
      }),
    [coords, isZone, mode, viewBox.height, viewBox.width]
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

      {shape.hasShape && isZone ? (
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
    </Svg>
  );
}

const RunShareCard = forwardRef(function RunShareCard(
  {
    mode = "card",
    path = [],
    zoneCoords = [],
    isZone = false,
    title = "Wayper Run",
    subtitle,
    distance = "0.00 km",
    duration = "0:00",
    pace = "--",
    date = "",
    area = "0 m2",
    style,
  },
  ref
) {
  const size = RUN_SHARE_CARD_SIZE[mode] || RUN_SHARE_CARD_SIZE.card;
  const routeCoords = normalizeCoords(path);
  const zoneShape = normalizeCoords(zoneCoords);
  const useZoneShape = Boolean(isZone && (zoneShape.length >= 3 || routeCoords.length >= 3));
  const artworkCoords = useZoneShape ? (zoneShape.length >= 3 ? zoneShape : routeCoords) : routeCoords;
  const displayTitle = title || (useZoneShape ? "Wayper Zone" : "Wayper Run");
  const displaySubtitle = subtitle || (useZoneShape ? "Corrida por zonas" : "Corrida livre");

  if (mode === "trace") {
    return (
      <View ref={ref} collapsable={false} style={[styles.root, styles.traceRoot, { width: size.width, height: size.height }, style]}>
        <View style={styles.traceHeader}>
          <View>
            <Text style={styles.traceEyebrow}>Wayper Trace</Text>
            <Text style={styles.traceTitle}>{useZoneShape ? "Zona PNG" : "Traçado PNG"}</Text>
          </View>
          <View style={styles.traceBadge}>
            <Image source={WAYPER_LOGO} style={styles.shareLogoImage} resizeMode="contain" />
          </View>
        </View>

        <View style={styles.traceArtwork}>
          <Artwork mode="trace" coords={artworkCoords} isZone={useZoneShape} />
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
        <View>
          <Text style={styles.cardEyebrow}>Wayper finalizado</Text>
          <Text style={styles.cardTitle}>{displayTitle}</Text>
          <Text style={styles.cardSubtitle}>{displaySubtitle}</Text>
        </View>
        <View style={styles.logoMark}>
          <Image source={WAYPER_LOGO} style={styles.shareLogoImage} resizeMode="contain" />
        </View>
      </View>

      <View style={styles.cardArtwork}>
        <Artwork mode="card" coords={artworkCoords} isZone={useZoneShape} />
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
