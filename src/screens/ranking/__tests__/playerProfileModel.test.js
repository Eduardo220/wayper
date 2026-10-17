import { describe, expect, test } from "@jest/globals";
import { rankingPreviewData } from "../__fixtures__/rankingPreviewData.js";
import { playerProfilePreviewData } from "../__fixtures__/playerProfilePreviewData.js";
import { formatProfileStat, localProfileSnapshot, selectCompetitiveProfile, toCompetitiveProfile } from "../playerProfileModel.js";

describe("competitive player profile", () => {
  test("cada linha da prévia, inclusive VOCÊ, resolve o jogador certo", () => {
    for (const mode of ["km", "zones"]) {
      const preview = rankingPreviewData({ mode, scope: "global", period: "monthly" });
      for (const row of [...preview.rows, preview.me]) {
        const fixture = playerProfilePreviewData(row.id);
        expect(fixture?.username).toBe(row.name);
        expect(selectCompetitiveProfile(null, null, fixture, true)?.id).toBe(row.id);
      }
    }
    const me = selectCompetitiveProfile(null, null, playerProfilePreviewData("preview-me-km"), true);
    expect([me.totalKm, me.areaKm2, me.runs, me.zonesCaptured, me.retakes, me.totalXp]).toEqual([92.4, 15.3, 5, 12, 3, 2840]);
  });

  test("formata seis estatísticas e mantém desconhecido como indisponível", () => {
    const profile = selectCompetitiveProfile(null, null, playerProfilePreviewData("preview-me-zones"), true);
    expect([
      formatProfileStat(profile.totalKm, "km"),
      formatProfileStat(profile.areaKm2, "area"),
      formatProfileStat(profile.runs, "count"),
      formatProfileStat(profile.zonesCaptured, "count"),
      formatProfileStat(profile.retakes, "count"),
      formatProfileStat(profile.totalXp, "count"),
    ]).toEqual(["92,4 km", "15,3 km²", "5", "12", "3", "2.840"]);
    expect(formatProfileStat(null, "count")).toBe("—");
  });

  test("perfil real tem prioridade, produção não usa fixture e dados privados não aparecem", () => {
    const fixture = playerProfilePreviewData("preview-km-0");
    const remote = { id: "real-user", name: "Real", totalDistance: 46000, totalArea: 1200000, totalRuns: 5, totalZones: 12, totalXp: 2800 };
    expect(selectCompetitiveProfile(remote, null, fixture, true)).toMatchObject({ id: "real-user", username: "Real", totalKm: 46, areaKm2: 1.2, runs: 5, zonesCaptured: 12, retakes: null, totalXp: 2800, preview: false });
    expect(selectCompetitiveProfile(null, null, fixture, false)).toBeNull();
    expect(toCompetitiveProfile({ ...remote, email: "secret@example.com", isPrivate: true }, "real-user")).toBeNull();
    expect(toCompetitiveProfile({ username: "secret", email: "secret@example.com", totalRuns: 1 }, "real-user").username).toBeNull();
    expect(toCompetitiveProfile({ id: "unknown", name: "Unknown" }, "unknown").totalKm).toBeNull();
    expect(localProfileSnapshot({ id: "me", localOnly: true, name: "Eu", totalDistance: 230, totalRuns: 3 })).toMatchObject({ id: "me", totalDistance: 230, totalRuns: 3 });
    expect(localProfileSnapshot({ id: "other", name: "Outra" })).toBeNull();
  });
});
