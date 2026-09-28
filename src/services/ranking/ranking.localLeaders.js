import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "../../firebaseConfig.js";

const safeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const isPrivateProfile = (profile = {}) =>
  profile.isPrivate === true || profile.profileVisibility === "private" || profile.visibility === "private";

const getUserName = (profile = {}, fallback = "Atleta") =>
  profile.userName || profile.name || profile.displayName || profile.username || fallback;

const getUserAvatar = (profile = {}, userId = "wayper") =>
  profile.avatar || profile.photoURL || profile.userAvatar || null;

function getUsersFromLeaderboard(leaderboard = {}) {
  if (leaderboard.users && typeof leaderboard.users === "object" && !Array.isArray(leaderboard.users)) {
    return Object.values(leaderboard.users);
  }
  return [];
}

function ensureUser(map, userId, profile = {}) {
  const id = String(userId || profile.userId || profile.id || "");
  if (!id) return null;
  if (isPrivateProfile(profile)) return null;

  const existing = map.get(id) || {
    id,
    userId: id,
    name: getUserName(profile),
    avatar: getUserAvatar(profile, id),
    city: profile.city || "",
    cellsLedCount: 0,
    leaderAreaM2: 0,
    totalAreaM2: 0,
    territoryCount: 0,
    totalStolenAreaM2: safeNumber(profile.totalStolenAreaM2),
    totalLostAreaM2: safeNumber(profile.totalLostAreaM2),
    bestCellId: null,
    bestCellAreaM2: 0,
    raw: profile,
  };

  existing.name = getUserName(profile, existing.name);
  existing.avatar = getUserAvatar(profile, id);
  existing.city = profile.city || existing.city || "";
  existing.totalStolenAreaM2 = Math.max(existing.totalStolenAreaM2, safeNumber(profile.totalStolenAreaM2));
  existing.totalLostAreaM2 = Math.max(existing.totalLostAreaM2, safeNumber(profile.totalLostAreaM2));
  map.set(id, existing);
  return existing;
}

export function normalizeLocalLeaderRanking(leaderboards = [], options = {}) {
  const rows = new Map();
  const profiles = new Map(
    (Array.isArray(options.users) ? options.users : [])
      .filter(Boolean)
      .map((user) => [String(user.id || user.uid || user.userId), user])
  );

  for (const leaderboard of Array.isArray(leaderboards) ? leaderboards : []) {
    if (!leaderboard?.cellId) continue;

    for (const user of getUsersFromLeaderboard(leaderboard)) {
      const userId = user.userId || user.id;
      const profile = { ...(profiles.get(String(userId)) || {}), ...user };
      const row = ensureUser(rows, userId, profile);
      if (!row) continue;

      row.totalAreaM2 += safeNumber(user.areaM2);
      row.territoryCount += safeNumber(user.territoryCount);
    }

    const leaderUserId = leaderboard.leaderUserId;
    if (!leaderUserId) continue;

    const leaderProfile = {
      ...(profiles.get(String(leaderUserId)) || {}),
      userId: leaderUserId,
      userName: leaderboard.leaderUserName,
      avatar: leaderboard.leaderAvatar,
    };
    const leader = ensureUser(rows, leaderUserId, leaderProfile);
    if (!leader) continue;

    const leaderAreaM2 = safeNumber(leaderboard.leaderAreaM2);
    leader.cellsLedCount += 1;
    leader.leaderAreaM2 += leaderAreaM2;
    leader.totalAreaM2 = Math.max(leader.totalAreaM2, leader.leaderAreaM2);
    if (leaderAreaM2 > leader.bestCellAreaM2) {
      leader.bestCellAreaM2 = leaderAreaM2;
      leader.bestCellId = leaderboard.cellId;
    }
  }

  return Array.from(rows.values())
    .sort((a, b) => {
      if (b.cellsLedCount !== a.cellsLedCount) return b.cellsLedCount - a.cellsLedCount;
      return b.leaderAreaM2 - a.leaderAreaM2;
    })
    .map((item, index) => ({
      ...item,
      area: item.leaderAreaM2,
      monthlyArea: item.leaderAreaM2,
      distance: 0,
      monthlyDistance: 0,
      rank: index + 1,
    }));
}

export async function fetchLocalLeadersRanking({ limitTo = 250 } = {}) {
  try {
    const snap = await getDocs(query(collection(db, "territory_leaderboards"), limit(limitTo)));
    const leaderboards = [];
    snap?.forEach?.((docSnap) => {
      leaderboards.push({
        cellId: docSnap.id,
        ...docSnap.data(),
      });
    });
    return normalizeLocalLeaderRanking(leaderboards);
  } catch (error) {
    console.warn("fetchLocalLeadersRanking error:", error);
    return [];
  }
}

export default {
  fetchLocalLeadersRanking,
  normalizeLocalLeaderRanking,
};
