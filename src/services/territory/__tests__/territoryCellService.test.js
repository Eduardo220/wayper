import { describe, expect, test } from "@jest/globals";
import {
  getCellIdForLocation,
  getCellIdsForBbox,
  getCellIdsForGeometry,
  getCellPolygon,
} from "../territoryCellService.js";
import { isGeometryRenderable } from "../territoryGeometryService.js";

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-51.001, -30.001],
      [-51.001, -29.999],
      [-50.999, -29.999],
      [-50.999, -30.001],
      [-51.001, -30.001],
    ],
  ],
};

describe("territoryCellService", () => {
  test("getCellIdForLocation retorna string estavel", () => {
    const first = getCellIdForLocation({ latitude: -30.0012, longitude: -51.0012 });
    const second = getCellIdForLocation({ latitude: -30.0012, longitude: -51.0012 });

    expect(typeof first).toBe("string");
    expect(first).toBe(second);
  });

  test("pontos proximos caem na mesma celula quando esperado", () => {
    const first = getCellIdForLocation({ latitude: -30.0012, longitude: -51.0012 });
    const second = getCellIdForLocation({ latitude: -30.0013, longitude: -51.0013 });

    expect(first).toBe(second);
  });

  test("getCellIdsForBbox retorna lista", () => {
    const ids = getCellIdsForBbox([-51.001, -30.001, -50.999, -29.999]);

    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
    expect(typeof ids[0]).toBe("string");
  });

  test("getCellIdsForGeometry retorna lista", () => {
    const ids = getCellIdsForGeometry(polygon);

    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
  });

  test("getCellPolygon retorna Polygon renderizavel", () => {
    const cellId = getCellIdForLocation({ latitude: -30.0012, longitude: -51.0012 });
    const cellPolygon = getCellPolygon(cellId);

    expect(cellPolygon?.type).toBe("Polygon");
    expect(isGeometryRenderable(cellPolygon)).toBe(true);
  });
});

