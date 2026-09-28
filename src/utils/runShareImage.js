import { Alert } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import {
  FileSystemLegacy as FileSystem,
  assertFileReadyAsync,
  saveTempImageAsync,
} from "./fileSystemLegacy";
import {
  captureRunShareImage as captureRunShareImageInternal,
  saveImageToMediaLibrary as saveImageToMediaLibraryInternal,
  shareImageFile as shareImageFileInternal,
  WayperShareError,
} from "./share/runShareExport";
import logger, { LOG_CATEGORIES } from "./logger.js";

function basenameFromUri(uri = "") {
  return String(uri || "").split(/[\\/]/).filter(Boolean).pop() || null;
}

function eventName(label = "event") {
  return String(label || "event")
    .replace(/^\[|\]$/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "SHARE_EVENT";
}

const log = (label, payload = {}) => {
  logger.info(LOG_CATEGORIES.SHARE, eventName(label), {
    filename: payload.filename || null,
    generatedFilename: basenameFromUri(payload.uri),
  }, { forcePersist: true });
};

const logError = (label, error, payload = {}) => {
  logger.warn(LOG_CATEGORIES.SHARE, eventName(label), {
    code: error?.code,
    error,
    filename: payload.filename || null,
    generatedFilename: basenameFromUri(payload.uri),
  }, { forcePersist: true });
};

const sanitizeFilename = (filename = "wayper-run") =>
  `${String(filename || "wayper-run")
    .trim()
    .replace(/\.png$/i, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "wayper-run"}-${Date.now()}.png`;

const getClipboardModule = () => {
  try {
    return requireOptionalNativeModule("ExpoClipboard");
  } catch (error) {
    logError("[WAYPER_CLIPBOARD_UNAVAILABLE]", error);
    return null;
  }
};

export async function ensurePngFile(uri, filename = "wayper-run") {
  const ready = await assertFileReadyAsync(uri);
  return saveTempImageAsync(ready.uri, sanitizeFilename(filename));
}

export async function generateShareImage(ref, filename = "wayper-run-image", options = {}) {
  log("[WAYPER_SHARE_IMAGE_START]", { filename });
  try {
    const uri = await captureRunShareImageInternal(ref, {
      filename,
      width: 1080,
      height: 1350,
      format: "png",
      quality: 1,
      result: "tmpfile",
      ...options,
    });
    const png = await ensurePngFile(uri, filename);
    log("[WAYPER_SHARE_IMAGE_SUCCESS]", { uri: png });
    return png;
  } catch (error) {
    logError("[WAYPER_SHARE_IMAGE_ERROR]", error, { filename });
    throw error;
  }
}

export async function generateTransparentTracePng(ref, filename = "wayper-trace-png", options = {}) {
  log("[WAYPER_TRACE_PNG_START]", { filename });
  try {
    const uri = await captureRunShareImageInternal(ref, {
      filename,
      width: 1080,
      height: 1080,
      format: "png",
      quality: 1,
      result: "tmpfile",
      ...options,
    });
    const png = await ensurePngFile(uri, filename);
    log("[WAYPER_TRACE_PNG_SUCCESS]", { uri: png });
    return png;
  } catch (error) {
    logError("[WAYPER_TRACE_PNG_ERROR]", error, { filename });
    throw error;
  }
}

export async function shareImage(uri, options = {}) {
  return shareImageFileInternal(uri, {
    dialogTitle: "Compartilhar corrida Wayper",
    ...options,
  });
}

export async function openNativeShare(uri, options = {}) {
  return shareImage(uri, options);
}

export async function saveImageToGallery(uri, albumName = "Wayper") {
  try {
    const result = await saveImageToMediaLibraryInternal(uri, albumName);
    log("[WAYPER_DOWNLOAD_SUCCESS]", { uri });
    return result;
  } catch (error) {
    logError("[WAYPER_DOWNLOAD_ERROR]", error, { uri });
    throw error;
  }
}

export async function copyTextToClipboard(text) {
  const Clipboard = getClipboardModule();

  if (typeof Clipboard?.setStringAsync === "function") {
    await Clipboard.setStringAsync(String(text));
    return { ok: true };
  }

  if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
    await navigator.clipboard.writeText(String(text));
    return { ok: true };
  }

  throw new WayperShareError(
    "CLIPBOARD_TEXT_UNAVAILABLE",
    "Copiar texto não está disponível neste build."
  );
}

export async function copyPngToClipboard(uri, options = {}) {
  log("[WAYPER_TRACE_COPY_START]", { uri });
  try {
    const Clipboard = getClipboardModule();

    if (typeof Clipboard?.setImageAsync !== "function") {
      throw new WayperShareError(
        "CLIPBOARD_IMAGE_UNAVAILABLE",
        "Copiar imagem para a área de transferência não está disponível nesta plataforma."
      );
    }

    const ready = await assertFileReadyAsync(uri);
    const base64 = await FileSystem.readAsStringAsync(ready.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    await Clipboard.setImageAsync(base64);
    log("[WAYPER_TRACE_COPY_SUCCESS]", { uri: ready.uri });
    return { ok: true, uri: ready.uri };
  } catch (error) {
    logError("[WAYPER_TRACE_COPY_ERROR]", error, { uri });
    if (options.fallbackShare !== false) {
      Alert.alert(
        "Não foi possível copiar",
        "Não foi possível copiar o PNG. Abrindo opções de compartilhamento."
      );
      await openNativeShare(uri, { dialogTitle: "Compartilhar traçado Wayper" });
    }
    return { ok: false, error };
  }
}

export {
  WayperShareError as RunShareImageError,
  assertFileExists,
  captureRunCardToPng,
  captureRunShareImage,
  cleanupOldShareFiles,
  copyToShareDirectory,
  downloadImageFile,
  ensureShareDirectory,
  generateTracePngFromPath,
  getRenderableTraceSource,
  getShareUnavailableMessage,
  logShareDiagnostics,
  logShareError,
  normalizeFileUri,
  normalizeRunPath,
  saveImageToMediaLibrary,
  savePngToGallery,
  shareImageFile,
  sharePng,
  showShareError,
} from "./share/runShareExport";

export {
  shareBase64Png,
  sharePngFile,
  saveBase64PngToGallery,
} from "./shareImage";
