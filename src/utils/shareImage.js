import { Platform } from "react-native";
import * as Sharing from "expo-sharing";

import {
  FileSystemLegacy as FileSystem,
  assertFileReadyAsync,
  saveBase64PngAsync,
} from "./fileSystemLegacy";
import { requestMediaPermission } from "../services/permissions";

const isDev = () => typeof __DEV__ !== "undefined" && __DEV__;
let mediaLibraryModulePromise = null;

const formatError = (error, fallback) => {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  return error.message || fallback;
};

const logResult = (label, payload) => {
  if (isDev()) {
    console.log(`[Wayper Share] ${label}:`, {
      platform: Platform.OS,
      ...payload,
    });
  }
};

const logError = (label, error) => {
  if (isDev()) {
    console.log(`[Wayper Share] ${label}:`, error);
  }
};

const sanitizeFilename = (filename = "wayper-run.png") => {
  const safe = String(filename || "wayper-run.png")
    .trim()
    .replace(/\.png$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${safe || "wayper-run"}-${Date.now()}.png`;
};

const getMediaLibrary = async () => {
  try {
    if (!mediaLibraryModulePromise) {
      mediaLibraryModulePromise = import("expo-media-library");
    }
    return await mediaLibraryModulePromise;
  } catch (error) {
    mediaLibraryModulePromise = null;
    throw new Error(
      "Modulo nativo expo-media-library indisponivel neste APK. Reinstale o APK atualizado para salvar imagens na galeria."
    );
  }
};

const saveWithAndroidFolderPicker = async (fileInfo, filename = "wayper-run.png") => {
  try {
    const SAF = FileSystem.StorageAccessFramework;
    if (Platform.OS !== "android" || !SAF?.requestDirectoryPermissionsAsync) {
      return null;
    }

    const permission = await SAF.requestDirectoryPermissionsAsync();
    if (!permission?.granted || !permission.directoryUri) {
      return {
        ok: false,
        uri: fileInfo.uri,
        message: "Escolha uma pasta para baixar o PNG.",
        error: "Storage Access Framework permission denied.",
      };
    }

    const base64 = await FileSystem.readAsStringAsync(fileInfo.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const target = await SAF.createFileAsync(permission.directoryUri, sanitizeFilename(filename), "image/png");
    await FileSystem.writeAsStringAsync(target, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return {
      ok: true,
      uri: target,
      message: "PNG salvo na pasta selecionada.",
    };
  } catch (error) {
    logError("folder picker save failed", error);
    return null;
  }
};

export const sharePngFile = async (fileUri, options = {}) => {
  try {
    const info = await assertFileReadyAsync(fileUri);
    logResult("generated file", {
      method: options.method || "file",
      uri: info.uri,
      exists: info.exists,
      size: info.size,
      visual: options.visual || options.title || "png",
    });

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return {
        ok: false,
        uri: info.uri,
        message: "Compartilhamento indisponivel neste dispositivo.",
        error: "Sharing.isAvailableAsync returned false.",
      };
    }

    await Sharing.shareAsync(info.uri, {
      dialogTitle: options.dialogTitle || options.title || "Compartilhar imagem",
      mimeType: "image/png",
      UTI: "public.png",
    });

    return {
      ok: true,
      uri: info.uri,
      message: "Imagem pronta para compartilhar.",
    };
  } catch (error) {
    logError("share png failed", error);
    return {
      ok: false,
      message: "Nao foi possivel compartilhar a imagem. Tente novamente.",
      error: formatError(error, "Falha ao compartilhar PNG."),
    };
  }
};

export const savePngToGallery = async (fileUri, albumName = "Wayper") => {
  let info = null;
  try {
    info = await assertFileReadyAsync(fileUri);
    logResult("saving file", {
      method: "media-library",
      uri: info.uri,
      exists: info.exists,
      size: info.size,
      visual: "gallery",
    });

    const MediaLibrary = await getMediaLibrary();
    const mediaPermission = await requestMediaPermission({ mediaLibrary: MediaLibrary });
    const hasPermission = mediaPermission.granted;

    if (!hasPermission) {
      const folderResult = await saveWithAndroidFolderPicker(info, `${albumName}-run.png`);
      if (folderResult?.ok) return folderResult;

      return {
        ok: false,
        uri: info.uri,
        message: "Para salvar a imagem da corrida na galeria, o Wayper precisa de acesso à mídia. Você ainda pode compartilhar sem salvar, quando disponível.",
        error: "Media library permission denied.",
      };
    }

    if (typeof MediaLibrary.saveToLibraryAsync === "function") {
      await MediaLibrary.saveToLibraryAsync(info.uri);
      return {
        ok: true,
        uri: info.uri,
        message: "Imagem salva na galeria.",
      };
    }

    if (typeof MediaLibrary.createAssetAsync !== "function") {
      const folderResult = await saveWithAndroidFolderPicker(info, `${albumName}-run.png`);
      if (folderResult?.ok) return folderResult;

      return {
        ok: false,
        uri: info.uri,
        message: "Nao foi possivel salvar na galeria neste APK.",
        error: "MediaLibrary save APIs unavailable.",
      };
    }

    const asset = await MediaLibrary.createAssetAsync(info.uri);
    const album = typeof MediaLibrary.getAlbumAsync === "function"
      ? await MediaLibrary.getAlbumAsync(albumName)
      : null;

    if (album && typeof MediaLibrary.addAssetsToAlbumAsync === "function") {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    } else if (typeof MediaLibrary.createAlbumAsync === "function") {
      await MediaLibrary.createAlbumAsync(albumName, asset, false);
    }

    return {
      ok: true,
      uri: info.uri,
      message: `Imagem salva no album ${albumName}.`,
      asset,
    };
  } catch (error) {
    logError("save png failed", error);
    if (info) {
      const folderResult = await saveWithAndroidFolderPicker(info, `${albumName}-run.png`);
      if (folderResult?.ok) return folderResult;
    }

    return {
      ok: false,
      uri: info?.uri || fileUri,
      message: "Nao foi possivel salvar o PNG. Verifique a permissao de fotos ou escolha uma pasta.",
      error: formatError(error, "Falha ao salvar PNG na galeria."),
    };
  }
};

export const shareBase64Png = async (base64, filename, options = {}) => {
  try {
    const uri = await saveBase64PngAsync(base64, filename);
    return sharePngFile(uri, {
      ...options,
      method: options.method || "base64",
    });
  } catch (error) {
    logError("share base64 png failed", error);
    return {
      ok: false,
      message: "Nao foi possivel compartilhar a imagem. Tente novamente.",
      error: formatError(error, "Falha ao compartilhar PNG em base64."),
    };
  }
};

export const saveBase64PngToGallery = async (
  base64,
  filename,
  albumName = "Wayper"
) => {
  try {
    const uri = await saveBase64PngAsync(base64, filename);
    return savePngToGallery(uri, albumName);
  } catch (error) {
    logError("save base64 png failed", error);
    return {
      ok: false,
      message: "Nao foi possivel salvar na galeria. Verifique a permissao de fotos.",
      error: formatError(error, "Falha ao salvar PNG em base64."),
    };
  }
};
