import React from "react";
import Svg, {
  Defs,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { WayperTheme } from "../../theme/wayperTheme";

export const PREVIEW_WIDTH = 320;
export const PREVIEW_HEIGHT = 156;

export function buildPointObjects(coords = [], width = PREVIEW_WIDTH, height = PREVIEW_HEIGHT, padding = 24) {
  const valid = (Array.isArray(coords) ? coords : [])
    .map((point) => {
      const latitude = Number(point?.latitude ?? point?.lat);
      const longitude = Number(point?.longitude ?? point?.lng ?? point?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    })
    .filter(Boolean);

  if (!valid.length) return [];

  const lats = valid.map((point) => point.latitude);
  const lngs = valid.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = Math.max(maxLat - minLat, 0.000001);
  const lngRange = Math.max(maxLng - minLng, 0.000001);
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;

  return valid.map((point) => ({
    x: padding + ((point.longitude - minLng) / lngRange) * drawWidth,
    y: padding + (1 - (point.latitude - minLat) / latRange) * drawHeight,
  }));
}

export function pointsToSvg(points = []) {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

export function MapTexture({ variant = "route" }) {
  const glow = variant === "zone" ? "rgba(0, 230, 118, 0.24)" : "rgba(0, 230, 118, 0.18)";

  return (
    <>
      <Rect width="320" height="156" rx="22" fill="#050B0E" />
      <Defs>
        <SvgLinearGradient id={`previewRoad-${variant}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="rgba(255,255,255,0.11)" />
          <Stop offset="1" stopColor="rgba(255,255,255,0.02)" />
        </SvgLinearGradient>
      </Defs>
      <Path d="M-8 114 C48 92 74 88 118 104 S206 130 330 78" stroke={`url(#previewRoad-${variant})`} strokeWidth="13" fill="none" strokeLinecap="round" opacity="0.52" />
      <Path d="M4 47 C54 60 80 66 121 50 S188 22 322 38" stroke={`url(#previewRoad-${variant})`} strokeWidth="9" fill="none" strokeLinecap="round" opacity="0.44" />
      <Path d="M72 -8 C90 28 96 62 84 108 S75 142 86 168" stroke={`url(#previewRoad-${variant})`} strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.36" />
      <Line x1="220" y1="-10" x2="250" y2="166" stroke="rgba(255,255,255,0.08)" strokeWidth="6" strokeLinecap="round" />
      <Line x1="-4" y1="132" x2="332" y2="18" stroke={glow} strokeWidth="1.2" opacity="0.45" />
      <Rect x="0.5" y="0.5" width="319" height="155" rx="22" stroke="rgba(0, 230, 118, 0.18)" strokeWidth="1" fill="none" />
    </>
  );
}

export function PreviewSvg({ children, variant = "route", style }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 320 156" style={style}>
      <MapTexture variant={variant} />
      {children}
    </Svg>
  );
}

export const fallbackRoutePoints = [
  { x: 36, y: 108 },
  { x: 78, y: 80 },
  { x: 122, y: 96 },
  { x: 162, y: 54 },
  { x: 214, y: 64 },
  { x: 280, y: 34 },
];

export const fallbackPolygonPoints = [
  { x: 62, y: 108 },
  { x: 92, y: 42 },
  { x: 170, y: 28 },
  { x: 258, y: 76 },
  { x: 220, y: 122 },
  { x: 126, y: 132 },
];

export const previewColors = {
  primary: WayperTheme.colors.primary,
  glow: WayperTheme.colors.primaryGlow,
};
