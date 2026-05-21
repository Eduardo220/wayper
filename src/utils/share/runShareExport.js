import { Alert, Platform } from "react-native";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";

import {
  FileSystemLegacy as FileSystem,
  WAYPER_SHARE_DIR,
  assertFileReadyAsync,
  ensureDirAsync,
  normalizeFileUri as normalizeLegacyFileUri,
  saveTempImageAsync,
} from "../fileSystemLegacy";
import {
  savePngToGallery as savePngFileToGallery,
  sharePngFile,
} from "../shareImage";

export const SHARE_DIR = WAYPER_SHARE_DIR || "";
export const WAYPER_SHARE_ALBUM = "Wayper";

const PNG_EXTENSION = ".png";

export class WayperShareError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "WayperShareError";
    this.code = code;
    this.cause = cause;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizeFileUri(uri) {
  return normalizeLegacyFileUri(uri);
}

export function sanitizeShareFilename(filename = "wayper-run") {
  const safe = String(filename || "wayper-run")
    .trim()
    .replace(/\.png$/i, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${safe || "wayper-run"}-${Date.now()}${PNG_EXTENSION}`;
}

export async function ensureShareDirectory() {
  try {
    return await ensureDirAsync(SHARE_DIR);
  } catch (error) {
    throw new WayperShareError(
      "CACHE_DIRECTORY_UNAVAILABLE",
      "[share] FileSystem.cacheDirectory indisponivel.",
      error
    );
  }
}

export async function assertFileExists(uri) {
  try {
    return await assertFileReadyAsync(uri);
  } catch (error) {
    throw new WayperShareError(
      "FILE_NOT_CREATED",
      error?.message || "[share] Arquivo invalido ou vazio.",
      error
    );
  }
}

export async function copyToShareDirectory(uri, filename = "wayper-run") {
  try {
    return await saveTempImageAsync(uri, sanitizeShareFilename(filename));
  } catch (error) {
    throw new WayperShareError(
      "FILE_COPY_FAILED",
      error?.message || "[share] Falha ao preparar imagem temporaria.",
      error
    );
  }
}

export async function captureRunShareImage(ref, options = {}) {
  const {
    width = 1080,
    height = 1350,
    quality = 1,
    format = "png",
    result = "tmpfile",
    filename = "wayper-run",
    waitMs = 280,
  } = options;

  const target = ref?.current ?? ref;
  if (!target) {
    throw new WayperShareError("REF_NOT_READY", "[share] shareCardRef invalido. A view ainda nao foi renderizada.");
  }

  await delay(waitMs);

  let capturedUri;
  try {
    capturedUri = await captureRef(target, {
      format,
      quality,
      result,
      width,
      height,
      handleGLSurfaceViewOnAndroid: true,
    });
  } catch (error) {
    throw new WayperShareError("CAPTURE_FAILED", "[share] captureRef falhou ao gerar PNG.", error);
  }

  if (!capturedUri || typeof capturedUri !== "string") {
    throw new WayperShareError("CAPTURE_FAILED", "[share] captureRef nao retornou URI valida.");
  }

  try {
    const savedUri = await saveTempImageAsync(capturedUri, sanitizeShareFilename(filename));
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      const info = await assertFileExists(savedUri);
      console.log("[Wayper Share] capture generated file:", {
        platform: Platform.OS,
        method: result === "base64" ? "captureRef/base64" : "captureRef/tmpfile",
        uri: info.uri,
        exists: info.exists,
        size: info.size,
        width,
        height,
      });
    }
    return savedUri;
  } catch (error) {
    throw new WayperShareError(
      "CAPTURE_FILE_INVALID",
      error?.message || "[share] PNG capturado nao esta pronto para uso.",
      error
    );
  }
}

export function normalizeRunPath(path = []) {
  return (Array.isArray(path) ? path : [])
    .map((point) => {
      let latitude;
      let longitude;

      if (Array.isArray(point)) {
        latitude = Number(point[0]);
        longitude = Number(point[1]);

        if (Math.abs(latitude) > 90 && Math.abs(longitude) <= 90) {
          const temp = latitude;
          latitude = longitude;
          longitude = temp;
        }
      } else {
        latitude = Number(point?.latitude ?? point?.lat ?? point?.coords?.latitude);
        longitude = Number(point?.longitude ?? point?.lon ?? point?.lng ?? point?.coords?.longitude);
      }

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      ) {
        return null;
      }

      return { latitude, longitude, timestamp: point?.timestamp ?? point?.time ?? null };
    })
    .filter(Boolean);
}

function normalizeTraceSegments(segments = []) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) =>
      normalizeRunPath(
        Array.isArray(segment)
          ? segment
          : segment?.summaryRenderPath || segment?.renderPath || segment?.displayPath || segment?.trustedPath || []
      )
    )
    .filter((segment) => segment.length >= 2);
}

export function getRenderableTraceSource({ path = [], segments = [], zoneCoords = [], isZone = false } = {}) {
  const normalizedPath = normalizeRunPath(path);
  const normalizedSegments = normalizeTraceSegments(segments);
  const normalizedZone = normalizeRunPath(zoneCoords);

  if (isZone && normalizedZone.length >= 3) {
    return { points: normalizedZone, segments: [], type: "zone" };
  }

  if (isZone && normalizedPath.length >= 3) {
    return { points: normalizedPath, segments: [], type: "zone" };
  }

  if (!isZone && normalizedSegments.length > 0) {
    return { points: normalizedSegments.flat(), segments: normalizedSegments, type: "route" };
  }

  if (normalizedPath.length >= 2) {
    return { points: normalizedPath, segments: [], type: "route" };
  }

  return { points: normalizedPath, segments: [], type: isZone ? "zone" : "route" };
}

export function assertTraceHasEnoughPoints({ path = [], segments = [], zoneCoords = [], isZone = false } = {}) {
  const source = getRenderableTraceSource({ path, segments, zoneCoords, isZone });
  const minPoints = source.type === "zone" ? 3 : 2;

  if (source.points.length < minPoints) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.log("[Wayper Share] trace fallback:", {
        type: source.type,
        points: source.points.length,
        minPoints,
      });
    }
  }

  return source;
}

export async function generateTracePngFromPath(path = [], options = {}) {
  const {
    ref,
    segments = [],
    zoneCoords = [],
    isZone = false,
    filename = "wayper-trace",
    width = 1080,
    height = 1080,
  } = options;
  assertTraceHasEnoughPoints({ path, segments, zoneCoords, isZone });

  if (!ref) {
    throw new WayperShareError(
      "REF_NOT_READY",
      "[share] generateTracePngFromPath precisa de uma ref de SVG/View renderizada para capturar o PNG."
    );
  }

  return captureRunShareImage(ref, { filename, width, height });
}

export async function saveImageToMediaLibrary(uri, albumName = WAYPER_SHARE_ALBUM) {
  if (Platform.OS === "web") {
    throw new WayperShareError("MEDIA_LIBRARY_UNAVAILABLE", "[share] Galeria nativa nao esta disponivel no web.");
  }

  const result = await savePngFileToGallery(uri, albumName);
  if (!result?.ok) {
    const code = /permission|permiss/i.test(result?.error || result?.message || "")
      ? "MEDIA_PERMISSION_DENIED"
      : "MEDIA_SAVE_FAILED";
    throw new WayperShareError(
      code,
      result?.message || "Nao foi possivel salvar na galeria. Verifique a permissao de fotos.",
      result?.error
    );
  }

  return result;
}

export async function shareImageFile(uri, options = {}) {
  if (Platform.OS === "web") {
    throw new WayperShareError("SHARING_UNAVAILABLE", "[share] Compartilhamento de arquivo local nao esta disponivel no web.");
  }

  const result = await sharePngFile(uri, options);
  if (!result?.ok) {
    const detail = `${result?.error || ""} ${result?.message || ""}`;
    let code = "SHARE_FAILED";
    if (/arquivo|file|empty|vazio|gerad/i.test(detail)) {
      code = "FILE_NOT_CREATED";
    } else if (/available|indispon/i.test(detail)) {
      code = "SHARING_UNAVAILABLE";
    }

    throw new WayperShareError(
      code,
      result?.message || "Nao foi possivel compartilhar a imagem. Tente novamente.",
      result?.error
    );
  }

  return result;
}

export async function downloadImageFile(uri, filename = "wayper-run") {
  const fileInfo = await assertFileExists(uri);
  const directory = FileSystem.documentDirectory || (await ensureShareDirectory());
  const targetUri = `${directory}${sanitizeShareFilename(filename)}`;

  await FileSystem.copyAsync({ from: fileInfo.uri, to: targetUri });
  await assertFileExists(targetUri);
  return targetUri;
}

export async function cleanupOldShareFiles(maxAgeMs = 1000 * 60 * 60 * 24) {
  if (!FileSystem.cacheDirectory) return;

  try {
    const dirInfo = await FileSystem.getInfoAsync(SHARE_DIR);
    if (!dirInfo.exists) return;

    const files = await FileSystem.readDirectoryAsync(SHARE_DIR);
    const now = Date.now();

    await Promise.all(
      files.map(async (file) => {
        const uri = `${SHARE_DIR}${file}`;
        const info = await FileSystem.getInfoAsync(uri);
        const modifiedAtMs = Number(info?.modificationTime || 0) * 1000;

        if (modifiedAtMs > 0 && now - modifiedAtMs > maxAgeMs) {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        }
      })
    );
  } catch (error) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn("[WayperShare:cleanup]", {
        message: error?.message,
        stack: error?.stack,
      });
    }
  }
}

export async function logShareDiagnostics(action, data = {}) {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;

  let generatedFileInfo = null;
  if (data.generatedUri) {
    try {
      generatedFileInfo = await FileSystem.getInfoAsync(normalizeFileUri(data.generatedUri), { size: true });
    } catch (error) {
      generatedFileInfo = { error: error?.message };
    }
  }

  let sharingAvailable = null;
  try {
    sharingAvailable = await Sharing.isAvailableAsync();
  } catch {
    sharingAvailable = false;
  }

  console.log("[WayperShare] diagnostics", {
    action,
    platform: Platform.OS,
    sharingAvailable,
    generatedUri: data.generatedUri,
    fileInfo: generatedFileInfo,
    pathLength: normalizeRunPath(data.path || []).length,
    runId: data.runId,
    extra: data.extra,
  });
}

export function logShareError(context, error, extra = {}) {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;

  console.log(`[WayperShare:${context}]`, {
    code: error?.code,
    message: error?.message,
    stack: error?.stack,
    cause: error?.cause?.message || error?.cause,
    extra,
  });
}

export function showShareError(message, error) {
  const detail =
    typeof __DEV__ !== "undefined" && __DEV__ && error?.message
      ? `\n\nDetalhe tecnico:\n${error.message}`
      : "";
  Alert.alert("Erro", `${message}${detail}`);
}

export function getShareUnavailableMessage(error, fallback) {
  if (error?.code === "TRACE_POINTS_INSUFFICIENT") {
    return "Essa corrida ainda nao tem pontos suficientes para gerar o tracado.";
  }

  if (error?.code === "MEDIA_PERMISSION_DENIED") {
    return "Nao foi possivel salvar na galeria. Verifique a permissao de fotos.";
  }

  if (error?.code === "MEDIA_LIBRARY_UNAVAILABLE") {
    return "Seu app de testes precisa ser reinstalado para ativar o salvamento na galeria.";
  }

  if (error?.code === "SHARING_UNAVAILABLE") {
    return "Compartilhamento nao disponivel neste dispositivo.";
  }

  return fallback;
}

export async function captureRunCardToPng(ref, filename = "wayper-run", options = {}) {
  return captureRunShareImage(ref, { filename, width: 1080, height: 1350, ...options });
}

export async function sharePng(uri, options = {}) {
  return shareImageFile(uri, options);
}

export async function savePngToGallery(uri, albumName = WAYPER_SHARE_ALBUM) {
  return saveImageToMediaLibrary(uri, albumName);
}
