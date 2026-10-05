import { useEffect, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Connection state for a Supabase Realtime subscription.
 *
 * `fallback` means the socket could not be (re)established after repeated
 * attempts, so the caller should keep its interval polling running.
 */
export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "fallback";

export type RealtimeChange<T extends Record<string, unknown> = Record<string, unknown>> =
  RealtimePostgresChangesPayload<T>;

export interface UseRealtimeTableOptions<T extends Record<string, unknown>> {
  /** Table name in the public schema. */
  table: string;
  /** Postgres change events to listen for. Defaults to all. */
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  /** Server-side row filter, e.g. `user_id=eq.<uuid>`. RLS still applies. */
  filter?: string;
  /** Skip subscribing (e.g. before auth is known). */
  enabled?: boolean;
  onChange?: (payload: RealtimeChange<T>) => void;
}

export interface RealtimeSubscription {
  status: RealtimeStatus;
  /** True while the socket is delivering changes. */
  live: boolean;
  /** Timestamp of the last change delivered over the socket. */
  lastEventAt: Date | null;
}

const FALLBACK_AFTER_FAILURES = 2;

/**
 * Subscribes to `postgres_changes` for one table using the browser Supabase
 * client. The publishable key plus the signed-in session means RLS decides
 * which rows are streamed — the service role key is never used here.
 */
export function useRealtimeTable<T extends Record<string, unknown> = Record<string, unknown>>(
  options: UseRealtimeTableOptions<T>,
): RealtimeSubscription {
  const { table, event = "*", filter, enabled = true } = options;
  const [status, setStatus] = useState<RealtimeStatus>(enabled ? "connecting" : "fallback");
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const handler = useRef(options.onChange);
  handler.current = options.onChange;

  useEffect(() => {
    if (!enabled) {
      setStatus("fallback");
      return;
    }
    let failures = 0;
    setStatus("connecting");

    const channel = supabase
      .channel(`rt:${table}:${filter ?? "all"}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        filter
          ? { event, schema: "public", table, filter }
          : { event, schema: "public", table },
        (payload) => {
          setLastEventAt(new Date());
          handler.current?.(payload as RealtimeChange<T>);
        },
      )
      .subscribe((state) => {
        if (state === "SUBSCRIBED") {
          failures = 0;
          setStatus("live");
          return;
        }
        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          failures += 1;
          setStatus(failures >= FALLBACK_AFTER_FAILURES ? "fallback" : "reconnecting");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, event, filter, enabled]);

  return { status, live: status === "live", lastEventAt };
}

/** Combines several subscription states into the weakest one. */
export function combineRealtime(...subs: RealtimeSubscription[]): RealtimeSubscription {
  if (subs.length === 0) return { status: "fallback", live: false, lastEventAt: null };
  const order: RealtimeStatus[] = ["live", "connecting", "reconnecting", "fallback"];
  const status = subs
    .map((s) => s.status)
    .reduce((worst, next) => (order.indexOf(next) > order.indexOf(worst) ? next : worst), "live" as RealtimeStatus);
  const lastEventAt = subs
    .map((s) => s.lastEventAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return { status, live: status === "live", lastEventAt };
}
