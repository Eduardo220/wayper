import { subscribePublicProfile, hasProfileFriendship, listProfileRuns, loadCurrentProfile } from "./userProfileRepository.js";
import runRepository from "./runRepository.js";
import territoryRepository from "./territoryRepository.js";
import { listAchievements } from "./achievementRepository.js";
import { getRunTimestamp, isFinishedRunForStats, recordBelongsToUser } from "./profileStats.js";
import { canViewRun, sanitizeTerritoryForViewer } from "../services/territory/territoryPrivacyService.js";
import { fetchTerritoriesByOwnerId } from "../services/territory/territoryStorageService.js";
import { normalizeProfile, publicProfileRun } from "../utils/profileModel.js";

const fulfilled = (result, fallback) => result.status === "fulfilled" ? result.value : fallback;

// Adapter over existing owners; no profile cache, persistence or alternate territorial state.
export function subscribeProfileIdentity(identity, callback, previewData = null) {
  let active = true;
  const preview = typeof __DEV__ !== "undefined" && __DEV__ && identity.preview === true && !identity.own;
  const emit = (result) => {
    const data = identity.own && result.data ? { ...result.data.profile, ...result.data.userDoc } : result.data;
    if (active) callback({ profile: normalizeProfile(data, { ...identity, preview }), error: result.error });
  };
  let unsubscribe;
  if (identity.invalid) emit({ data: null, error: null });
  else if (identity.own) loadCurrentProfile().then(emit).catch((error) => emit({ data: null, error }));
  else if (preview) {
    const data = previewData?.id === identity.userId ? previewData : null;
    emit({ data: data ? { ...data, totalDistance: data.totalKm * 1000, totalArea: data.areaKm2 * 1e6 } : null, error: null });
  } else unsubscribe = subscribePublicProfile(identity.userId, emit);
  return () => { active = false; unsubscribe?.(); };
}

export async function loadProfileTab(profile, tab, viewerId, after = null) {
  if (!profile || profile.restricted || profile.preview) return { items: [], error: null };
  const userId = profile.userId;
  if (tab === "achievements") {
    return { items: profile.own ? await listAchievements({ userId }) : [], error: null };
  }
  if (profile.own && tab === "runs") {
    const result = await runRepository.list();
    return { items: result.data.filter((run) => recordBelongsToUser(run, userId) && isFinishedRunForStats(run))
      .sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a)), error: result.error };
  }
  if (profile.own && tab === "territory") {
    const [territories, legacy, activity] = await Promise.allSettled([territoryRepository.list(), territoryRepository.listLegacyZones(), territoryRepository.listEvents()]);
    const current = fulfilled(territories, { data: [], error: territories.reason });
    const zones = fulfilled(legacy, { data: [], error: legacy.reason });
    const events = fulfilled(activity, { data: [], error: activity.reason });
    const known = new Set(current.data.map((item) => item.id));
    return { items: [...current.data, ...zones.data.filter((item) => !known.has(item.id))]
      .filter((item) => recordBelongsToUser(item, userId) && !["deleted", "split", "conquered"].includes(item.status)),
    events: events.data.filter((event) => recordBelongsToUser(event, userId)), error: current.error || zones.error || events.error };
  }
  const isFriend = await hasProfileFriendship(viewerId, userId);
  if (tab === "runs") {
    const page = await listProfileRuns(userId, after);
    return { items: page.items.filter((run) => canViewRun({ run, viewerId, ownerId: userId, relationship: { isFriend } }))
      .map((run) => publicProfileRun(run, userId)), nextCursor: page.nextCursor, error: null };
  }
  const territories = await fetchTerritoriesByOwnerId(userId, { includeLocal: false, limitTo: 80 });
  return { items: territories.map((territory) => sanitizeTerritoryForViewer(territory, { id: viewerId, relationship: { isFriend } })).filter(Boolean), error: null };
}
