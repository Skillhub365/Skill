import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  useRealtimeTable,
  type RealtimeChange,
  type RealtimeStatus,
  type RealtimeSubscription,
} from "./useRealtimeTable";

type Row = Record<string, unknown>;
type ChangeHandler = (payload: RealtimeChange) => void;

interface TableHookOptions {
  enabled?: boolean;
  filter?: string;
  onChange?: ChangeHandler;
}

function tableHook(table: string) {
  return function useTable(options: TableHookOptions = {}): RealtimeSubscription {
    return useRealtimeTable<Row>({
      table,
      enabled: options.enabled ?? true,
      ...(options.filter ? { filter: options.filter } : {}),
      ...(options.onChange ? { onChange: options.onChange } : {}),
    });
  };
}

/** Session rows the caller may read (own sessions, or tenant sessions for admins). */
export const useRealtimeSessions = tableHook("sessions");
/** Per-session progress events (owner or tenant admin only). */
export const useRealtimeSessionEvents = tableHook("session_events");
/** Tenant-wide lifecycle events (admins only under RLS). */
export const useRealtimeLifecycleEvents = tableHook("lifecycle_events");
/** Durable VM records (tenant admins). */
export const useRealtimeVmRecords = tableHook("vm_records");
/** Operational VM pool projection used by the VM Pool screen. */
export const useRealtimeVmPoolEntries = tableHook("vm_pool_entries");
/** Guacamole gateway connection state (session owner or tenant admin). */
export const useRealtimeGatewayConnections = tableHook("gateway_connections");
/** Audit trail rows (tenant admins). */
export const useRealtimeActivityLogs = tableHook("activity_logs");
/** Cloud connection health/status (super admins only under RLS). */
export const useRealtimeCloudConnections = tableHook("cloud_connections");
/** Cached Azure inventory rows (super admins only under RLS). */
export const useRealtimeCloudInventory = tableHook("cloud_inventory");

export interface UseLiveRefreshOptions {
  /** Tables whose changes should trigger a refresh. */
  tables: string[];
  /** Loader to run when a change arrives (or on the fallback interval). */
  refresh: () => void | Promise<unknown>;
  /** Poll interval used while realtime is not live. */
  fallbackMs?: number;
  /** Slow keep-alive poll used even while realtime is live. 0 disables. */
  liveHeartbeatMs?: number;
  /** Coalesce bursts of changes into one refresh. */
  debounceMs?: number;
  enabled?: boolean;
}

export interface LiveRefreshState extends RealtimeSubscription {
  /** Last time the data on screen was refreshed (realtime or poll). */
  lastUpdatedAt: Date | null;
  /** True when interval polling is currently carrying the updates. */
  polling: boolean;
  markUpdated: () => void;
}

/**
 * Realtime-first refresh loop: Supabase `postgres_changes` triggers a debounced
 * reload of the page's authorised API, and interval polling stays as a fallback
 * only while the socket is not live.
 */
export function useLiveRefresh(options: UseLiveRefreshOptions): LiveRefreshState {
  const {
    tables,
    fallbackMs = 20_000,
    liveHeartbeatMs = 120_000,
    debounceMs = 400,
    enabled = true,
  } = options;

  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const refreshRef = useRef(options.refresh);
  refreshRef.current = options.refresh;
  const timer = useRef<number | undefined>(undefined);

  const markUpdated = useCallback(() => setLastUpdatedAt(new Date()), []);

  const run = useCallback(async () => {
    await refreshRef.current();
    setLastUpdatedAt(new Date());
  }, []);

  const onChange = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(), debounceMs);
  }, [run, debounceMs]);

  const key = tables.join(",");
  const combined = useMultiTableChannel(key, onChange, enabled);

  const polling = enabled ? !combined.live : true;

  useEffect(() => {
    const interval = polling ? fallbackMs : liveHeartbeatMs;
    if (!interval) return;
    const id = window.setInterval(() => void run(), interval);
    return () => window.clearInterval(id);
  }, [polling, fallbackMs, liveHeartbeatMs, run]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return { ...combined, lastUpdatedAt, polling, markUpdated };
}

/**
 * One Supabase channel carrying `postgres_changes` for several tables, so a
 * page subscribes once regardless of how many tables feed it.
 */
function useMultiTableChannel(
  key: string,
  onChange: () => void,
  enabled: boolean,
): RealtimeSubscription {
  const [status, setStatus] = useState<RealtimeStatus>(enabled ? "connecting" : "fallback");
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (!enabled || !key) {
      setStatus("fallback");
      return;
    }
    let failures = 0;
    setStatus("connecting");
    let channel = supabase.channel(`rt:multi:${key}:${Math.random().toString(36).slice(2, 8)}`);
    for (const table of key.split(",")) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          setLastEventAt(new Date());
          handler.current();
        },
      );
    }
    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        failures = 0;
        setStatus("live");
        return;
      }
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        failures += 1;
        setStatus(failures >= 2 ? "fallback" : "reconnecting");
      }
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [key, enabled]);

  return { status, live: status === "live", lastEventAt };
}
