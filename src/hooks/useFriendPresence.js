import { useEffect, useState, useRef } from "react";
import { getDatabase, ref, onValue } from "firebase/database";

export default function useFriendPresence(uid) {
  const [status, setStatus] = useState({ state: "offline", last_changed: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    if (!uid) return;

    try {
      const rtdb = getDatabase();
      const statusRef = ref(rtdb, `/status/${uid}`);

      const unsub = onValue(statusRef, (snap) => {
        if (!mounted.current) return;

        if (snap.exists()) {
          setStatus(snap.val());
        } else {
          setStatus({ state: "offline", last_changed: null });
        }
      });

      return () => {
        mounted.current = false;
        try { unsub(); } catch {}
      };
    } catch (e) {
      console.warn("useFriendPresence error:", e.message);
    }
  }, [uid]);

  return status.state === "online";
}
