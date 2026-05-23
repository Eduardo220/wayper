export const RUN_EXPORT_TEMPLATE = {
  image: "image",
  tracePng: "tracePng",
};

const pad = (value) => String(value).padStart(2, "0");

const stripAccents = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export function formatRunExportTimestamp(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return [
    safeDate.getFullYear(),
    pad(safeDate.getMonth() + 1),
    pad(safeDate.getDate()),
    pad(safeDate.getHours()),
    pad(safeDate.getMinutes()),
  ].join("-");
}

export function sanitizeRunExportFilenamePart(value = "corrida") {
  const safe = stripAccents(value)
    .toLowerCase()
    .trim()
    .replace(/\.png$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safe || "corrida";
}

export function getRunExportTemplateConfig(template = RUN_EXPORT_TEMPLATE.image) {
  if (template === RUN_EXPORT_TEMPLATE.tracePng) {
    return {
      template: RUN_EXPORT_TEMPLATE.tracePng,
      filenamePrefix: "wayper-tracado",
      dialogTitle: "Compartilhar tracado Wayper",
      successMessage: "Tracado PNG salvo com sucesso.",
      generateKind: "trace",
    };
  }

  return {
    template: RUN_EXPORT_TEMPLATE.image,
    filenamePrefix: "wayper-corrida-livre",
    dialogTitle: "Compartilhar imagem Wayper",
    successMessage: "Imagem salva com sucesso.",
    generateKind: "image",
  };
}

export function buildRunExportFilenameBase({
  template = RUN_EXPORT_TEMPLATE.image,
  run = null,
  date = null,
  fallbackTitle = "corrida-livre",
} = {}) {
  const config = getRunExportTemplateConfig(template);
  const prefix = template === RUN_EXPORT_TEMPLATE.image && (run?.mode === "zones" || Number(run?.area || 0) > 0)
    ? "wayper-corrida-zonas"
    : config.filenamePrefix || `wayper-${sanitizeRunExportFilenamePart(fallbackTitle)}`;
  const timestamp = formatRunExportTimestamp(date || run?.date || run?.endedAt || run?.createdAt || Date.now());

  return `${prefix}-${timestamp}`;
}

export default {
  RUN_EXPORT_TEMPLATE,
  buildRunExportFilenameBase,
  formatRunExportTimestamp,
  getRunExportTemplateConfig,
  sanitizeRunExportFilenamePart,
};
