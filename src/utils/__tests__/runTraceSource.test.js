import { describe, expect, test } from "@jest/globals";

import {
  TracePointsInsufficientError,
  assertTraceHasEnoughPoints,
  getRenderableTraceSource,
} from "../share/runTraceSource.js";

const point = (latitude, longitude) => ({ latitude, longitude });

describe("run trace source helpers", () => {
  test("prefere segments visuais e nao conecta pausas por path plano", () => {
    const source = getRenderableTraceSource({
      path: [
        point(-23.55, -46.63),
        point(-23.56, -46.64),
        point(-23.80, -46.90),
        point(-23.81, -46.91),
      ],
      segments: [
        { displayPoints: [point(-23.55, -46.63), point(-23.56, -46.64)] },
        { displayPoints: [point(-23.80, -46.90), point(-23.81, -46.91)] },
      ],
      isZone: false,
    });

    expect(source.type).toBe("route");
    expect(source.segments).toHaveLength(2);
    expect(source.points).toHaveLength(4);
    expect(source.segments[0][1]).toMatchObject(point(-23.56, -46.64));
    expect(source.segments[1][0]).toMatchObject(point(-23.80, -46.90));
  });

  test("usa poligono de zona somente quando zoneCoords existe", () => {
    const withoutZoneCoords = getRenderableTraceSource({
      path: [point(-23.55, -46.63), point(-23.56, -46.64), point(-23.57, -46.65)],
      zoneCoords: [],
      isZone: true,
    });
    const withZoneCoords = getRenderableTraceSource({
      path: [point(-23.55, -46.63), point(-23.56, -46.64)],
      zoneCoords: [point(-23.55, -46.63), point(-23.56, -46.64), point(-23.55, -46.65)],
      isZone: true,
    });

    expect(withoutZoneCoords.type).toBe("route");
    expect(withZoneCoords.type).toBe("zone");
    expect(withZoneCoords.points).toHaveLength(3);
  });

  test("rota vazia falha de forma controlada", () => {
    expect(() => assertTraceHasEnoughPoints({ path: [], segments: [], isZone: false }))
      .toThrow(TracePointsInsufficientError);
  });
});
