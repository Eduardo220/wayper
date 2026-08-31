import { partitionTerritories, projectVisibleMapZones } from "../mapScreenViewProjection.js";

test("finished zone preview wins over active preview", () => {
  const active = [{ id: "active" }];
  const finished = [{ id: "finished" }];
  expect(projectVisibleMapZones({ showZones: true, running: true, mode: "zones", polygons: active,
    showRunModal: true, showSavedModal: false, completedZonePreview: finished })).toEqual(finished);
});

test("territories are partitioned by canonical owner id", () => {
  const result = partitionTerritories([
    { id: "mine", ownerId: "u1" },
    { id: "other", userId: "u2" },
  ], "u1");
  expect(result.mine.map((item) => item.id)).toEqual(["mine"]);
  expect(result.others.map((item) => item.id)).toEqual(["other"]);
});
