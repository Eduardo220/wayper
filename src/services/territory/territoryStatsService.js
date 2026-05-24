const USER_TERRITORY_STATS_COLLECTION = "user_territory_stats";
const USERS_COLLECTION = "users";

let firestoreBindings = null;

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNonNegative(value) {
  return Math.max(0, toFiniteNumber(value, 0));
}

function getMonthKey(date = new Date()) {
  const parsed = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, "0")}`;
}

function getExisting(map = {}, userId) {
  return (map && userId ? map[userId] : null) || {};
}

async function getFirestoreBindings() {
  if (firestoreBindings) return firestoreBindings;

  const firestore = await import("firebase/firestore");
  const firebaseConfig = await import("../../firebaseConfig.js");

  firestoreBindings = {
    db: firebaseConfig.db,
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    setDoc: firestore.setDoc,
  };

  return firestoreBindings;
}

async function loadRemoteDoc(collectionName, userId) {
  const { db, doc, getDoc } = await getFirestoreBindings();
  const snap = await getDoc(doc(db, collectionName, userId));
  return snap?.exists?.() ? { id: snap.id, ...snap.data() } : {};
}

async function persistPatch(collectionName, userId, patch) {
  const { db, doc, setDoc } = await getFirestoreBindings();
  await setDoc(doc(db, collectionName, userId), patch, { merge: true });
}

function buildActorUpdates({
  existingStats,
  existingUser,
  actorUserId,
  capturedAreaM2,
  newAreaM2,
  stolenAreaM2,
  distanceMeters,
  affectedUsers,
  conqueredTerritories,
  becameLeaderInCells,
  monthKey,
  updatedAt,
}) {
  const areaGainM2 = clampNonNegative(newAreaM2) + clampNonNegative(stolenAreaM2);
  const stealsCountDelta = clampNonNegative(stolenAreaM2) > 0 ? 1 : 0;
  const conqueredCountDelta = Array.isArray(conqueredTerritories) ? conqueredTerritories.length : 0;
  const cellsLedDelta = new Set((becameLeaderInCells || []).filter(Boolean).map(String)).size;

  const statsPatch = {
    userId: actorUserId,
    monthKey,
    totalAreaM2: clampNonNegative(existingStats.totalAreaM2) + areaGainM2,
    monthlyAreaM2: clampNonNegative(existingStats.monthlyAreaM2) + areaGainM2,
    totalCapturedAreaM2: clampNonNegative(existingStats.totalCapturedAreaM2) + clampNonNegative(capturedAreaM2),
    totalStolenAreaM2: clampNonNegative(existingStats.totalStolenAreaM2) + clampNonNegative(stolenAreaM2),
    totalLostAreaM2: clampNonNegative(existingStats.totalLostAreaM2),
    totalZoneAreaM2: clampNonNegative(existingStats.totalZoneAreaM2) + areaGainM2,
    totalDistanceM: clampNonNegative(existingStats.totalDistanceM ?? existingStats.totalDistance) + clampNonNegative(distanceMeters),
    totalRuns: clampNonNegative(existingStats.totalRuns) + 1,
    totalZones: clampNonNegative(existingStats.totalZones) + 1,
    territoriesCount: clampNonNegative(existingStats.territoriesCount) + 1,
    capturesCount: clampNonNegative(existingStats.capturesCount) + 1,
    stealsCount: clampNonNegative(existingStats.stealsCount) + stealsCountDelta,
    conqueredCount: clampNonNegative(existingStats.conqueredCount) + conqueredCountDelta,
    cellsLedCount: clampNonNegative(existingStats.cellsLedCount) + cellsLedDelta,
    affectedUsersCount: Array.isArray(affectedUsers) ? affectedUsers.length : 0,
    updatedAt,
  };

  const usersPatch = {
    totalArea: clampNonNegative(existingUser.totalArea ?? existingUser.area) + areaGainM2,
    area: clampNonNegative(existingUser.area ?? existingUser.totalArea) + areaGainM2,
    totalZoneAreaM2: clampNonNegative(existingUser.totalZoneAreaM2) + areaGainM2,
    monthlyArea: clampNonNegative(existingUser.monthlyArea) + areaGainM2,
    totalZones: clampNonNegative(existingUser.totalZones ?? existingUser.zones) + 1,
    zones: clampNonNegative(existingUser.zones ?? existingUser.totalZones) + 1,
    totalRuns: clampNonNegative(existingUser.totalRuns) + 1,
    totalDistanceM: clampNonNegative(existingUser.totalDistanceM ?? existingUser.totalDistance ?? existingUser.distance) + clampNonNegative(distanceMeters),
    totalDistance: clampNonNegative(existingUser.totalDistance ?? existingUser.distance) + clampNonNegative(distanceMeters),
    monthlyPoints: clampNonNegative(existingUser.monthlyPoints) + areaGainM2,
    globalPoints: clampNonNegative(existingUser.globalPoints) + areaGainM2,
    updatedAt,
  };

  return { statsPatch, usersPatch };
}

function buildTargetUpdates({ existingStats, existingUser, affectedUser, monthKey, updatedAt }) {
  const lostAreaM2 = clampNonNegative(affectedUser.affectedAreaM2 ?? affectedUser.lostAreaM2);
  const nextTotalAreaM2 = clampNonNegative(existingStats.totalAreaM2) - lostAreaM2;
  const nextUserTotalArea = clampNonNegative(existingUser.totalArea ?? existingUser.area) - lostAreaM2;

  const statsPatch = {
    userId: affectedUser.userId,
    monthKey,
    totalAreaM2: clampNonNegative(nextTotalAreaM2),
    monthlyAreaM2: clampNonNegative(clampNonNegative(existingStats.monthlyAreaM2) - lostAreaM2),
    totalCapturedAreaM2: clampNonNegative(existingStats.totalCapturedAreaM2),
    totalStolenAreaM2: clampNonNegative(existingStats.totalStolenAreaM2),
    totalLostAreaM2: clampNonNegative(existingStats.totalLostAreaM2) + lostAreaM2,
    territoriesCount: clampNonNegative(existingStats.territoriesCount),
    capturesCount: clampNonNegative(existingStats.capturesCount),
    stealsCount: clampNonNegative(existingStats.stealsCount),
    conqueredCount: clampNonNegative(existingStats.conqueredCount),
    cellsLedCount: clampNonNegative(existingStats.cellsLedCount),
    updatedAt,
  };

  const usersPatch = {
    totalArea: clampNonNegative(nextUserTotalArea),
    area: clampNonNegative(clampNonNegative(existingUser.area ?? existingUser.totalArea) - lostAreaM2),
    monthlyArea: clampNonNegative(clampNonNegative(existingUser.monthlyArea) - lostAreaM2),
    updatedAt,
  };

  return { statsPatch, usersPatch };
}

export async function applyTerritoryCaptureStats({
  actorUserId,
  capturedAreaM2 = 0,
  newAreaM2 = 0,
  stolenAreaM2 = 0,
  ownMergedAreaM2 = 0,
  distanceMeters = 0,
  affectedUsers = [],
  conqueredTerritories = [],
  becameLeaderInCells = [],
  persist = true,
  existingStats = {},
  existingUsers = {},
  updatedAt = new Date().toISOString(),
} = {}) {
  if (!actorUserId) {
    return {
      ok: false,
      reason: "missing_actor",
      statPatches: {},
      userPatches: {},
    };
  }

  const monthKey = getMonthKey(updatedAt);
  const statPatches = {};
  const userPatches = {};

  const actorExistingStats = persist
    ? { ...await loadRemoteDoc(USER_TERRITORY_STATS_COLLECTION, actorUserId), ...getExisting(existingStats, actorUserId) }
    : getExisting(existingStats, actorUserId);
  const actorExistingUser = persist
    ? { ...await loadRemoteDoc(USERS_COLLECTION, actorUserId), ...getExisting(existingUsers, actorUserId) }
    : getExisting(existingUsers, actorUserId);

  const actorUpdates = buildActorUpdates({
    existingStats: actorExistingStats,
    existingUser: actorExistingUser,
    actorUserId,
    capturedAreaM2,
    newAreaM2,
    stolenAreaM2,
    ownMergedAreaM2,
    distanceMeters,
    affectedUsers,
    conqueredTerritories,
    becameLeaderInCells,
    monthKey,
    updatedAt,
  });

  statPatches[actorUserId] = actorUpdates.statsPatch;
  userPatches[actorUserId] = actorUpdates.usersPatch;

  for (const affectedUser of Array.isArray(affectedUsers) ? affectedUsers : []) {
    const targetUserId = affectedUser?.userId;
    if (!targetUserId || targetUserId === actorUserId) continue;

    const targetExistingStats = persist
      ? { ...await loadRemoteDoc(USER_TERRITORY_STATS_COLLECTION, targetUserId), ...getExisting(existingStats, targetUserId) }
      : getExisting(existingStats, targetUserId);
    const targetExistingUser = persist
      ? { ...await loadRemoteDoc(USERS_COLLECTION, targetUserId), ...getExisting(existingUsers, targetUserId) }
      : getExisting(existingUsers, targetUserId);

    const targetUpdates = buildTargetUpdates({
      existingStats: targetExistingStats,
      existingUser: targetExistingUser,
      affectedUser,
      monthKey,
      updatedAt,
    });

    statPatches[targetUserId] = targetUpdates.statsPatch;
    userPatches[targetUserId] = targetUpdates.usersPatch;
  }

  if (persist) {
    for (const [userId, patch] of Object.entries(statPatches)) {
      await persistPatch(USER_TERRITORY_STATS_COLLECTION, userId, patch);
    }
    for (const [userId, patch] of Object.entries(userPatches)) {
      await persistPatch(USERS_COLLECTION, userId, patch);
    }
  }

  return {
    ok: true,
    actorUserId,
    monthKey,
    statPatches,
    userPatches,
    actorStats: statPatches[actorUserId],
    actorUserPatch: userPatches[actorUserId],
    ownMergedAreaM2: clampNonNegative(ownMergedAreaM2),
  };
}

export default {
  applyTerritoryCaptureStats,
};

