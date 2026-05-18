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
export {
  DEFAULT_TERRITORY_CELL_PRECISION,
  getCellCenter,
  getCellIdForLocation,
  getCellIdsForBbox,
  getCellIdsForGeometry,
  getCellPolygon,
} from "./territoryCellService.js";
export {
  TERRITORIES_STORAGE_KEY,
  TERRITORY_EVENTS_STORAGE_KEY,
  TERRITORY_SYNC_META_STORAGE_KEY,
  fetchActiveTerritoriesNear,
  fetchTerritoriesByBbox,
  fetchTerritoriesByCellIds,
  fetchTerritoryById,
  loadLocalTerritories,
  loadLocalTerritoryEvents,
  loadTerritorySyncMeta,
  markTerritoryDeletedRemote,
  normalizeTerritoryEventForRemote,
  normalizeTerritoryEventPayload,
  normalizeTerritoryForRemote,
  normalizeTerritoryPayload,
  removeLocalTerritory,
  saveLocalTerritories,
  saveLocalTerritory,
  saveLocalTerritoryEvent,
  saveLocalTerritoryEvents,
  saveTerritoryEventRemote,
  saveTerritoryRemote,
  saveTerritorySyncMeta,
  updateTerritoryRemote,
} from "./territoryStorageService.js";
export {
  createTerritoryEvent,
  generateTerritoryEventMessage,
} from "./territoryEventsService.js";
export {
  processRunTerritoryCapture,
} from "./territoryCaptureService.js";
