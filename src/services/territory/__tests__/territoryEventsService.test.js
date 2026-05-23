import { describe, expect, test } from "@jest/globals";
import {
  createTerritoryEvent,
  generateTerritoryEventMessage,
} from "../territoryEventsService.js";

const actor = {
  id: "user-1",
  name: "Ana",
  avatar: "ana.png",
};

const target = {
  id: "user-2",
  name: "Bruno",
  avatar: "bruno.png",
};

describe("territoryEventsService", () => {
  test("cria evento capture", () => {
    const event = createTerritoryEvent({
      type: "capture",
      actor,
      affectedAreaM2: 123.4,
      visibility: "public",
    });

    expect(event).toMatchObject({
      type: "capture",
      actorId: "user-1",
      actorName: "Ana",
      affectedAreaM2: 123.4,
      visibility: "public",
      pendingSync: true,
    });
    expect(event.message).toBe("Ana conquistou 123m².");
  });

  test("cria evento steal", () => {
    const event = createTerritoryEvent({
      type: "steal",
      actor,
      target,
      affectedAreaM2: 77,
    });

    expect(event).toMatchObject({
      type: "steal",
      targetId: "user-2",
      targetName: "Bruno",
    });
    expect(event.message).toBe("Ana retomou 77m² de Bruno.");
  });

  test("gera mensagem saudavel", () => {
    const message = generateTerritoryEventMessage({
      type: "conquered",
      actorName: "Ana",
      targetName: "Bruno",
      affectedAreaM2: 40,
    });

    expect(message).toBe("Ana assumiu uma área antes dominada por Bruno.");
    expect(message.toLowerCase()).not.toContain("inimigo");
  });

  test("nao quebra com target null", () => {
    const event = createTerritoryEvent({
      type: "steal",
      actor,
      target: null,
      affectedAreaM2: 15,
    });

    expect(event.targetName).toBe("outro atleta");
    expect(event.message).toBe("Ana retomou 15m² de outro atleta.");
  });

  test("respeita visibility", () => {
    const event = createTerritoryEvent({
      type: "capture",
      actor,
      affectedAreaM2: 10,
      visibility: "private",
    });

    expect(event.visibility).toBe("private");
  });

  test("gera mensagens de lideranca sem humilhacao", () => {
    expect(generateTerritoryEventMessage({
      type: "leader_changed",
      actorName: "Ana",
    })).toBe("Ana assumiu a liderança nesta região.");
    expect(generateTerritoryEventMessage({
      type: "lost_lead",
      targetName: "Bruno",
    })).toBe("Bruno perdeu a liderança nesta região.");
    expect(generateTerritoryEventMessage({
      type: "regained_lead",
      actorName: "Ana",
    })).toBe("Ana retomou a liderança nesta região.");
  });
});
