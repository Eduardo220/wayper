import React, { memo, useMemo } from "react";
import { Circle, Defs, LinearGradient as SvgLinearGradient, Polygon, Stop } from "react-native-svg";
import {
  PreviewSvg,
  buildPointObjects,
  fallbackPolygonPoints,
  pointsToSvg,
  previewColors,
} from "./previewUtils";

function ZonePreview({ polygon }) {
  const points = useMemo(() => {
    const built = buildPointObjects(polygon);
    return built.length >= 3 ? built : fallbackPolygonPoints;
  }, [polygon]);

  const svgPoints = pointsToSvg(points);
  const anchor = points[0];

  return (
    <PreviewSvg variant="zone">
      <Defs>
        <SvgLinearGradient id="zoneStroke" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#5CFFAA" />
          <Stop offset="1" stopColor={previewColors.primary} />
        </SvgLinearGradient>
      </Defs>
      <Polygon
        points={svgPoints}
        fill="rgba(0, 230, 118, 0.18)"
        stroke={previewColors.glow}
        strokeWidth="20"
        strokeLinejoin="round"
        opacity="0.34"
      />
      <Polygon
        points={svgPoints}
        fill="rgba(0, 230, 118, 0.26)"
        stroke="url(#zoneStroke)"
        strokeWidth="5.5"
        strokeLinejoin="round"
      />
      <Circle cx={anchor.x} cy={anchor.y} r="7" fill={previewColors.primary} stroke="#03080B" strokeWidth="3" />
    </PreviewSvg>
  );
}

export default memo(ZonePreview);
