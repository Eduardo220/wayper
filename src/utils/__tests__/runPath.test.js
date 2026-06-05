import { normalizeRunPath } from "../runPath.js";

describe("normalizeRunPath", () => {
  test("uses the saved trusted path and preserves point metadata", () => {
    const result = normalizeRunPath({
      trustedPath: [
        { latitude: -23.56, longitude: -46.64, speed: 3.2, accuracy: 7, timestamp: 1000 },
        { lat: -23.561, lng: -46.641, heading: 120, recordedAt: 2000 },
      ],
      renderPath: [{ latitude: 0, longitude: 0 }],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ latitude: -23.56, longitude: -46.64, speed: 3.2, accuracy: 7 });
    expect(result[1]).toMatchObject({ latitude: -23.561, longitude: -46.641, heading: 120, timestamp: 2000 });
  });

  test("accepts array points as latitude/longitude and only swaps impossible latitude", () => {
    expect(normalizeRunPath([[-23.56, -46.64]])[0]).toMatchObject({
      latitude: -23.56,
      longitude: -46.64,
    });

    expect(normalizeRunPath([[-122.41, 37.78]])[0]).toMatchObject({
      latitude: 37.78,
      longitude: -122.41,
    });
  });

  test("removes invalid points without reordering valid points", () => {
    const result = normalizeRunPath([
      null,
      { latitude: 0, longitude: 0 },
      { latitude: -23.56, longitude: -46.64 },
      { latitude: 120, longitude: -46.65 },
      { lat: -23.57, lon: -46.66 },
    ]);

    expect(result.map((point) => [point.latitude, point.longitude])).toEqual([
      [-23.56, -46.64],
      [-23.57, -46.66],
    ]);
  });
});
