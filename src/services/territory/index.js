export { TERRITORY_CONFIG } from "./territoryConfig.js";
export {
  TERRITORY_CAPTURE_FAILURE,
  TERRITORY_EVENT_TYPE,
  TERRITORY_SOURCE,
  TERRITORY_STATUS,
} from "./territoryTypes.js";
export {
  TERRITORY_ANTI_FRAUD_CONFIG,
  validateRunForTerritoryCapture,
} from "./territoryAntiFraudService.js";
export {
  canViewRun,
  canViewTerritory,
  canViewTerritoryEvent,
  sanitizeRunForViewer,
  sanitizeTerritoryForViewer,
  sanitizeEventForViewer,
} from "./territoryPrivacyService.js";
export {
  buildTerritoryFromLegacyZone,
  migrateLegacyZonesToTerritories,
} from "./territoryMigrationService.js";
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
  routeToZoneGeometry,
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
  TERRITORY_LEADERBOARDS_STORAGE_KEY,
  TERRITORY_SYNC_META_STORAGE_KEY,
  fetchActiveTerritoriesNear,
  fetchTerritoriesByBbox,
  fetchTerritoriesByCellIds,
  fetchTerritoriesByOwnerId,
  fetchTerritoryLeaderboardByCellId,
  fetchTerritoryById,
  loadLocalTerritoryLeaderboards,
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
  saveLocalTerritoryLeaderboard,
  saveLocalTerritoryLeaderboards,
  saveTerritoryEventRemote,
  saveTerritoryLeaderboardRemote,
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
export {
  getAreaNeededToLead,
  getLeaderCellsForViewport,
  getLeaderForLocation,
  getLeaderboardForCell,
  getUserLocalStanding,
  recalculateLeaderboardsForCells,
} from "./territoryLeaderboardService.js";
export {
  applyTerritoryCaptureStats,
} from "./territoryStatsService.js";
export {
  WAYPER_CURRENT_USER_COLOR,
  buildTerritoryMapProps,
  getOwnerColor,
  leaderCellsToFeatureCollection,
  normalizeTerritoryForMap,
  territoriesToFeatureCollection,
} from "./territoryMapService.js";
export {
  buildTerritoryMapParams,
  fetchTerritoryFeed,
  filterCompetitiveFeedItems,
  filterTerritoryEventsByPrivacy,
  loadLocalTerritoryFeed,
  mergeRunsZonesAndTerritoryEvents,
  normalizeRunForFeed,
  normalizeTerritoryEventForFeed,
  normalizeZoneForFeed,
} from "./territoryFeedService.js";
