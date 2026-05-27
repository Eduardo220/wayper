import React, { memo, useMemo } from "react";
import { Defs, LinearGradient as SvgLinearGradient, Polyline, Stop } from "react-native-svg";
import { SvgRunFinishMarker, SvgRunStartMarker } from "../Map/RunRouteMarkers";
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
      <SvgRunStartMarker x={start.x} y={start.y} outerRadius={7.5} innerRadius={4.2} />
      <SvgRunFinishMarker x={end.x} y={end.y} radius={10.5} clipId="routePreviewFinishMarkerClip" />
    </PreviewSvg>
  );
}

export default memo(RoutePreview);
