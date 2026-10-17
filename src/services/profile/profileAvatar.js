import { storage } from "../../firebaseConfig.js";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { FileSystemLegacy as FileSystem } from "../../utils/fileSystemLegacy.js";

// Keep a selected photo outside picker cache only when the profile is saved.
export async function persistProfileImage(uri, folder = "avatars") {
  if (!uri || /^https?:\/\//i.test(uri)) return uri;
  if (!FileSystem.documentDirectory) throw new Error("avatar_directory_unavailable");
  const directory = `${FileSystem.documentDirectory}${folder}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const destination = `${directory}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

export async function uploadAvatarImage(uri, storagePath) {
  if (!uri) return { data: null, error: new Error("missing_image_uri"), source: "remote" };

  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    const ref = storageRef(storage, storagePath);
    const snap = await uploadBytes(ref, blob, { contentType: blob.type || "image/jpeg" });
    return { data: await getDownloadURL(snap.ref), error: null, source: "remote" };
  } catch (error) {
    return { data: null, error, source: "remote" };
  }
}
