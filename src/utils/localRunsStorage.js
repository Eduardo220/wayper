import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";

const RUNS_KEY = "runs";
const FORMAT_VERSION = 3;
const CHUNK_CHARACTERS = 250_000;

async function readRunsValue() {
  try {
    return await AsyncStorage.getItem(RUNS_KEY);
  } catch (error) {
    if (
      Platform.OS !== "android" ||
      !/SQLiteBlobTooBigException|Row too big to fit into CursorWindow/i.test(String(error)) ||
      typeof NativeModules.WayperAsyncStorageRead?.readOversizedRuns !== "function"
    ) throw error;
    return NativeModules.WayperAsyncStorageRead.readOversizedRuns();
  }
}

export async function readStoredRuns() {
  const raw = await readRunsValue();
  if (raw == null) return [];
  const stored = JSON.parse(raw);
  if (Array.isArray(stored)) return stored;
  if (
    stored?.formatVersion !== FORMAT_VERSION ||
    typeof stored.generation !== "string" ||
    !Number.isSafeInteger(stored.chunks) ||
    stored.chunks < 1 ||
    !Number.isSafeInteger(stored.length) ||
    stored.length < 0
  ) throw new Error("invalid_runs_manifest");
  const parts = await Promise.all(Array.from({ length: stored.chunks }, (_, index) =>
    AsyncStorage.getItem(`runs:v3:${stored.generation}:${index}`)
  ));
  if (parts.some((part) => part == null)) throw new Error("missing_runs_chunk");
  const joined = parts.join("");
  if (joined.length !== stored.length) throw new Error("invalid_runs_length");
  const runs = JSON.parse(joined);
  if (!Array.isArray(runs)) throw new Error("invalid_runs_payload");
  return runs;
}

export async function writeStoredRuns(runs) {
  const previous = await readRunsValue();
  const previousManifest = previous ? JSON.parse(previous) : null;
  // Escape surrogate units before chunks cross the native UTF-8 boundary.
  const value = JSON.stringify(runs).replace(/[\uD800-\uDFFF]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
  if (value.length <= CHUNK_CHARACTERS) {
    await AsyncStorage.setItem(RUNS_KEY, value);
  } else {
    const generation = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const chunks = Math.ceil(value.length / CHUNK_CHARACTERS);
    const keys = Array.from({ length: chunks }, (_, index) => `runs:v3:${generation}:${index}`);
    const manifest = JSON.stringify({ formatVersion: FORMAT_VERSION, generation, chunks, length: value.length });
    try {
      for (let index = 0; index < chunks; index += 1) {
        await AsyncStorage.setItem(keys[index], value.slice(index * CHUNK_CHARACTERS, (index + 1) * CHUNK_CHARACTERS));
      }
      await AsyncStorage.setItem(RUNS_KEY, manifest);
    } catch (error) {
      // A falha do commit pode ter ocorrido depois da escrita nativa; preserve os chunks se houver dúvida.
      let current = null;
      try { current = await readRunsValue(); } catch {}
      if (current != null && current !== manifest) {
        await Promise.all(keys.map((key) => AsyncStorage.removeItem(key).catch(() => {})));
      }
      throw error;
    }
  }
  if (previousManifest?.formatVersion === FORMAT_VERSION) {
    await Promise.all(Array.from({ length: previousManifest.chunks }, (_, index) =>
      AsyncStorage.removeItem(`runs:v3:${previousManifest.generation}:${index}`).catch(() => {})
    ));
  }
}
