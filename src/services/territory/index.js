export { TERRITORY_CONFIG } from "./territoryConfig.js";
export {
  TERRITORY_CAPTURE_FAILURE,
  TERRITORY_EVENT_TYPE,
  TERRITORY_SOURCE,
  TERRITORY_STATUS,
} from "./territoryTypes.js";
export {
  buildCaptureGeometryFromPath,
  calculateDistanceMeters,
  calculateGeometryAreaM2,
  calculateGeometryBbox,
  calculateGeometryCenter,
  differenceGeometries,
  geometryToPreviewCoords,
  intersectGeometries,
  isClosedLoop,
  isGeometryRenderable,
  normalizeGeometry,
  sanitizePathForTerritory,
  unionGeometries,
} from "./territoryGeometryService.js";

