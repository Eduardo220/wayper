import {
  getRunBoundaryPoints,
  normalizeRouteBoundaryPoint,
} from "../routeBoundary.js";

const p = (latitude, longitude, extra = {}) => ({ latitude, longitude, ...extra });

describe("routeBoundary", () => {
  test("usa primeiro e ultimo ponto valido de uma rota simples", () => {
    const result = getRunBoundaryPoints([
      p(0, 0),
      null,
      p(-30.01, -51.01),
      { latitude: "bad", longitude: -51.02 },
      p(-30.03, -51.03),
    ]);

    expect(result.start).toMatchObject(p(-30.01, -51.01));
    expect(result.finish).toMatchObject(p(-30.03, -51.03));
    expect(result.validPointCount).toBe(2);
  });

  test("usa primeiro ponto do primeiro segmento e ultimo do ultimo segmento", () => {
    const result = getRunBoundaryPoints([
      [p(-30, -51), p(-30.001, -51.001)],
      [],
      [p(-30.01, -51.01), p(-30.02, -51.02)],
    ]);

    expect(result.start).toMatchObject(p(-30, -51));
    expect(result.finish).toMatchObject(p(-30.02, -51.02));
    expect(result.segmentCount).toBe(2);
  });

  test("le segmentos salvos sem criar marcadores de pausa ou retomada", () => {
    const result = getRunBoundaryPoints([
      { trustedPath: [p(-30, -51), p(-30.001, -51.001)] },
      { trustedPath: [p(-30.01, -51.01), p(-30.02, -51.02)] },
    ]);

    expect(result.start).toMatchObject(p(-30, -51));
    expect(result.finish).toMatchObject(p(-30.02, -51.02));
  });

  test("nao cria chegada quando so existe um ponto valido", () => {
    const result = getRunBoundaryPoints([p(-30, -51)]);

    expect(result.start).toMatchObject(p(-30, -51));
    expect(result.finish).toBeNull();
    expect(result.hasFinish).toBe(false);
  });

  test("evita marcadores sobrepostos quando inicio e fim sao praticamente iguais", () => {
    const result = getRunBoundaryPoints([
      p(-30, -51),
      p(-30.000001, -51.000001),
    ]);

    expect(result.start).toMatchObject(p(-30, -51));
    expect(result.finish).toBeNull();
    expect(result.finishCandidate).toMatchObject(p(-30.000001, -51.000001));
  });

  test("usa fallback quando segmentos nao possuem pontos suficientes", () => {
    const result = getRunBoundaryPoints([], {
      fallbackPath: [p(-30.1, -51.1), p(-30.2, -51.2)],
    });

    expect(result.start).toMatchObject(p(-30.1, -51.1));
    expect(result.finish).toMatchObject(p(-30.2, -51.2));
  });

  test("normaliza arrays latitude/longitude e troca quando o primeiro valor nao pode ser latitude", () => {
    expect(normalizeRouteBoundaryPoint([-30, -51])).toMatchObject(p(-30, -51));
    expect(normalizeRouteBoundaryPoint([-120, 35])).toMatchObject(p(35, -120));
  });
});
