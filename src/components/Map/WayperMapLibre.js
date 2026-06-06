import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  Map,
  Camera,
  GeoJSONSource as ShapeSource,
  Layer,
  Marker,
} from "@maplibre/maplibre-react-native";
import { WayperTheme } from "../../theme/wayperTheme";
import { beautifyRoutePath, buildRunLineGeoJson } from "../../services/runTracking";
import { recordRunEvent } from "../../services/diagnostics/runDiagnosticsService.js";
import {
  leaderCellsToFeatureCollection,
  territoriesToFeatureCollection,
} from "../../services/territory/territoryMapService.js";

export const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const WAYPER_GREEN = WayperTheme.map.routeColor;
export const WAYPER_DARK = WayperTheme.colors.background;
export const WAYPER_DARK_MAP_STYLE = JSON.stringify({
  version: 8,
  name: "Wayper Night",
  sources: {
    openmaptiles: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    },
  },
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  layers: [
    {
      id: "wayper-background",
      type: "background",
      paint: { "background-color": WAYPER_DARK },
    },
    {
      id: "wayper-landuse",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          ["park", "recreation_ground", "grass", "pitch"],
          "#16261b",
          ["cemetery", "forest", "wood"],
          "#14231a",
          ["residential", "suburb", "neighbourhood"],
          "#101513",
          ["industrial", "commercial", "retail"],
          "#141716",
          "#101412",
        ],
        "fill-opacity": 0.9,
      },
    },
    {
      id: "wayper-park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      paint: {
        "fill-color": "#1a2f21",
        "fill-opacity": 0.78,
        "fill-outline-color": "rgba(132,181,139,0.2)",
      },
    },
    {
      id: "wayper-landcover",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      filter: ["match", ["get", "class"], ["grass", "wood", "forest", "scrub"], true, false],
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          ["wood", "forest"],
          "#182c20",
          ["scrub"],
          "#17241d",
          "#1a2f20",
        ],
        "fill-opacity": 0.68,
      },
    },
    {
      id: "wayper-water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": "#0b2024", "fill-opacity": 0.9 },
    },
    {
      id: "wayper-waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#2f5960",
        "line-opacity": 0.58,
        "line-width": ["interpolate", ["exponential", 1.2], ["zoom"], 10, 0.5, 18, 4],
      },
    },
    {
      id: "wayper-aeroway",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "aeroway",
      minzoom: 11,
      paint: { "fill-color": "#171a18", "fill-opacity": 0.58 },
    },
    {
      id: "wayper-road-minor-casing",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: [
        "all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["match", ["get", "class"], ["minor", "service", "track", "path", "pedestrian"], true, false],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#080a09",
        "line-opacity": 0.82,
        "line-width": ["interpolate", ["exponential", 1.25], ["zoom"], 12, 0.5, 15, 2.4, 18, 9],
      },
    },
    {
      id: "wayper-road-minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: [
        "all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["match", ["get", "class"], ["minor", "service", "track", "path", "pedestrian"], true, false],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "match",
          ["get", "class"],
          ["path", "pedestrian", "track"],
          "#49645a",
          "#303937",
        ],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.36, 16, 0.72],
        "line-width": ["interpolate", ["exponential", 1.25], ["zoom"], 12, 0.25, 15, 1.1, 18, 5.5],
      },
    },
    {
      id: "wayper-road-major-casing",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: [
        "all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#080a09",
        "line-opacity": 0.92,
        "line-width": ["interpolate", ["exponential", 1.2], ["zoom"], 8, 1.2, 13, 4, 18, 16],
      },
    },
    {
      id: "wayper-road-major",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: [
        "all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "match",
          ["get", "class"],
          ["motorway", "trunk"],
          "#63736d",
          ["primary"],
          "#6e7c76",
          "#4d5955",
        ],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.55, 14, 0.82],
        "line-width": ["interpolate", ["exponential", 1.2], ["zoom"], 8, 0.7, 13, 2.2, 18, 9],
      },
    },
    {
      id: "wayper-rail",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["==", ["get", "class"], "rail"],
      paint: {
        "line-color": "#3e4b48",
        "line-opacity": 0.45,
        "line-dasharray": [0.4, 1.2],
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 2.2],
      },
    },
    {
      id: "wayper-building",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13,
      paint: {
        "fill-color": "#171d1b",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.42, 16, 0.7],
        "fill-outline-color": "#26302d",
      },
    },
    {
      id: "wayper-boundary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["!=", ["get", "maritime"], 1],
      paint: {
        "line-color": "#53635e",
        "line-opacity": 0.24,
        "line-dasharray": [1.2, 1.8],
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 12, 1.4],
      },
    },
    {
      id: "wayper-water-label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "water_name",
      layout: {
        "text-field": ["coalesce", ["get", "name:pt"], ["get", "name"]],
        "text-font": ["Noto Sans Italic"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 13],
        "text-letter-spacing": 0,
      },
      paint: {
        "text-color": "#91b9bb",
        "text-halo-color": "#0b2024",
        "text-halo-width": 1.2,
        "text-opacity": 0.68,
      },
    },
    {
      id: "wayper-road-label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 13,
      filter: ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
      layout: {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name:pt"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 13],
        "text-letter-spacing": 0,
      },
      paint: {
        "text-color": "#a4aaa6",
        "text-halo-color": "#0b0f0e",
        "text-halo-width": 1,
        "text-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.38, 16, 0.78],
      },
    },
    {
      id: "wayper-poi-label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: 16,
      layout: {
        "text-field": ["coalesce", ["get", "name:pt"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10, 18, 12],
        "text-offset": [0, 0.4],
        "text-anchor": "top",
        "text-letter-spacing": 0,
      },
      paint: {
        "text-color": "#9da8a3",
        "text-halo-color": "#0b0f0e",
        "text-halo-width": 1,
        "text-opacity": 0.6,
      },
    },
    {
      id: "wayper-place-label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      layout: {
        "text-field": ["coalesce", ["get", "name:pt"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3,
          11,
          8,
          14,
          12,
          18,
        ],
        "text-letter-spacing": 0,
        "text-max-width": 8,
      },
      paint: {
        "text-color": "#eef7f1",
        "text-halo-color": "#0b0f0e",
        "text-halo-width": 1.4,
        "text-opacity": 0.82,
      },
    },
  ],
});
export const WAYPER_FALLBACK_COORD = { latitude: -30.0346, longitude: -51.2177 };

export function isValidCoord(coord) {
  if (!coord) return false;

  const latitude = Number(coord.latitude ?? coord.lat ?? coord[1]);
  const longitude = Number(coord.longitude ?? coord.lon ?? coord.lng ?? coord[0]);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function normalizeCoord(coord) {
  if (!isValidCoord(coord)) return null;
  return {
    latitude: Number(coord.latitude ?? coord.lat ?? coord[1]),
    longitude: Number(coord.longitude ?? coord.lon ?? coord.lng ?? coord[0]),
  };
}

export function toLngLat(coord) {
  const normalized = normalizeCoord(coord);
  if (!normalized) return null;
  return [normalized.longitude, normalized.latitude];
}

export function buildFeatureCollection(features = []) {
  return {
    type: "FeatureCollection",
    features: features.filter(Boolean),
  };
}

export function buildLineStringFeature(path = [], properties = {}) {
  const visualPath = properties?.preserveGeometry
    ? (Array.isArray(path) ? path : [])
    : beautifyRoutePath(path, {
        toleranceM: properties?.kind === "replay" ? 3 : 1.2,
        minPointDistanceM: properties?.kind === "replay" ? 1.2 : 0.8,
        spikeToleranceM: properties?.kind === "replay" ? 8 : 5,
        maxPoints: 1200,
        preserveTurns: true,
      });
  const coordinates = visualPath.map(toLngLat).filter(Boolean);
  if (coordinates.length < 2) return null;

  return {
    type: "Feature",
    properties,
    geometry: {
      type: "LineString",
      coordinates,
    },
  };
}

function buildMultiLineStringFeature(segments = [], properties = {}) {
  const coordinates = (Array.isArray(segments) ? segments : [])
    .map((segment) => (Array.isArray(segment) ? segment : []).map(toLngLat).filter(Boolean))
    .filter((segment) => segment.length >= 2);

  if (coordinates.length === 0) return null;
  if (coordinates.length === 1) {
    return {
      type: "Feature",
      properties,
      geometry: {
        type: "LineString",
        coordinates: coordinates[0],
      },
    };
  }

  return {
    type: "Feature",
    properties,
    geometry: {
      type: "MultiLineString",
      coordinates,
    },
  };
}

export function buildPointFeature(coord, properties = {}) {
  const coordinates = toLngLat(coord);
  if (!coordinates) return null;

  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Point",
      coordinates,
    },
  };
}

export function buildPolygonFeature(coords = [], properties = {}) {
  const ring = (Array.isArray(coords) ? coords : []).map(toLngLat).filter(Boolean);
  if (ring.length < 3) return null;

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push(first);
  }

  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
  };
}

function buildZoneFeatures(zones = []) {
  return (Array.isArray(zones) ? zones : [])
    .map((zone, index) => {
      const geometry = zone?.geometry || zone?.zoneGeometry || null;
      if (geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon")) {
        return {
          type: "Feature",
          properties: {
            id: zone?.id ?? `zone-${index}`,
            area: zone?.area ?? zone?.areaM2 ?? null,
            date: zone?.date ?? zone?.createdAt ?? null,
            color: zone?.color || WAYPER_GREEN,
            strokeColor: zone?.strokeColor || zone?.color || WAYPER_GREEN,
            fillOpacity: Number.isFinite(Number(zone?.fillOpacity)) ? Number(zone.fillOpacity) : 0.24,
            preview: Boolean(zone?.preview),
          },
          geometry,
        };
      }
      const coords = Array.isArray(zone?.coords) ? zone.coords : Array.isArray(zone) ? zone : [];
      return buildPolygonFeature(coords, {
        id: zone?.id ?? `zone-${index}`,
        area: zone?.area ?? null,
        date: zone?.date ?? null,
        color: zone?.color || WAYPER_GREEN,
        strokeColor: zone?.strokeColor || zone?.color || WAYPER_GREEN,
        fillOpacity: Number.isFinite(Number(zone?.fillOpacity)) ? Number(zone.fillOpacity) : 0.24,
        preview: Boolean(zone?.preview),
      });
    })
    .filter(Boolean);
}

function collectLngLats(collections = []) {
  const coordinates = [];

  for (const collection of collections) {
    for (const feature of collection?.features || []) {
      const geometry = feature?.geometry;
      if (!geometry) continue;

      if (geometry.type === "LineString") {
        coordinates.push(...geometry.coordinates);
      }

      if (geometry.type === "Polygon") {
        for (const ring of geometry.coordinates || []) {
          coordinates.push(...ring);
        }
      }

      if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates || []) {
          for (const ring of polygon || []) {
            coordinates.push(...ring);
          }
        }
      }
    }
  }

  return coordinates.filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function buildBounds(collections = []) {
  const coordinates = collectLngLats(collections);
  if (coordinates.length < 2) return null;

  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  for (const [longitude, latitude] of coordinates) {
    west = Math.min(west, longitude);
    south = Math.min(south, latitude);
    east = Math.max(east, longitude);
    north = Math.max(north, latitude);
  }

  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west === east && south === north) return null;

  return [west, south, east, north];
}

function bboxFromLngLatPairs(pairs = []) {
  const points = pairs
    .map((point) => (Array.isArray(point) ? point : [point?.longitude ?? point?.lng, point?.latitude ?? point?.lat]))
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([lng, lat]) => [Number(lng), Number(lat)])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

  if (points.length === 0) return null;

  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
}

function extractViewportBbox(event) {
  const payload = event?.nativeEvent || event || {};
  const properties = payload.properties || payload.payload?.properties || {};
  const visibleBounds =
    payload.visibleBounds ||
    payload.payload?.visibleBounds ||
    properties.visibleBounds ||
    properties.bounds ||
    payload.bounds;

  if (Array.isArray(visibleBounds)) {
    const flat = visibleBounds.flat(Infinity).map(Number).filter(Number.isFinite);
    if (flat.length >= 4) {
      const lngs = [];
      const lats = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        lngs.push(flat[i]);
        lats.push(flat[i + 1]);
      }
      return [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
    }
  }

  const center =
    payload.geometry?.coordinates ||
    payload.payload?.geometry?.coordinates ||
    properties.center ||
    payload.center;
  const centerLngLat = Array.isArray(center)
    ? center
    : [center?.longitude ?? center?.lng, center?.latitude ?? center?.lat];

  const centerPoint = bboxFromLngLatPairs([centerLngLat]);
  if (!centerPoint) return null;

  const delta = 0.018;
  const lng = (centerPoint[0] + centerPoint[2]) / 2;
  const lat = (centerPoint[1] + centerPoint[3]) / 2;
  return [lng - delta, lat - delta, lng + delta, lat + delta];
}

function pickInitialCenter({ centerCoordinate, location, routePath, replayPath, zones }) {
  const candidates = [
    centerCoordinate,
    location,
    Array.isArray(replayPath) ? replayPath[replayPath.length - 1] : null,
    Array.isArray(routePath) ? routePath[routePath.length - 1] : null,
    Array.isArray(zones?.[0]?.coords) ? zones[0].coords[0] : Array.isArray(zones?.[0]) ? zones[0][0] : null,
    WAYPER_FALLBACK_COORD,
  ];

  for (const candidate of candidates) {
    const lngLat = toLngLat(candidate);
    if (lngLat) return lngLat;
  }

  return toLngLat(WAYPER_FALLBACK_COORD);
}

function pickLastSegmentPoint(segments = [], fallbackPath = []) {
  if (Array.isArray(segments)) {
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i];
      if (Array.isArray(segment) && segment.length > 0) {
        return segment[segment.length - 1];
      }
    }
  }

  return Array.isArray(fallbackPath) ? fallbackPath[fallbackPath.length - 1] : null;
}

function collectRouteEndpointCandidates(segments = [], fallbackPath = []) {
  const points = [];

  if (Array.isArray(segments)) {
    for (const segment of segments) {
      if (Array.isArray(segment)) {
        points.push(...segment.filter(isValidCoord));
      }
    }
  }

  if (points.length === 0 && Array.isArray(fallbackPath)) {
    points.push(...fallbackPath.filter(isValidCoord));
  }

  return points;
}

function StartMarker() {
  return (
    <View collapsable={false} style={styles.startMarker}>
      <View style={styles.startMarkerCore}>
        <Text style={styles.startMarkerText}>INICIO</Text>
      </View>
    </View>
  );
}

function FinishMarker() {
  return (
    <View collapsable={false} style={styles.finishMarker}>
      <View style={styles.finishFlag}>
        <View style={styles.finishFlagRow}>
          <View style={styles.finishFlagDark} />
          <View style={styles.finishFlagLight} />
        </View>
        <View style={styles.finishFlagRow}>
          <View style={styles.finishFlagLight} />
          <View style={styles.finishFlagDark} />
        </View>
      </View>
      <View style={styles.finishPole} />
      <View style={styles.finishMarkerBase} />
    </View>
  );
}

function countGeometryCoordinates(geometry = {}) {
  if (!geometry) return 0;
  if (geometry.type === "LineString") return Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
  if (geometry.type === "MultiLineString") {
    return (Array.isArray(geometry.coordinates) ? geometry.coordinates : []).reduce(
      (total, segment) => total + (Array.isArray(segment) ? segment.length : 0),
      0
    );
  }
  return 0;
}

function WayperMapLibre({
  style,
  location,
  routePath = [],
  routeSegments = [],
  routeMode = "live",
  replayPath = [],
  replaySegments = [],
  replayMode = "live",
  zones = [],
  territories = [],
  leaderCells = [],
  selectedTerritory = null,
  currentUserId = null,
  showZones = true,
  showTerritories = true,
  showLeaderAreas = true,
  maxTerritories = 240,
  maxLeaderCells = 180,
  showUserLocation = true,
  followUserLocation = false,
  centerCoordinate,
  autoCenterOnCoordinate = false,
  initialZoom = 14,
  followZoomLevel = 16,
  followAnimationDuration = 450,
  recenterAnimationDuration = 700,
  minCameraMoveIntervalMs = 900,
  recenterSignal = 0,
  fitToContent = false,
  interactive = true,
  onUserInteraction,
  routeColor = WAYPER_GREEN,
  replayColor = "#fdcb6e",
  mapStyle = WAYPER_DARK_MAP_STYLE,
  contentPadding = { top: 80, right: 80, bottom: 220, left: 80 },
  showRouteEndpoints = false,
  routeStartCoordinate,
  routeEndCoordinate,
  onTerritoryPress,
  onLeaderCellPress,
  onViewportChange,
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const cameraRef = useRef(null);
  const lastCameraMoveAtRef = useRef(0);
  const lastRecenterSignalRef = useRef(recenterSignal);
  const programmaticMoveUntilRef = useRef(0);
  const lastRouteGeoJsonDiagnosticRef = useRef("");

  const routeCollection = useMemo(
    () => buildRunLineGeoJson(
      Array.isArray(routeSegments) && routeSegments.length > 0 ? routeSegments : routePath,
      routeMode,
      { kind: "route", preserveGeometry: true }
    ),
    [routeMode, routePath, routeSegments]
  );
  const routeHeadCollection = useMemo(
    () => buildFeatureCollection([buildPointFeature(pickLastSegmentPoint(routeSegments, routePath), { kind: "route-head" })]),
    [routePath, routeSegments]
  );
  const routeEndpoints = useMemo(() => {
    if (!showRouteEndpoints) return { start: null, end: null };

    const candidates = collectRouteEndpointCandidates(routeSegments, routePath);
    const start = toLngLat(routeStartCoordinate) || toLngLat(candidates[0]);
    const end = toLngLat(routeEndCoordinate) || toLngLat(candidates[candidates.length - 1]);

    if (!start || !end) return { start: null, end: null };
    return { start, end };
  }, [routeEndCoordinate, routePath, routeSegments, routeStartCoordinate, showRouteEndpoints]);
  const replayCollection = useMemo(
    () => buildRunLineGeoJson(
      Array.isArray(replaySegments) && replaySegments.length > 0 ? replaySegments : replayPath,
      replayMode,
      { kind: "replay", preserveGeometry: true }
    ),
    [replayMode, replayPath, replaySegments]
  );
  const replayHeadCollection = useMemo(
    () => buildFeatureCollection([buildPointFeature(pickLastSegmentPoint(replaySegments, replayPath), { kind: "replay-head" })]),
    [replayPath, replaySegments]
  );
  const userLocationCollection = useMemo(
    () => buildFeatureCollection(showUserLocation ? [buildPointFeature(location, { kind: "user-location" })] : []),
    [location, showUserLocation]
  );
  const zonesCollection = useMemo(
    () => buildFeatureCollection(showZones ? buildZoneFeatures(zones) : []),
    [showZones, zones]
  );
  const territoriesCollection = useMemo(
    () => {
      if (!showTerritories) return buildFeatureCollection();
      const limited = (Array.isArray(territories) ? territories : []).slice(0, maxTerritories);
      return territoriesToFeatureCollection(limited, currentUserId);
    },
    [currentUserId, maxTerritories, showTerritories, territories]
  );
  const leaderCellsCollection = useMemo(
    () => {
      if (!showLeaderAreas) return buildFeatureCollection();
      const limited = (Array.isArray(leaderCells) ? leaderCells : []).slice(0, maxLeaderCells);
      return leaderCellsToFeatureCollection(limited, currentUserId);
    },
    [currentUserId, leaderCells, maxLeaderCells, showLeaderAreas]
  );

  const hasRoute = routeCollection.features.length > 0;
  const hasRouteHead = routeHeadCollection.features.length > 0 && !showUserLocation && !showRouteEndpoints;
  const hasRouteEndpoints = showRouteEndpoints && Boolean(routeEndpoints.start && routeEndpoints.end);
  const hasReplay = replayCollection.features.length > 0;
  const hasReplayHead = replayHeadCollection.features.length > 0;
  const hasUserLocation = userLocationCollection.features.length > 0;
  const hasZones = zonesCollection.features.length > 0;
  const hasTerritories = territoriesCollection.features.length > 0;
  const hasLeaderCells = leaderCellsCollection.features.length > 0;
  const selectedTerritoryId = selectedTerritory?.id || selectedTerritory?.properties?.id || null;
  const initialCenter = useMemo(
    () => pickInitialCenter({ centerCoordinate, location, routePath, replayPath, zones }),
    [centerCoordinate, location, routePath, replayPath, zones]
  );
  const cameraCenter = useMemo(
    () => toLngLat(centerCoordinate) || toLngLat(location) || initialCenter,
    [centerCoordinate, location, initialCenter]
  );
  const bounds = useMemo(
    () => (fitToContent ? buildBounds([leaderCellsCollection, territoriesCollection, zonesCollection, replayCollection, routeCollection]) : null),
    [fitToContent, leaderCellsCollection, territoriesCollection, zonesCollection, replayCollection, routeCollection]
  );

  useEffect(() => {
    const routeFeature = routeCollection.features?.[0] || null;
    const routePointsCount = countGeometryCoordinates(routeFeature?.geometry);
    const diagnosticKey = [
      routeFeature?.geometry?.type || "none",
      routePointsCount,
      routeCollection.features?.length || 0,
      routeMode,
    ].join(":");
    if (diagnosticKey === lastRouteGeoJsonDiagnosticRef.current) return;
    lastRouteGeoJsonDiagnosticRef.current = diagnosticKey;
    if (!routeFeature || routePointsCount === 0) return;

    recordRunEvent("MAP_GEOJSON_REBUILT", {
      geometryType: routeFeature.geometry?.type || null,
      routeFeaturesCount: routeCollection.features.length,
      routePointsCount,
      routeMode,
      preserveGeometry: true,
    });
  }, [routeCollection, routeMode]);

  const moveCameraTo = useCallback((center, zoom, duration) => {
    if (!center || !cameraRef.current?.setStop) return;

    const now = Date.now();
    programmaticMoveUntilRef.current = now + duration + 250;

    try {
      const movement = cameraRef.current.setStop({
        center,
        zoom,
        duration,
        easing: "ease",
      });

      if (movement?.catch) {
        movement.catch(() => {});
      }
    } catch {
      // A camera pode ainda nao estar pronta no primeiro render; o proximo update corrige.
    }
  }, []);

  useEffect(() => {
    if (!followUserLocation || bounds || !cameraCenter) return;

    const now = Date.now();
    const isForcedRecenter = recenterSignal !== lastRecenterSignalRef.current;
    const tooSoon = now - lastCameraMoveAtRef.current < minCameraMoveIntervalMs;

    if (!isForcedRecenter && tooSoon) return;

    lastRecenterSignalRef.current = recenterSignal;
    lastCameraMoveAtRef.current = now;
    moveCameraTo(
      cameraCenter,
      followZoomLevel,
      isForcedRecenter ? recenterAnimationDuration : followAnimationDuration
    );
  }, [
    bounds,
    cameraCenter,
    followAnimationDuration,
    followUserLocation,
    followZoomLevel,
    minCameraMoveIntervalMs,
    moveCameraTo,
    recenterAnimationDuration,
    recenterSignal,
  ]);

  useEffect(() => {
    if (!autoCenterOnCoordinate || followUserLocation || bounds || !cameraCenter) return;

    moveCameraTo(cameraCenter, initialZoom, followAnimationDuration);
  }, [
    autoCenterOnCoordinate,
    bounds,
    cameraCenter,
    followAnimationDuration,
    followUserLocation,
    initialZoom,
    moveCameraTo,
  ]);

  const handleRegionWillChange = useCallback(
    (event) => {
      if (!interactive || !followUserLocation || !onUserInteraction) return;

      const isUserInteraction = event?.nativeEvent?.userInteraction === true;
      const isProgrammaticMove = Date.now() < programmaticMoveUntilRef.current;

      if (isUserInteraction && !isProgrammaticMove) {
        onUserInteraction();
      }
    },
    [followUserLocation, interactive, onUserInteraction]
  );

  const handleRegionDidChange = useCallback(
    (event) => {
      if (!onViewportChange) return;
      const bbox = extractViewportBbox(event);
      if (bbox) onViewportChange({ bbox });
    },
    [onViewportChange]
  );

  const handleMapPress = useCallback(() => {
    if (!interactive || !followUserLocation || !onUserInteraction) return;
    onUserInteraction();
  }, [followUserLocation, interactive, onUserInteraction]);

  const extractPressedFeatureProperties = useCallback((event) => {
    const feature =
      event?.features?.[0] ||
      event?.nativeEvent?.features?.[0] ||
      event?.nativeEvent?.payload?.features?.[0] ||
      event?.feature ||
      null;

    return (
      feature?.properties ||
      event?.properties ||
      event?.nativeEvent?.properties ||
      event?.nativeEvent?.payload?.properties ||
      null
    );
  }, []);

  const handleTerritoryPress = useCallback(
    (event) => {
      const properties = extractPressedFeatureProperties(event);
      if (properties && onTerritoryPress) onTerritoryPress(properties);
    },
    [extractPressedFeatureProperties, onTerritoryPress]
  );

  const handleLeaderCellPress = useCallback(
    (event) => {
      const properties = extractPressedFeatureProperties(event);
      if (properties && onLeaderCellPress) onLeaderCellPress(properties);
    },
    [extractPressedFeatureProperties, onLeaderCellPress]
  );

  if (hasError) {
    return (
      <View style={[styles.fallback, style]}>
        <Text style={styles.fallbackText}>Não foi possível carregar o mapa.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <Map
        mapStyle={mapStyle}
        style={styles.map}
        // TextureView melhora compatibilidade com overlays e capturas via react-native-view-shot no Android.
        androidView="texture"
        dragPan={interactive}
        touchZoom={interactive}
        doubleTapZoom={interactive}
        doubleTapHoldZoom={interactive}
        touchRotate={interactive}
        touchPitch={interactive}
        compass={interactive}
        logo={false}
        attribution={false}
        scaleBar={false}
        onDidFinishLoadingStyle={() => setIsLoading(false)}
        onDidFinishRenderingMapFully={() => setIsLoading(false)}
        onDidFailLoadingMap={() => {
          setIsLoading(false);
          setHasError(true);
          recordRunEvent("MAP_ERROR", {
            reason: "did_fail_loading_map",
          });
        }}
        onRegionWillChange={handleRegionWillChange}
        onRegionDidChange={handleRegionDidChange}
        onPress={handleMapPress}
      >
        <Camera
          ref={cameraRef}
          initialViewState={bounds ? { bounds, padding: contentPadding } : { center: initialCenter, zoom: initialZoom }}
          bounds={bounds || undefined}
          padding={bounds ? contentPadding : undefined}
          duration={bounds ? 450 : undefined}
        />

        {hasLeaderCells && (
          <ShapeSource
            id="wayper-leader-cells-source"
            data={leaderCellsCollection}
            onPress={handleLeaderCellPress}
          >
            <Layer
              id="wayper-leader-cells-fill"
              type="fill"
              source="wayper-leader-cells-source"
              paint={{
                "fill-color": ["get", "color"],
                "fill-opacity": ["case", ["==", ["get", "isMine"], true], 0.16, 0.1],
              }}
            />
            <Layer
              id="wayper-leader-cells-border"
              type="line"
              source="wayper-leader-cells-source"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": ["get", "color"],
                "line-opacity": ["case", ["==", ["get", "isMine"], true], 0.5, 0.28],
                "line-width": ["case", ["==", ["get", "isMine"], true], 2.4, 1.4],
                "line-dasharray": [1.4, 1.2],
              }}
            />
          </ShapeSource>
        )}

        {hasTerritories && (
          <ShapeSource
            id="wayper-territories-source"
            data={territoriesCollection}
            onPress={handleTerritoryPress}
          >
            <Layer
              id="wayper-territories-glow"
              type="line"
              source="wayper-territories-source"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": ["get", "color"],
                "line-blur": 4,
                "line-opacity": ["case", ["==", ["get", "isMine"], true], 0.38, 0.18],
                "line-width": ["case", ["==", ["get", "id"], selectedTerritoryId || ""], 12, 8],
              }}
            />
            <Layer
              id="wayper-territories-leader-glow"
              type="line"
              source="wayper-territories-source"
              filter={["==", ["get", "isLeaderTerritory"], true]}
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": ["get", "color"],
                "line-blur": 2.5,
                "line-opacity": 0.42,
                "line-width": 7,
              }}
            />
            <Layer
              id="wayper-territories-fill"
              type="fill"
              source="wayper-territories-source"
              paint={{
                "fill-color": ["get", "color"],
                "fill-opacity": [
                  "case",
                  ["==", ["get", "id"], selectedTerritoryId || ""],
                  0.34,
                  ["==", ["get", "isMine"], true],
                  0.24,
                  0.16,
                ],
              }}
            />
            <Layer
              id="wayper-territories-border"
              type="line"
              source="wayper-territories-source"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": ["get", "color"],
                "line-opacity": ["case", ["==", ["get", "isMine"], true], 0.88, 0.66],
                "line-width": [
                  "case",
                  ["==", ["get", "id"], selectedTerritoryId || ""],
                  4.4,
                  ["==", ["get", "isLeaderTerritory"], true],
                  3.4,
                  ["==", ["get", "isMine"], true],
                  3,
                  2,
                ],
              }}
            />
          </ShapeSource>
        )}

        {hasZones && (
          <ShapeSource id="wayper-zones-source" data={zonesCollection}>
            <Layer
              id="wayper-zones-glow"
              type="line"
              source="wayper-zones-source"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": ["get", "strokeColor"],
                "line-blur": 5,
                "line-opacity": ["case", ["==", ["get", "preview"], true], 0.24, 0.34],
                "line-width": ["case", ["==", ["get", "preview"], true], 8, 11],
              }}
            />
            <Layer
              id="wayper-zones-fill"
              type="fill"
              source="wayper-zones-source"
              paint={{
                "fill-color": ["get", "color"],
                "fill-opacity": ["case", ["==", ["get", "preview"], true], 0.14, ["get", "fillOpacity"]],
              }}
            />
            <Layer
              id="wayper-zones-border"
              type="line"
              source="wayper-zones-source"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": ["get", "strokeColor"],
                "line-opacity": ["case", ["==", ["get", "preview"], true], 0.64, 0.9],
                "line-width": ["case", ["==", ["get", "preview"], true], 2.6, 3.5],
              }}
            />
          </ShapeSource>
        )}

        {hasRoute && (
          <ShapeSource id="wayper-route-source" data={routeCollection} lineMetrics={true}>
            <Layer
              id="wayper-route-glow"
              type="line"
              source="wayper-route-source"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": routeColor,
                "line-blur": 3.5,
                "line-width": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 15, 18, 20],
                "line-opacity": 0.28,
              }}
            />
            <Layer
              id="wayper-route-line"
              type="line"
              source="wayper-route-source"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": routeColor,
                "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 15, 7, 18, 9],
                "line-opacity": 1,
              }}
            />
          </ShapeSource>
        )}

        {hasRouteHead && (
          <ShapeSource id="wayper-route-head-source" data={routeHeadCollection}>
            <Layer
              id="wayper-route-head-halo"
              type="circle"
              source="wayper-route-head-source"
              paint={{
                "circle-color": routeColor,
                "circle-opacity": 0.25,
                "circle-radius": 18,
                "circle-blur": 0.7,
                "circle-pitch-alignment": "map",
              }}
            />
            <Layer
              id="wayper-route-head-dot"
              type="circle"
              source="wayper-route-head-source"
              paint={{
                "circle-color": "#ecfff6",
                "circle-opacity": 1,
                "circle-radius": 4.8,
                "circle-stroke-color": routeColor,
                "circle-stroke-width": 2.2,
                "circle-pitch-alignment": "map",
              }}
            />
          </ShapeSource>
        )}

        {hasRouteEndpoints && (
          <>
            <Marker id="wayper-route-start-marker" lngLat={routeEndpoints.start} anchor="center">
              <StartMarker />
            </Marker>
            <Marker id="wayper-route-finish-marker" lngLat={routeEndpoints.end} anchor="bottom">
              <FinishMarker />
            </Marker>
          </>
        )}

        {hasReplay && (
          <ShapeSource id="wayper-replay-source" data={replayCollection} lineMetrics={true}>
            <Layer
              id="wayper-replay-glow"
              type="line"
              source="wayper-replay-source"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": replayColor,
                "line-blur": 2.5,
                "line-width": 11,
                "line-opacity": 0.35,
              }}
            />
            <Layer
              id="wayper-replay-line"
              type="line"
              source="wayper-replay-source"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": replayColor,
                "line-width": 5,
                "line-opacity": 0.95,
              }}
            />
          </ShapeSource>
        )}

        {hasReplayHead && (
          <ShapeSource id="wayper-replay-head-source" data={replayHeadCollection}>
            <Layer
              id="wayper-replay-head-dot"
              type="circle"
              source="wayper-replay-head-source"
              paint={{
                "circle-color": replayColor,
                "circle-opacity": 0.92,
                "circle-radius": 5.5,
                "circle-stroke-color": "#140d00",
                "circle-stroke-width": 1.5,
                "circle-pitch-alignment": "map",
              }}
            />
          </ShapeSource>
        )}

        {hasUserLocation && (
          <ShapeSource id="wayper-user-location-source" data={userLocationCollection}>
            <Layer
              id="wayper-user-location-halo"
              type="circle"
              source="wayper-user-location-source"
              paint={{
                "circle-color": WAYPER_GREEN,
                "circle-opacity": 0.18,
                "circle-radius": 24,
                "circle-blur": 0.8,
                "circle-pitch-alignment": "map",
              }}
            />
            <Layer
              id="wayper-user-location-ring"
              type="circle"
              source="wayper-user-location-source"
              paint={{
                "circle-color": "#ffffff",
                "circle-opacity": 1,
                "circle-radius": 8.5,
                "circle-pitch-alignment": "map",
              }}
            />
            <Layer
              id="wayper-user-location-dot"
              type="circle"
              source="wayper-user-location-source"
              paint={{
                "circle-color": WAYPER_GREEN,
                "circle-opacity": 1,
                "circle-radius": 5.8,
                "circle-stroke-color": "#001c12",
                "circle-stroke-width": 1.5,
                "circle-pitch-alignment": "map",
              }}
            />
          </ShapeSource>
        )}
      </Map>

      {isLoading && (
        <View pointerEvents="none" style={styles.loading}>
          <ActivityIndicator size="small" color={WAYPER_GREEN} />
        </View>
      )}
    </View>
  );
}

export default memo(WayperMapLibre);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WAYPER_DARK },
  map: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,8,7,0.5)",
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101418",
    padding: 20,
  },
  fallbackText: {
    color: "#fff",
    fontWeight: "700",
    textAlign: "center",
  },
  startMarker: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 230, 118, 0.22)",
    borderWidth: 2,
    borderColor: "rgba(236, 255, 246, 0.92)",
  },
  startMarkerCore: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WAYPER_GREEN,
    borderWidth: 2,
    borderColor: "#031009",
  },
  startMarkerText: {
    color: "#031009",
    fontSize: 7,
    fontWeight: "900",
  },
  finishMarker: {
    width: 42,
    height: 54,
    alignItems: "center",
  },
  finishFlag: {
    width: 31,
    height: 23,
    marginLeft: 13,
    borderWidth: 2,
    borderColor: "#031009",
    backgroundColor: "#ecfff6",
  },
  finishFlagRow: {
    flex: 1,
    flexDirection: "row",
  },
  finishFlagDark: {
    flex: 1,
    backgroundColor: "#031009",
  },
  finishFlagLight: {
    flex: 1,
    backgroundColor: "#ecfff6",
  },
  finishPole: {
    position: "absolute",
    left: 12,
    top: 2,
    width: 5,
    height: 43,
    borderRadius: 2.5,
    backgroundColor: WAYPER_GREEN,
    borderWidth: 1,
    borderColor: "#031009",
  },
  finishMarkerBase: {
    position: "absolute",
    bottom: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: WAYPER_GREEN,
    borderWidth: 3,
    borderColor: "#ecfff6",
  },
});
