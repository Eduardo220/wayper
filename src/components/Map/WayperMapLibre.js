import React, { memo, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  Map,
  Camera,
  GeoJSONSource as ShapeSource,
  Layer,
} from "@maplibre/maplibre-react-native";
import { WayperTheme } from "../../theme/wayperTheme";
import { beautifyRoutePath } from "../../utils/routeDrawing";

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
  const visualPath = beautifyRoutePath(path, {
    toleranceM: properties?.kind === "replay" ? 3 : 3.4,
    minPointDistanceM: properties?.kind === "replay" ? 1.2 : 1.4,
    spikeToleranceM: properties?.kind === "replay" ? 8 : 7,
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
      const coords = Array.isArray(zone?.coords) ? zone.coords : Array.isArray(zone) ? zone : [];
      return buildPolygonFeature(coords, {
        id: zone?.id ?? `zone-${index}`,
        area: zone?.area ?? null,
        date: zone?.date ?? null,
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

function WayperMapLibre({
  style,
  location,
  routePath = [],
  replayPath = [],
  zones = [],
  showZones = true,
  showUserLocation = true,
  followUserLocation = false,
  centerCoordinate,
  initialZoom = 14,
  followZoomLevel = 16,
  fitToContent = false,
  interactive = true,
  routeColor = WAYPER_GREEN,
  replayColor = "#fdcb6e",
  mapStyle = WAYPER_DARK_MAP_STYLE,
  contentPadding = { top: 80, right: 80, bottom: 220, left: 80 },
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const routeCollection = useMemo(
    () => buildFeatureCollection([buildLineStringFeature(routePath, { kind: "route" })]),
    [routePath]
  );
  const routeHeadCollection = useMemo(
    () => buildFeatureCollection([buildPointFeature(Array.isArray(routePath) ? routePath[routePath.length - 1] : null, { kind: "route-head" })]),
    [routePath]
  );
  const replayCollection = useMemo(
    () => buildFeatureCollection([buildLineStringFeature(replayPath, { kind: "replay" })]),
    [replayPath]
  );
  const replayHeadCollection = useMemo(
    () => buildFeatureCollection([buildPointFeature(Array.isArray(replayPath) ? replayPath[replayPath.length - 1] : null, { kind: "replay-head" })]),
    [replayPath]
  );
  const userLocationCollection = useMemo(
    () => buildFeatureCollection(showUserLocation ? [buildPointFeature(location, { kind: "user-location" })] : []),
    [location, showUserLocation]
  );
  const zonesCollection = useMemo(
    () => buildFeatureCollection(showZones ? buildZoneFeatures(zones) : []),
    [showZones, zones]
  );

  const hasRoute = routeCollection.features.length > 0;
  const hasRouteHead = routeHeadCollection.features.length > 0 && !showUserLocation;
  const hasReplay = replayCollection.features.length > 0;
  const hasReplayHead = replayHeadCollection.features.length > 0;
  const hasUserLocation = userLocationCollection.features.length > 0;
  const hasZones = zonesCollection.features.length > 0;
  const initialCenter = useMemo(
    () => pickInitialCenter({ centerCoordinate, location, routePath, replayPath, zones }),
    [centerCoordinate, location, routePath, replayPath, zones]
  );
  const bounds = useMemo(
    () => (fitToContent ? buildBounds([zonesCollection, replayCollection, routeCollection]) : null),
    [fitToContent, zonesCollection, replayCollection, routeCollection]
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
        }}
      >
        <Camera
          initialViewState={bounds ? { bounds, padding: contentPadding } : { center: initialCenter, zoom: initialZoom }}
          bounds={bounds || undefined}
          center={!bounds ? initialCenter : undefined}
          zoom={followUserLocation ? followZoomLevel : !bounds ? initialZoom : undefined}
          padding={bounds ? contentPadding : undefined}
          duration={450}
        />

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
                "line-color": WAYPER_GREEN,
                "line-blur": 5,
                "line-opacity": 0.34,
                "line-width": 11,
              }}
            />
            <Layer
              id="wayper-zones-fill"
              type="fill"
              source="wayper-zones-source"
              paint={{
                "fill-color": WAYPER_GREEN,
                "fill-opacity": 0.24,
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
                "line-color": WAYPER_GREEN,
                "line-opacity": 0.86,
                "line-width": 3.5,
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
                "line-blur": 3,
                "line-width": 13,
                "line-opacity": 0.32,
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
                "line-gradient": [
                  "interpolate",
                  ["linear"],
                  ["line-progress"],
                  0,
                  "rgba(0, 230, 118, 0.38)",
                  0.78,
                  routeColor,
                  1,
                  "#ecfff6",
                ],
                "line-width": 6,
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
                "line-gradient": [
                  "interpolate",
                  ["linear"],
                  ["line-progress"],
                  0,
                  "rgba(253, 203, 110, 0.3)",
                  0.8,
                  replayColor,
                  1,
                  "#fff4cf",
                ],
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
});
