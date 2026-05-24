export const BASE_LAT = -23.56;
export const BASE_LNG = -46.64;
export const BASE_TIME = 1_700_000_000_000;

export const metersToLat = (meters) => meters / 111_320;
export const metersToLng = (meters, latitude = BASE_LAT) =>
  meters / (111_320 * Math.cos((latitude * Math.PI) / 180));

export function p(index, north = 0, east = 0, extra = {}) {
  return {
    latitude: BASE_LAT + metersToLat(north),
    longitude: BASE_LNG + metersToLng(east),
    accuracy: 8,
    speed: null,
    heading: null,
    altitude: null,
    altitudeAccuracy: null,
    timestamp: BASE_TIME + index * 3000,
    source: "expo-location",
    ...extra,
  };
}

export function straightWithLateralNoise(count = 18) {
  return Array.from({ length: count }, (_, index) =>
    p(index, index * 5, index % 2 === 0 ? 0.45 : -0.35, { accuracy: index % 4 === 0 ? 12 : 8 })
  );
}

export function smoothCurve() {
  const radius = 36;
  return Array.from({ length: 10 }, (_, index) => {
    const angle = (index / 9) * (Math.PI / 2);
    return p(index, Math.sin(angle) * radius, (1 - Math.cos(angle)) * radius, { accuracy: 7 });
  });
}

export function rightAngleCorner() {
  return [
    p(0, 0, 0),
    p(2, 0, 18),
    p(4, 0, 36),
    p(6, 18, 36),
    p(8, 36, 36),
  ];
}

export function impossibleJump() {
  return [
    p(0, 0, 0),
    p(1, 0, 8),
    p(2, 0, 180, { timestamp: BASE_TIME + 3500 }),
    p(3, 0, 16),
  ];
}

export function pauseAndResumeFarAway() {
  return {
    first: [p(0, 0, 0), p(2, 0, 12)],
    second: [
      p(10, 120, 120, { timestamp: BASE_TIME + 35_000 }),
      p(12, 132, 120, { timestamp: BASE_TIME + 41_000 }),
    ],
  };
}

export function irregularClosedZone() {
  return [
    p(0, 0, 0),
    p(2, 0, 90),
    p(4, 38, 112),
    p(6, 76, 78),
    p(8, 62, 24),
    p(10, 28, -18),
    p(12, 0, 0),
  ];
}

export function irregularDrawingLikeRoute() {
  return [
    p(0, 0, 0),
    p(2, 16, 48),
    p(4, 4, 95),
    p(6, 42, 134),
    p(8, 88, 104),
    p(10, 72, 48),
    p(12, 108, 4),
    p(14, 50, -28),
    p(16, 0, 0),
  ];
}
