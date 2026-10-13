const knownNumber = (value) => value == null || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0
  ? null : Number(value);

export function toCompetitiveProfile(data, playerId, fixture = false) {
  if (!data || data.isPrivate === true || data.profileVisibility === "private") return null;
  const distance = knownNumber(data.totalDistance ?? data.distance);
  const area = knownNumber(data.totalArea ?? data.area);
  const emailPrefix = data.email?.split("@")[0];
  const username = data.name || data.displayName || (data.username !== emailPrefix ? data.username : null) || null;
  const profile = {
    id: playerId,
    username,
    avatar: data.avatar || data.photoURL || null,
    secondary: data.groupName || data.teamName || data.city || data.country || null,
    level: knownNumber(data.level),
    progressPct: knownNumber(data.progressToNextLevelPct),
    totalKm: fixture ? knownNumber(data.totalKm) : distance == null ? null : distance / 1000,
    areaKm2: fixture ? knownNumber(data.areaKm2) : area == null ? null : area / 1_000_000,
    runs: knownNumber(data.totalRuns ?? data.runs),
    zonesCaptured: knownNumber(data.totalZones ?? data.zonesCaptured),
    retakes: knownNumber(data.retakes),
    totalXp: knownNumber(data.totalXp ?? data.globalPoints),
    preview: fixture,
  };
  return profile.username || [profile.totalKm, profile.areaKm2, profile.runs, profile.zonesCaptured, profile.totalXp].some((value) => value != null)
    ? profile : null;
}

export function selectCompetitiveProfile(remote, local, fixture, devEnabled) {
  if (remote) return toCompetitiveProfile(remote, remote.id || remote.uid);
  if (local) return toCompetitiveProfile(local, local.id || local.uid);
  if (devEnabled && fixture) return toCompetitiveProfile(fixture, fixture.id, true);
  return null;
}

export function localProfileSnapshot(row) {
  if (!row?.localOnly) return null;
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    city: row.city,
    level: row.level,
    totalDistance: row.totalDistance,
    totalArea: row.totalArea,
    totalRuns: row.totalRuns,
    totalZones: row.totalZones,
    totalXp: row.totalXp,
  };
}

export function formatProfileStat(value, kind) {
  if (value == null) return "—";
  if (kind === "km" || kind === "area") {
    return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${kind === "km" ? "km" : "km²"}`;
  }
  return value.toLocaleString("pt-BR");
}
