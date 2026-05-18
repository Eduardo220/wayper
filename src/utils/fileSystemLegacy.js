import * as FileSystem from "expo-file-system/legacy";

const PNG_DATA_URI_PATTERN = /^data:image\/png;base64,/i;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export const FileSystemLegacy = FileSystem;
export const WAYPER_SHARE_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}wayper-share/`
  : null;

const isDev = () => typeof __DEV__ !== "undefined" && __DEV__;

const sanitizeFilename = (filename = "wayper-image.png") => {
  const value = String(filename || "wayper-image.png")
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`;\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const safe = value || `wayper-image-${Date.now()}.png`;
  return safe.toLowerCase().endsWith(".png") ? safe : `${safe}.png`;
};

const isDataPng = (value) => PNG_DATA_URI_PATTERN.test(String(value || ""));

const looksLikeRawBase64 = (value) => {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || URI_SCHEME_PATTERN.test(text) || text.startsWith("/")) return false;
  return text.length > 80 && /^[A-Za-z0-9+/=\r\n]+$/.test(text);
};

export const normalizeFileUri = (uri) => {
  if (!uri || typeof uri !== "string") return uri;
  const value = uri.trim();

  if (
    value.startsWith("file://") ||
    value.startsWith("content://") ||
    value.startsWith("asset://") ||
    value.startsWith("ph://") ||
    value.startsWith("data:")
  ) {
    return value;
  }

  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return `file:///${value.replace(/\\/g, "/")}`;
  }

  if (value.startsWith("/")) {
    return `file://${value}`;
  }

  return value;
};

export const ensureDirAsync = async (dir = WAYPER_SHARE_DIR) => {
  if (!dir) {
    throw new Error("Diretorio de cache indisponivel para salvar a imagem.");
  }

  const normalizedDir = dir.endsWith("/") ? dir : `${dir}/`;
  await FileSystem.makeDirectoryAsync(normalizedDir, { intermediates: true });
  return normalizedDir;
};

export const fileExistsAsync = async (uri) => {
  const normalizedUri = normalizeFileUri(uri);
  if (!normalizedUri) {
    return { exists: false, uri: normalizedUri, size: 0 };
  }

  const info = await FileSystem.getInfoAsync(normalizedUri, { size: true });
  return {
    ...info,
    exists: Boolean(info.exists),
    uri: normalizedUri,
    size: Number(info.size || 0),
  };
};

export const assertFileReadyAsync = async (uri) => {
  const info = await fileExistsAsync(uri);

  if (!info.exists) {
    throw new Error("Arquivo de imagem nao foi gerado.");
  }

  if (!Number.isFinite(info.size) || info.size <= 0) {
    throw new Error("Arquivo de imagem gerado esta vazio.");
  }

  return info;
};

export const safeDeleteAsync = async (uri) => {
  try {
    const info = await fileExistsAsync(uri);
    if (!info.exists) return false;
    await FileSystem.deleteAsync(info.uri, { idempotent: true });
    return true;
  } catch (error) {
    if (isDev()) {
      console.error("[Wayper Share] safe delete failed:", error);
    }
    return false;
  }
};

export const saveBase64PngAsync = async (base64, filename = "wayper-image.png") => {
  if (typeof base64 !== "string" || !base64.trim()) {
    throw new Error("Imagem em base64 vazia ou invalida.");
  }

  const dir = await ensureDirAsync(WAYPER_SHARE_DIR);
  const cleanBase64 = base64.replace(PNG_DATA_URI_PATTERN, "").trim();

  if (!cleanBase64) {
    throw new Error("Imagem em base64 vazia apos normalizacao.");
  }

  const uri = `${dir}${sanitizeFilename(filename)}`;
  await FileSystem.writeAsStringAsync(uri, cleanBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await assertFileReadyAsync(uri);
  return uri;
};

export const saveTempImageAsync = async (sourceUri, filename = "wayper-image.png") => {
  if (!sourceUri || typeof sourceUri !== "string") {
    throw new Error("URI de imagem vazio ou invalido.");
  }

  if (isDataPng(sourceUri) || looksLikeRawBase64(sourceUri)) {
    return saveBase64PngAsync(sourceUri, filename);
  }

  const source = normalizeFileUri(sourceUri);
  const sourceInfo = await assertFileReadyAsync(source);
  const dir = await ensureDirAsync(WAYPER_SHARE_DIR);
  const destination = `${dir}${sanitizeFilename(filename)}`;

  if (sourceInfo.uri === destination) {
    return sourceInfo.uri;
  }

  await FileSystem.copyAsync({
    from: sourceInfo.uri,
    to: destination,
  });

  await assertFileReadyAsync(destination);
  return destination;
};
