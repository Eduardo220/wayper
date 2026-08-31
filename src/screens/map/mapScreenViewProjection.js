import {
  getRenderablePathForRun,
  getRenderableSegmentsForRun,
  sanitizeRunPath,
} from "../../services/runTracking";
import { getFormattedPace } from "../../utils/pace";
import { getRunDisplayTitle } from "../../utils/runDisplayTitle";
import { sanitizeSegmentPath } from "./activeRunProjection.js";

const formatDuration = (seconds = 0) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
};

export const formatMapDate = (date) => {
  if (!date) return "Agora";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? String(date) : parsed.toLocaleString();
};

export const formatMapArea = (areaM2 = 0) => {
  const area = Math.max(0, Number(areaM2) || 0);
  return area >= 1000000
    ? `${(area / 1000000).toFixed(2)} km2`
    : `${Math.round(area).toLocaleString("pt-BR")} m2`;
};

export function projectVisibleMapZones({
  showZones,
  running,
  mode,
  polygons,
  showRunModal,
  showSavedModal,
  completedZonePreview,
}) {
  const active = showZones && running && mode === "zones" && Array.isArray(polygons) ? polygons : [];
  const finished = showZones && (showRunModal || showSavedModal) && Array.isArray(completedZonePreview)
    ? completedZonePreview
    : [];
  return finished.length ? finished : active;
}

export function partitionTerritories(territories, currentUserId) {
  const items = Array.isArray(territories) ? territories : [];
  const mine = (territory) => String(territory.ownerId || territory.userId || "") === String(currentUserId);
  return {
    mine: items.filter(mine).slice(0, 80),
    others: items.filter((territory) => !mine(territory)).slice(0, 80),
  };
}

export function projectSavedRun(run) {
  const saved = run || {};
  const path = sanitizeRunPath(getRenderablePathForRun(saved));
  const segments = getRenderableSegmentsForRun(saved)
    .map((segment, index) => sanitizeSegmentPath(segment, index))
    .filter((segment) => segment.length >= 2);
  const originalPath = sanitizeRunPath(saved.trustedPath || saved.path || path);
  const zoneCoords = sanitizeRunPath(saved.zoneCoords || saved.zone?.coords || []);
  const isZone = saved.mode === "zones" || Number(saved.area || 0) > 0 || zoneCoords.length >= 3;
  const displayTitle = getRunDisplayTitle(run);
  const name = saved.name || (isZone ? "Captura por zonas salva" : "Corrida salva");
  return {
    path: path.length > 1 ? path : originalPath,
    segments,
    zoneCoords,
    isZone,
    displayTitle,
    name,
    shareSubtitle: name && name !== displayTitle ? name : (isZone ? "Corrida por zonas" : "Corrida livre"),
    savedTitle: isZone ? "Corrida por zonas salva" : "Corrida salva",
    shareTitle: isZone ? "Compartilhar zonas" : "Compartilhar corrida",
    distance: `${((Number(saved.distance) || 0) / 1000).toFixed(2)} km`,
    duration: formatDuration(saved.duration),
    pace: getFormattedPace(saved.duration, Number(saved.distance) / 1000, { suffix: "/km" }),
    date: formatMapDate(saved.date),
    area: `${Math.round(Number(saved.area) || 0)} m2`,
  };
}
