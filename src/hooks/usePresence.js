// src/hooks/usePresence.js
import { useEffect, useCallback } from "react";
import { getDatabase, ref, onDisconnect, set, onValue } from "firebase/database";
import { auth } from "../firebaseConfig";

/**
 * usePresence - sets presence in Realtime Database using onDisconnect
 * - call once on app start / after auth ready.
 *
 * Usage: call in App.js after auth state resolved:
 *   usePresence();
 */

export default function usePresence() {
  const setOnline = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const rtdb = getDatabase();
      const statusRef = ref(rtdb, `/status/${user.uid}`);
      // set onDisconnect to offline with last_changed
      await onDisconnect(statusRef).set({ state: "offline", last_changed: Date.now() });
      // set online now
      await set(statusRef, { state: "online", last_changed: Date.now() });
    } catch (e) {
      console.warn("usePresence:setOnline error", e?.message ?? e);
    }
  }, []);

  const setOffline = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const rtdb = getDatabase();
      const statusRef = ref(rtdb, `/status/${user.uid}`);
      await set(statusRef, { state: "offline", last_changed: Date.now() });
    } catch (e) {
      console.warn("usePresence:setOffline error", e?.message ?? e);
    }
  }, []);

  useEffect(() => {
    // set online when mounted & auth ready
    let unsub = null;
    const user = auth.currentUser;
    if (!user) return;
    setOnline();

    // optional: listen for rtdb changes for your own uid (rare)
    try {
      const db = getDatabase();
      const myRef = ref(db, `/status/${user.uid}`);
      unsub = onValue(myRef, () => {
        // noop - could update local store if needed
      });
    } catch (e) {
      // ignore
    }

    // on unmount set offline
    return () => {
      if (typeof unsub === "function") unsub();
      setOffline();
    };
  }, [setOnline, setOffline]);
}
