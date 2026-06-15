import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../../firebaseConfig.js";
import {
  captureException,
  traceAsync,
} from "../monitoring/sentryService.js";

export function isDiagnosticUploadConfigured() {
  return (
    typeof process !== "undefined" &&
    process.env.EXPO_PUBLIC_WAYPER_DIAGNOSTICS_UPLOAD_ENABLED === "true"
  );
}

async function uploadDiagnosticsArchiveInternal(archive = {}) {
  if (!isDiagnosticUploadConfigured()) {
    const error = new Error("diagnostic_upload_not_configured");
    error.code = "diagnostic_upload_not_configured";
    throw error;
  }
  const user = auth.currentUser;
  if (!user?.uid) {
    const error = new Error("diagnostic_upload_requires_auth");
    error.code = "diagnostic_upload_requires_auth";
    throw error;
  }
  if (!archive.uri || !archive.filename) {
    throw new Error("diagnostic_archive_invalid");
  }

  const response = await fetch(archive.uri);
  const blob = await response.blob();
  const path = `diagnostics/${user.uid}/${archive.filename}`;
  const target = storageRef(storage, path);
  const uploaded = await uploadBytes(target, blob, {
    contentType: "application/zip",
    customMetadata: {
      scope: archive.scope || "last_run",
      runId: String(archive.runId || ""),
    },
  });
  const downloadUrl = await getDownloadURL(uploaded.ref);

  await addDoc(collection(db, "diagnosticUploads"), {
    userId: user.uid,
    runId: archive.runId || null,
    scope: archive.scope || "last_run",
    storagePath: path,
    size: Number(archive.size || blob.size || 0),
    gpsSummary: archive.bundle?.gpsFilterReport || null,
    createdAt: serverTimestamp(),
  });

  return {
    storagePath: path,
    downloadUrl,
  };
}

export async function uploadDiagnosticsArchive(archive = {}) {
  return traceAsync(
    "Upload diagnostics",
    "wayper.diagnostics.upload",
    { scope: archive.scope || "last_run", size: Number(archive.size || 0) },
    async () => {
      try {
        return await uploadDiagnosticsArchiveInternal(archive);
      } catch (error) {
        captureException(error, {
          category: "DIAGNOSTICS",
          event: "DIAGNOSTICS_UPLOAD_FAILED",
          scope: archive.scope || "last_run",
          size: Number(archive.size || 0),
        });
        throw error;
      }
    }
  );
}

export default {
  isDiagnosticUploadConfigured,
  uploadDiagnosticsArchive,
};
