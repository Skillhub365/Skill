import { useCallback, useEffect, useRef, useState } from "react";
import { extendSession as extendApi, fetchSession, sendHeartbeat, stopSession as stopApi } from "./client";
import {
  isLive,
  timerTier,
  type SessionConnectionStatus,
  type SessionRecord,
  type SessionSnapshot,
  type TimerTier,
} from "./types";

const HEARTBEAT_MS = 20_000;
const POLL_MS = 10_000;

/**
 * Keeps the browser in sync with the server's session clock. The countdown you
 * see is only a projection of `expiryTime`; every poll re-reads the server,
 * which is the single source of truth for expiry and VM reclamation.
 */
export function useSessionLifecycle(
  initial: SessionRecord,
  signals: { connectionStatus?: SessionConnectionStatus; vmStatus?: string },
  onSync?: (record: SessionRecord) => void,
) {
  const [session, setSession] = useState<SessionRecord>(initial);
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(initial.expiryTime).getTime() - Date.now()),
  );
  const [busy, setBusy] = useState(false);
  const [extendable, setExtendable] = useState(
    Math.max(0, initial.maxExtensionMinutes - initial.extendedMinutes),
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const syncRef = useRef(onSync);
  syncRef.current = onSync;

  const apply = useCallback((snap: SessionSnapshot) => {
    setSession(snap.session);
    setRemainingMs(snap.remainingMs);
    setExtendable(snap.extendableMinutes);
    syncRef.current?.(snap.session);
    return snap;
  }, []);

  // Local 1s tick — purely cosmetic between server reads.
  useEffect(() => {
    const id = window.setInterval(() => {
      const current = sessionRef.current;
      if (!isLive(current.status)) return setRemainingMs(0);
      setRemainingMs(Math.max(0, new Date(current.expiryTime).getTime() - Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Heartbeat: proves the browser is still open, and reports connection/VM state.
  useEffect(() => {
    let cancelled = false;
    const beat = async () => {
      try {
        const snap = await sendHeartbeat(sessionRef.current, signalsRef.current);
        if (!cancelled) apply(snap);
      } catch {
        /* transient — the next beat retries */
      }
    };
    void beat();
    const id = window.setInterval(() => {
      if (isLive(sessionRef.current.status)) void beat();
    }, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apply]);

  // Report connection transitions immediately (CONNECTED flips to ACTIVE).
  useEffect(() => {
    if (!signals.connectionStatus) return;
    if (!isLive(sessionRef.current.status)) return;
    void sendHeartbeat(sessionRef.current, { connectionStatus: signals.connectionStatus })
      .then(apply)
      .catch(() => null);
  }, [signals.connectionStatus, apply]);

  // Poll: server-authoritative status, so expiry lands even if the tab idles.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!isLive(sessionRef.current.status)) return;
      void fetchSession(sessionRef.current)
        .then(apply)
        .catch(() => null);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [apply]);

  // Refresh immediately when the learner returns to the tab (reconnection).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchSession(sessionRef.current)
          .then(apply)
          .catch(() => null);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [apply]);

  const extend = useCallback(
    async (minutes: number) => {
      setBusy(true);
      try {
        return apply(await extendApi(sessionRef.current, minutes));
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      return apply(await stopApi(sessionRef.current));
    } finally {
      setBusy(false);
    }
  }, [apply]);

  const refresh = useCallback(async () => apply(await fetchSession(sessionRef.current)), [apply]);

  const tier: TimerTier = isLive(session.status) ? timerTier(remainingMs) : "expired";

  return { session, remainingMs, tier, extendable, busy, extend, stop, refresh, live: isLive(session.status) };
}
