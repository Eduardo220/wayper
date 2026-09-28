import React, { memo, useMemo } from "react";
import { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Polyline, Stop } from "react-native-svg";
import {
  PreviewSvg,
  buildPointObjects,
  fallbackRoutePoints,
  pointsToSvg,
  previewColors,
} from "./previewUtils";

function RoutePreview({ path }) {
  const points = useMemo(() => {
    const built = buildPointObjects(path);
    return built.length >= 2 ? built : fallbackRoutePoints;
  }, [path]);

  const svgPoints = pointsToSvg(points);
  const start = points[0];
  const end = points[points.length - 1];

  return (
    <PreviewSvg variant="route">
      <Defs>
        <SvgLinearGradient id="routeStroke" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={previewColors.primary} />
          <Stop offset="1" stopColor="#5CFFAA" />
        </SvgLinearGradient>
      </Defs>
      <Polyline
        points={svgPoints}
        fill="none"
        stroke={previewColors.glow}
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.28"
      />
      <Polyline
        points={svgPoints}
        fill="none"
        stroke="url(#routeStroke)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={start.x} cy={start.y} r="7" fill="#03080B" stroke={previewColors.primary} strokeWidth="4" />
      <Circle cx={start.x} cy={start.y} r="2.4" fill="#F4F7F5" />
      <Circle cx={end.x} cy={end.y} r="8" fill={previewColors.primary} />
      <Path
        d={`M${end.x - 1} ${end.y - 20} L${end.x - 1} ${end.y + 4} M${end.x + 1} ${end.y - 18} L${end.x + 16} ${end.y - 13} L${end.x + 1} ${end.y - 8} Z`}
        stroke="#03080B"
        strokeWidth="3"
        fill="#F4F7F5"
        strokeLinejoin="round"
      />
    </PreviewSvg>
  );
}

export default memo(RoutePreview);
