import { describe, expect, test } from "@jest/globals";

import { getRunDisplayTitle } from "../runDisplayTitle.js";

describe("getRunDisplayTitle", () => {
  test("usa title antes dos demais nomes", () => {
    expect(getRunDisplayTitle({ title: "Corrida no Centro", name: "Nome antigo" })).toBe("Corrida no Centro");
  });

  test("segue a prioridade de nomes salvos", () => {
    expect(getRunDisplayTitle({ customName: "Treino de sabado" })).toBe("Treino de sabado");
    expect(getRunDisplayTitle({ runName: "Longao 5K" })).toBe("Longao 5K");
    expect(getRunDisplayTitle({ metadata: { title: "Corrida #12" } })).toBe("Corrida #12");
    expect(getRunDisplayTitle({ summary: { name: "Resumo salvo" } })).toBe("Resumo salvo");
  });

  test("usa fallback quando a corrida nao tem titulo", () => {
    expect(getRunDisplayTitle({})).toBe("Corrida Wayper");
    expect(getRunDisplayTitle(null)).toBe("Corrida Wayper");
  });
});
