import { useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/security/token-store";
import type { LifecycleEvent } from "@/lib/cloud/types";

/**
 * Subscribes the browser to its session's server-sent lifecycle stream.
 *
 * We use a streaming fetch rather than EventSource so the short-lived bearer
 * token travels in the Authorization header instead of the URL. The caller
 * keeps a polling fallback for the (rare) case where the stream cannot be
 * established — the browser still never talks to the cloud provider.
 */
export function useSessionStream(
  sessionId: string | null | undefined,
  onEvent: (event: LifecycleEvent) => void,
) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let cancelled = false;
    let lastSeq = 0;
    let retry: number | undefined;

    const open = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/events?after=${lastSeq}`, {
          headers: { Accept: "text/event-stream", ...authHeaders() },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error("stream unavailable");
        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            try {
              const event = JSON.parse(line.slice(5).trim()) as LifecycleEvent;
              lastSeq = Math.max(lastSeq, event.seq);
              handler.current(event);
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      } catch {
        /* fall through to reconnect */
      }
      if (cancelled) return;
      setConnected(false);
      retry = window.setTimeout(() => void open(), 3000);
    };

    void open();
    return () => {
      cancelled = true;
      controller.abort();
      if (retry) window.clearTimeout(retry);
    };
  }, [sessionId]);

  return { connected };
}