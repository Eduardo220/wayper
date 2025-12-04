// src/services/runService.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { auth, db } from "../firebaseConfig"; // ajusta o caminho se necessário
import {
  doc,
  setDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

const UNSYNCED_KEY = "wayper_unsynced_runs_v1";
const LOCAL_CACHE_KEY = "wayper_runs_cache_v1"; // cache local de runs list para UI

function debug(...args) {
  console.log("[RUN-SERVICE]", ...args);
}

/* -------------------------
   Helpers
   ------------------------- */
function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function getAuthUid() {
  try {
    const u = auth.currentUser;
    return u?.uid || null;
  } catch (e) {
    return null;
  }
}

/* -------------------------
   Local storage helpers
   ------------------------- */
export async function loadLocalRunsCache() {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    debug("loadLocalRunsCache error", e);
    return [];
  }
}

export async function saveLocalRunsCache(list = []) {
  try {
    await AsyncStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(list));
    debug("saveLocalRunsCache ok", list.length);
  } catch (e) {
    debug("saveLocalRunsCache error", e);
  }
}

async function loadUnsyncedQueue() {
  try {
    const raw = await AsyncStorage.getItem(UNSYNCED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    debug("loadUnsyncedQueue error", e);
    return [];
  }
}

async function saveUnsyncedQueue(queue = []) {
  try {
    await AsyncStorage.setItem(UNSYNCED_KEY, JSON.stringify(queue));
    debug("saveUnsyncedQueue ok", queue.length);
  } catch (e) {
    debug("saveUnsyncedQueue error", e);
  }
}

/* -------------------------
   Normalize run object
   ------------------------- */
function normalizeRun(run) {
  // garante campos essenciais
  const id = run.id || makeId();
  const date = run.date || new Date().toISOString();
  const path = Array.isArray(run.path) ? run.path : [];
  const distance = Number(run.distance || 0);
  const duration = Number(run.duration || 0);
  const meta = run.meta || {};

  return {
    id,
    date,
    path,
    distance,
    duration,
    meta,
    createdAt: new Date().toISOString(),
    synced: false,
  };
}

/* -------------------------
   Save run local + queue upload
   - retorna o objeto salvo (com id)
   ------------------------- */
export async function persistRun(run) {
  try {
    // normaliza
    const r = normalizeRun(run);

    // 1) salva no cache local de runs (lista que alimenta UI)
    const cache = await loadLocalRunsCache();
    cache.unshift(r); // coloca na frente
    await saveLocalRunsCache(cache);

    // 2) adiciona à fila de unsynced para enviar ao servidor
    const q = await loadUnsyncedQueue();
    q.push(r);
    await saveUnsyncedQueue(q);

    debug("persistRun queued", r.id);

    // 3) tenta sincronizar imediatamente se houver rede
    const state = await NetInfo.fetch();
    if (state.isConnected) {
      syncUnsyncedRuns().catch((e) => debug("sync immediate failed", e));
    }

    return r;
  } catch (e) {
    debug("persistRun error", e);
    throw e;
  }
}

/* -------------------------
   Upload single run to Firestore
   - usa path users/{uid}/runs/{id} (privado por usuário)
   - retorna true se ok
   ------------------------- */
async function uploadRunToFirestore(run, attempt = 0) {
  const uid = await getAuthUid();
  if (!uid) {
    throw new Error("not-authenticated");
  }

  // prepara doc ref
  const ref = doc(collection(db, `users/${uid}/runs`), run.id);

  // sanitiza o payload: não enviar referências circulares
  const payload = {
    id: run.id,
    date: run.date,
    path: run.path.map(p => ({
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      timestamp: p.timestamp || null,
      accuracy: p.accuracy || null,
    })),
    distance: Number(run.distance || 0),
    duration: Number(run.duration || 0),
    meta: run.meta || {},
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, payload);
    debug("uploadRunToFirestore ok", run.id);
    return true;
  } catch (e) {
    debug("uploadRunToFirestore error", { id: run.id, attempt, err: e });
    throw e;
  }
}

/* -------------------------
   Sync queue processor
   - tenta enviar cada run da fila
   - retry com backoff (simples)
   - marca como synced removendo da fila e atualizando cache local
   ------------------------- */
export async function syncUnsyncedRuns() {
  try {
    debug("syncUnsyncedRuns start");
    // só roda se tiver usuário autenticado
    const uid = await getAuthUid();
    if (!uid) {
      debug("syncUnsyncedRuns abort: not authenticated");
      return;
    }

    let queue = await loadUnsyncedQueue();
    if (!queue || queue.length === 0) {
      debug("syncUnsyncedRuns nothing to do");
      return;
    }

    const newQueue = []; // runs que falharem e precisam ficar na fila

    for (let i = 0; i < queue.length; i++) {
      const run = queue[i];
      let ok = false;
      let attempt = 0;
      const maxAttempts = 5;

      while (!ok && attempt < maxAttempts) {
        try {
          attempt++;
          await uploadRunToFirestore(run, attempt);

          // se ok: atualiza cache local para marcar como synced
          const cache = await loadLocalRunsCache();
          const idx = cache.findIndex(r => r.id === run.id);
          if (idx !== -1) {
            cache[idx] = { ...cache[idx], synced: true };
            await saveLocalRunsCache(cache);
          }

          ok = true;
          debug("syncUnsyncedRuns uploaded", run.id, "attempt", attempt);
        } catch (e) {
          debug("sync attempt failed", run.id, "attempt", attempt);
          // backoff exponencial simples
          const delay = Math.min(30000, 500 * Math.pow(2, attempt));
          await new Promise(res => setTimeout(res, delay));
        }
      }

      if (!ok) {
        // ainda falhou: mantém na fila para tentar depois
        newQueue.push(run);
        debug("syncUnsyncedRuns keep in queue", run.id);
      }
    }

    // sobrou algo que falhou: salva de volta
    await saveUnsyncedQueue(newQueue);
    debug("syncUnsyncedRuns done, remaining", newQueue.length);
  } catch (e) {
    debug("syncUnsyncedRuns catch", e);
  }
}

/* -------------------------
   init sync: chama no App start (useEffect)
   - registra listener de online/offline pra disparar sync
   ------------------------- */
let netUnsub = null;
export function initRunSyncOnStart() {
  try {
    if (netUnsub) return; // já registrado

    netUnsub = NetInfo.addEventListener(state => {
      if (state.isConnected) {
        debug("NetInfo: online -> trying sync");
        syncUnsyncedRuns().catch(e => debug("sync on net event failed", e));
      }
    });

    // tenta uma primeira vez
    NetInfo.fetch().then(state => {
      if (state.isConnected) {
        syncUnsyncedRuns().catch(e => debug("initial sync failed", e));
      }
    });

    debug("initRunSyncOnStart ok");
  } catch (e) {
    debug("initRunSyncOnStart error", e);
  }
}

/* -------------------------
   finalizeRun: chamada de alto nível pelo MapScreen quando terminar corrida
   - recebe o objeto run (path, distance, duration, meta)
   - salva local e tenta enviar
   - retorna o run salvo (com id)
   ------------------------- */
export async function finalizeRun(runLike) {
  try {
    const run = normalizeRun(runLike);
    debug("finalizeRun start", run.id);

    const saved = await persistRun(run);

    // já chama sync em background (não bloqueia)
    syncUnsyncedRuns().catch(e => debug("background sync failed", e));

    return saved;
  } catch (e) {
    debug("finalizeRun error", e);
    throw e;
  }
}

/* -------------------------
   clear resources on sign out (optional)
   ------------------------- */
export async function clearRunServiceState() {
  try {
    await saveUnsyncedQueue([]);
    await saveLocalRunsCache([]);
    debug("clearRunServiceState ok");
  } catch (e) {
    debug("clearRunServiceState error", e);
  }
}

export default {
  persistRun,
  finalizeRun,
  syncUnsyncedRuns,
  initRunSyncOnStart,
  loadLocalRunsCache,
  clearRunServiceState,
};
