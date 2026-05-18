import { TERRITORY_CONFIG } from "./territoryConfig.js";
import {
  buildCaptureGeometryFromPath,
  calculateGeometryAreaM2,
  calculateGeometryBbox,
  calculateGeometryCenter,
  differenceGeometries,
  geometryToPreviewCoords,
  intersectGeometries,
  normalizeGeometry,
  unionGeometries,
} from "./territoryGeometryService.js";
import { getCellIdsForGeometry } from "./territoryCellService.js";
import {
  fetchActiveTerritoriesNear,
  saveLocalTerritories,
  saveLocalTerritoryEvents,
} from "./territoryStorageService.js";
import { createTerritoryEvent } from "./territoryEventsService.js";
import {
  TERRITORY_CAPTURE_FAILURE,
  TERRITORY_EVENT_TYPE,
  TERRITORY_SOURCE,
  TERRITORY_STATUS,
} from "./territoryTypes.js";

const MERGE_TOUCH_AREA_EPSILON_M2 = 0.5;

function makeId(prefix = "territory") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getOwnerId(territory = {}) {
  return territory.ownerId || territory.userId || territory.uid || null;
}

function getOwnerName(territory = {}) {
  return territory.ownerName || territory.userName || territory.name || "Atleta Wayper";
}

function getOwnerAvatar(territory = {}) {
  return territory.ownerAvatar || territory.userAvatar || territory.avatar || null;
}

function createActor({ userId, userName, userAvatar }) {
  return {
    id: userId || null,
    name: userName || "Atleta Wayper",
    avatar: userAvatar || null,
  };
}

function createTarget(territory = {}) {
  return {
    id: getOwnerId(territory),
    name: getOwnerName(territory),
    avatar: getOwnerAvatar(territory),
  };
}

function getTerritoryAreaM2(territory = {}) {
  const explicitArea = toFiniteNumber(territory.areaM2 ?? territory.area, null);
  return explicitArea != null ? explicitArea : calculateGeometryAreaM2(territory.geometry);
}

function normalizeBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const values = bbox.slice(0, 4).map((value) => toFiniteNumber(value, NaN));
  if (values.some((value) => !Number.isFinite(value))) return null;
  return [
    Math.min(values[0], values[2]),
    Math.min(values[1], values[3]),
    Math.max(values[0], values[2]),
    Math.max(values[1], values[3]),
  ];
}

function bboxesTouchOrOverlap(a, b) {
  const first = normalizeBbox(a);
  const second = normalizeBbox(b);
  if (!first || !second) return false;

  return !(
    first[2] < second[0] ||
    first[0] > second[2] ||
    first[3] < second[1] ||
    first[1] > second[3]
  );
}

function enrichTerritoryGeometry(territory = {}, overrides = {}) {
  const geometry = normalizeGeometry(overrides.geometry || territory.geometry);
  const areaM2 = toFiniteNumber(overrides.areaM2, null) ?? calculateGeometryAreaM2(geometry);
  const bbox = calculateGeometryBbox(geometry);
  const center = calculateGeometryCenter(geometry);
  const cellIds = getCellIdsForGeometry(geometry);

  return {
    ...territory,
    ...overrides,
    geometry,
    areaM2,
    bbox,
    center,
    coordsPreview: geometryToPreviewCoords(geometry, TERRITORY_CONFIG.maxPoints),
    cellIds,
  };
}

function markTerritoryInactive(territory = {}, patch = {}) {
  return {
    ...territory,
    ...patch,
    status: patch.status || TERRITORY_STATUS.deleted,
    pendingSync: true,
    synced: false,
    version: Number(territory.version || 1) + 1,
    updatedAt: patch.updatedAt || new Date().toISOString(),
  };
}

function createRunContext({
  userId,
  runId,
  mode,
  distanceMeters,
  durationSeconds,
  visibility,
  createdAt,
}) {
  return {
    userId: userId || null,
    runId: runId || null,
    mode: mode || "free",
    distanceMeters: toFiniteNumber(distanceMeters, 0),
    durationSeconds: toFiniteNumber(durationSeconds, 0),
    visibility,
    createdAt,
  };
}

function addAffectedUser(map, territory, areaM2) {
  const ownerId = getOwnerId(territory);
  if (!ownerId) return;

  const existing = map.get(ownerId) || {
    userId: ownerId,
    userName: getOwnerName(territory),
    userAvatar: getOwnerAvatar(territory),
    affectedAreaM2: 0,
  };
  existing.affectedAreaM2 += Math.max(0, areaM2);
  map.set(ownerId, existing);
}

async function scheduleTerritorySync() {
  try {
    const sync = await import("../../utils/sync.js");
    sync.scheduleTerritoriesSync?.();
    sync.scheduleTerritoryEventsSync?.();
  } catch {
    // Sync scheduling is best effort; local capture data must remain saved.
  }
}

async function getCandidateTerritories({ existingTerritories, bbox, cellIds }) {
  if (Array.isArray(existingTerritories)) return existingTerritories;
  return fetchActiveTerritoriesNear({ bbox, cellIds, limitTo: 100 });
}

export async function processRunTerritoryCapture({
  userId,
  userName,
  userAvatar,
  runId,
  path,
  mode,
  distanceMeters,
  durationSeconds,
  visibility = "followers",
  createdAt = new Date().toISOString(),
  existingTerritories = null,
  persist = true,
} = {}) {
  const runContext = createRunContext({
    userId,
    runId,
    mode,
    distanceMeters,
    durationSeconds,
    visibility,
    createdAt,
  });

  if (mode !== "zones") {
    return {
      ok: false,
      reason: TERRITORY_CAPTURE_FAILURE.free_run,
    };
  }

  try {
    const capture = buildCaptureGeometryFromPath(path);
    if (!capture.ok) {
      return {
        ok: false,
        reason: capture.reason,
        details: capture.details,
        runContext,
      };
    }

    const actor = createActor({ userId, userName, userAvatar });
    const capturedTerritoryId = makeId(runId ? `territory_${runId}` : "territory");
    const captureGeometry = capture.geometry;
    const captureAreaM2 = capture.areaM2;
    const captureBbox = capture.bbox;
    const captureCellIds = getCellIdsForGeometry(captureGeometry);
    const candidates = await getCandidateTerritories({
      existingTerritories,
      bbox: captureBbox,
      cellIds: captureCellIds,
    });

    const activeCandidates = (Array.isArray(candidates) ? candidates : [])
      .filter((territory) => territory?.status === TERRITORY_STATUS.active)
      .map((territory) => enrichTerritoryGeometry(territory));

    const ownTerritories = activeCandidates.filter((territory) => getOwnerId(territory) === userId);
    const enemyTerritories = activeCandidates.filter((territory) => getOwnerId(territory) !== userId);

    let finalGeometry = captureGeometry;
    let stolenAreaM2 = 0;
    let ownOverlapAreaM2 = 0;
    let ownMergedAreaM2 = 0;

    const affectedUsers = new Map();
    const conqueredTerritories = [];
    const splitTerritories = [];
    const mergedTerritories = [];
    const updatedTerritories = [];
    const deletedTerritories = [];
    const events = [];

    for (const enemy of enemyTerritories) {
      if (!enemy.geometry) continue;

      const intersection = intersectGeometries(enemy.geometry, captureGeometry);
      if (!intersection.ok || intersection.areaM2 <= MERGE_TOUCH_AREA_EPSILON_M2) continue;

      stolenAreaM2 += intersection.areaM2;
      addAffectedUser(affectedUsers, enemy, intersection.areaM2);

      events.push(
        createTerritoryEvent({
          type: TERRITORY_EVENT_TYPE.steal,
          actor,
          target: createTarget(enemy),
          runId,
          territoryId: capturedTerritoryId,
          affectedTerritoryId: enemy.id,
          affectedAreaM2: intersection.areaM2,
          geometry: intersection.geometry,
          cellIds: getCellIdsForGeometry(intersection.geometry),
          visibility,
          createdAt,
        })
      );

      const remaining = differenceGeometries(enemy.geometry, captureGeometry);
      if (!remaining.ok || remaining.areaM2 < TERRITORY_CONFIG.minAreaM2) {
        const conquered = markTerritoryInactive(enemy, {
          status: TERRITORY_STATUS.conquered,
          deleted: true,
          conqueredBy: userId || null,
          conqueredByName: userName || null,
          conqueredAt: createdAt,
          updatedAt: createdAt,
        });
        conqueredTerritories.push(conquered);
        deletedTerritories.push(conquered);
        events.push(
          createTerritoryEvent({
            type: TERRITORY_EVENT_TYPE.conquered,
            actor,
            target: createTarget(enemy),
            runId,
            territoryId: capturedTerritoryId,
            affectedTerritoryId: enemy.id,
            affectedAreaM2: getTerritoryAreaM2(enemy),
            geometry: enemy.geometry,
            cellIds: enemy.cellIds,
            visibility,
            createdAt,
          })
        );
        continue;
      }

      const updatedEnemy = enrichTerritoryGeometry(enemy, {
        geometry: remaining.geometry,
        areaM2: remaining.areaM2,
        version: Number(enemy.version || 1) + 1,
        pendingSync: true,
        synced: false,
        updatedAt: createdAt,
      });

      updatedTerritories.push(updatedEnemy);

      if (remaining.geometry?.type === "MultiPolygon") {
        splitTerritories.push(updatedEnemy);
        events.push(
          createTerritoryEvent({
            type: TERRITORY_EVENT_TYPE.split,
            actor,
            target: createTarget(enemy),
            runId,
            territoryId: capturedTerritoryId,
            affectedTerritoryId: enemy.id,
            affectedAreaM2: intersection.areaM2,
            geometry: remaining.geometry,
            cellIds: updatedEnemy.cellIds,
            visibility,
            createdAt,
          })
        );
      }
    }

    for (const own of ownTerritories) {
      if (!own.geometry) continue;

      const ownIntersection = intersectGeometries(own.geometry, captureGeometry);
      const union = unionGeometries([finalGeometry, own.geometry]);
      const touchesOrOverlaps = ownIntersection.ok || bboxesTouchOrOverlap(
        calculateGeometryBbox(finalGeometry),
        own.bbox
      );

      if (!union.ok || !touchesOrOverlaps) continue;

      if (ownIntersection.ok) ownOverlapAreaM2 += ownIntersection.areaM2;
      ownMergedAreaM2 += getTerritoryAreaM2(own);
      finalGeometry = union.geometry;

      const merged = markTerritoryInactive(own, {
        status: TERRITORY_STATUS.deleted,
        deleted: true,
        mergedInto: capturedTerritoryId,
        mergedAt: createdAt,
        updatedAt: createdAt,
      });
      mergedTerritories.push(merged);
      deletedTerritories.push(merged);

      events.push(
        createTerritoryEvent({
          type: TERRITORY_EVENT_TYPE.merge,
          actor,
          target: actor,
          runId,
          territoryId: capturedTerritoryId,
          affectedTerritoryId: own.id,
          affectedAreaM2: getTerritoryAreaM2(own),
          geometry: own.geometry,
          cellIds: own.cellIds,
          visibility,
          createdAt,
        })
      );
    }

    const capturedAreaM2 = calculateGeometryAreaM2(finalGeometry);
    const capturedTerritory = enrichTerritoryGeometry(
      {
        id: capturedTerritoryId,
        ownerId: userId || null,
        userId: userId || null,
        ownerName: userName || "Atleta Wayper",
        ownerAvatar: userAvatar || null,
        runId: runId || null,
        status: TERRITORY_STATUS.active,
        source: TERRITORY_SOURCE.closed_loop,
        visibility,
        version: 1,
        capturedAt: createdAt,
        updatedAt: createdAt,
        pendingSync: true,
        synced: false,
        distanceMeters: toFiniteNumber(distanceMeters, 0),
        durationSeconds: toFiniteNumber(durationSeconds, 0),
      },
      {
        geometry: finalGeometry,
        areaM2: capturedAreaM2,
      }
    );

    events.unshift(
      createTerritoryEvent({
        type: TERRITORY_EVENT_TYPE.capture,
        actor,
        target: null,
        runId,
        territoryId: capturedTerritory.id,
        affectedAreaM2: capturedAreaM2,
        geometry: capturedTerritory.geometry,
        cellIds: capturedTerritory.cellIds,
        visibility,
        createdAt,
      })
    );

    const newAreaM2 = Math.max(0, captureAreaM2 - stolenAreaM2 - ownOverlapAreaM2);
    const territoriesToPersist = [
      capturedTerritory,
      ...updatedTerritories,
      ...deletedTerritories,
    ];

    if (persist) {
      await saveLocalTerritories(territoriesToPersist, {
        preserveTimestamps: true,
        preserveVersion: true,
      });
      await saveLocalTerritoryEvents(events, {
        preserveTimestamps: true,
        preserveVersion: true,
      });
      scheduleTerritorySync();
    }

    const summary = {
      capturedAreaM2,
      newAreaM2,
      stolenAreaM2,
      ownMergedAreaM2,
      conqueredCount: conqueredTerritories.length,
      splitCount: splitTerritories.length,
      mergedCount: mergedTerritories.length,
      eventCount: events.length,
    };

    return {
      ok: true,
      capturedTerritory,
      capturedAreaM2,
      newAreaM2,
      stolenAreaM2,
      ownMergedAreaM2,
      affectedUsers: Array.from(affectedUsers.values()),
      conqueredTerritories,
      splitTerritories,
      mergedTerritories,
      updatedTerritories,
      deletedTerritories,
      events,
      cellIds: capturedTerritory.cellIds,
      summary,
    };
  } catch (error) {
    return {
      ok: false,
      reason: TERRITORY_CAPTURE_FAILURE.turf_error,
      details: {
        error: error?.message || String(error),
      },
      runContext,
    };
  }
}

export default {
  processRunTerritoryCapture,
};

