import { describe, expect, test } from "@jest/globals";
import {
  canViewRun,
  canViewTerritory,
  canViewTerritoryEvent,
  sanitizeEventForViewer,
  sanitizeRunForViewer,
  sanitizeTerritoryForViewer,
} from "../territoryPrivacyService.js";

describe("territoryPrivacyService", () => {
  test("owner ve corrida privada", () => {
    const run = { id: "run1", userId: "u1", visibility: "private", path: [{ latitude: 1, longitude: 2 }] };

    expect(canViewRun({ run, viewerId: "u1" })).toBe(true);
    expect(sanitizeRunForViewer(run, { id: "u1" })?.path).toHaveLength(1);
  });

  test("outro usuario nao ve corrida privada", () => {
    const run = { id: "run1", userId: "u1", visibility: "private", path: [{ latitude: 1, longitude: 2 }] };

    expect(canViewRun({ run, viewerId: "u2" })).toBe(false);
    expect(sanitizeRunForViewer(run, { id: "u2" })).toBeNull();
  });

  test("public pode ser visto por todos", () => {
    const territory = { id: "t1", ownerId: "u1", visibility: "public" };

    expect(canViewTerritory({ territory, viewerId: "u2" })).toBe(true);
  });

  test("followers respeita relacao preparada", () => {
    const event = { id: "e1", actorId: "u1", visibility: "followers" };

    expect(canViewTerritoryEvent({ event, viewerId: "u2", relationship: { isFriend: true } })).toBe(true);
    expect(canViewTerritoryEvent({ event, viewerId: "u2", relationship: { isFriend: false } })).toBe(false);
  });

  test("sanitizeRunForViewer remove path completo de nao owner", () => {
    const run = {
      id: "run1",
      userId: "u1",
      visibility: "public",
      path: [{ latitude: 1, longitude: 2 }],
      zoneCoords: [{ latitude: 1, longitude: 2 }],
    };

    const sanitized = sanitizeRunForViewer(run, { id: "u2" });

    expect(sanitized.path).toEqual([]);
    expect(sanitized.pathHidden).toBe(true);
    expect(sanitized.coordsPreview).toHaveLength(1);
  });

  test("sanitizeTerritoryForViewer remove path bruto", () => {
    const territory = { id: "t1", ownerId: "u1", visibility: "public", rawPath: [1], geometry: { type: "Polygon", coordinates: [] } };

    const sanitized = sanitizeTerritoryForViewer(territory, { id: "u2" });

    expect(sanitized.rawPath).toBeUndefined();
    expect(sanitized.pathHidden).toBe(true);
    expect(sanitized.geometry).toBe(territory.geometry);
  });

  test("sanitizeEventForViewer remove path bruto", () => {
    const event = { id: "e1", actorId: "u1", visibility: "public", rawPath: [1], geometry: { type: "Polygon", coordinates: [] } };

    const sanitized = sanitizeEventForViewer(event, { id: "u2" });

    expect(sanitized.rawPath).toBeUndefined();
    expect(sanitized.pathHidden).toBe(true);
  });
});
