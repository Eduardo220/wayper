import {
  RUN_EXPORT_TEMPLATE,
  buildRunExportFilenameBase,
  formatRunExportTimestamp,
  getRunExportTemplateConfig,
  sanitizeRunExportFilenamePart,
} from "../runExportImage.js";

describe("run export image helpers", () => {
  test("formats readable timestamp for filenames", () => {
    expect(formatRunExportTimestamp(new Date("2026-05-22T18:07:00"))).toBe("2026-05-22-18-07");
  });

  test("sanitizes filename parts without accents", () => {
    expect(sanitizeRunExportFilenamePart("Corrida Livre no Centro.png")).toBe("corrida-livre-no-centro");
    expect(sanitizeRunExportFilenamePart("Traçado PNG")).toBe("tracado-png");
  });

  test("selects full image export config", () => {
    expect(getRunExportTemplateConfig(RUN_EXPORT_TEMPLATE.image)).toMatchObject({
      template: "image",
      generateKind: "image",
      dialogTitle: "Compartilhar imagem Wayper",
    });
  });

  test("selects transparent trace export config", () => {
    expect(getRunExportTemplateConfig(RUN_EXPORT_TEMPLATE.tracePng)).toMatchObject({
      template: "tracePng",
      generateKind: "trace",
      dialogTitle: "Compartilhar tracado Wayper",
    });
  });

  test("builds full image filename for free run", () => {
    expect(
      buildRunExportFilenameBase({
        template: RUN_EXPORT_TEMPLATE.image,
        run: { mode: "free", date: "2026-05-22T18:07:00" },
      })
    ).toBe("wayper-corrida-livre-2026-05-22-18-07");
  });

  test("builds trace png filename", () => {
    expect(
      buildRunExportFilenameBase({
        template: RUN_EXPORT_TEMPLATE.tracePng,
        run: { mode: "free", date: "2026-05-22T18:07:00" },
      })
    ).toBe("wayper-tracado-2026-05-22-18-07");
  });
});
