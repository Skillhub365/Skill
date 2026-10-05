/**
 * Live-integration status per cloud connection.
 *
 * Counters live in the worker; the authoritative timestamps are mirrored into
 * `cloud_connections` so the admin console still shows "last Azure event" after
 * a restart. Nothing here holds credentials.
 */

import type { AzureEventKind, AzureStateSource, ConnectionEventStatus, ReconcileSummary } from "./types";

interface Entry {
  lastEventAt: string | null;
  lastEventKind: AzureEventKind | null;
  lastEventSource: AzureStateSource;
  lastReconciledAt: string | null;
  eventsReceived: number;
  eventsRejected: number;
}

const KEY = "__skilltrack_azure_event_status__";

function store(): Map<string, Entry> {
  const g = globalThis as unknown as Record<string, Map<string, Entry> | undefined>;
  if (!g[KEY]) g[KEY] = new Map<string, Entry>();
  return g[KEY]!;
}

function entry(connectionId: string): Entry {
  const map = store();
  let found = map.get(connectionId);
  if (!found) {
    found = {
      lastEventAt: null,
      lastEventKind: null,
      lastEventSource: "unknown",
      lastReconciledAt: null,
      eventsReceived: 0,
      eventsRejected: 0,
    };
    map.set(connectionId, found);
  }
  return found;
}

/** True when the shared ingest secret is configured on this deployment. */
export function eventGridConfigured(): boolean {
  return Boolean(process.env["AZURE_EVENTGRID_KEY"]);
}

function persistConnection(connectionId: string, patch: Record<string, unknown>) {
  void import("@/lib/db/client.server")
    .then(({ db }) => db())
    .then((supabase) => supabase.from("cloud_connections").update(patch as never).eq("id", connectionId))
    .catch(() => null);
}

export function recordAzureEvent(connectionId: string, kind: AzureEventKind, at = new Date().toISOString()) {
  const e = entry(connectionId);
  e.lastEventAt = at;
  e.lastEventKind = kind;
  e.lastEventSource = "eventgrid";
  e.eventsReceived += 1;
  persistConnection(connectionId, { last_event_at: at, last_event_source: "eventgrid" });
}

export function recordRejectedEvent(connectionId = "unknown") {
  entry(connectionId).eventsRejected += 1;
}

export function recordReconciliation(connectionId: string, summary: ReconcileSummary) {
  const e = entry(connectionId);
  e.lastReconciledAt = summary.finishedAt;
  if (e.lastEventSource === "unknown") e.lastEventSource = "reconciliation";
  persistConnection(connectionId, {
    last_reconciled_at: summary.finishedAt,
    last_reconcile_summary: {
      vmsChecked: summary.vmsChecked,
      corrected: summary.corrected,
      orphans: summary.orphans,
      missing: summary.missing,
      stale: summary.stale,
      failures: summary.failures,
      finishedAt: summary.finishedAt,
    },
  });
}

/** Snapshot for the admin API. `driftCount` comes from the caller's pool view. */
export function connectionEventStatus(
  connectionId: string,
  connectionName: string,
  extra: { lastSyncAt: string | null; driftCount: number },
): ConnectionEventStatus {
  const e = entry(connectionId);
  const configured = eventGridConfigured();
  return {
    connectionId,
    connectionName,
    // "Live" means configured AND actually receiving — never assumed.
    liveConnected: configured && Boolean(e.lastEventAt),
    eventGridConfigured: configured,
    lastEventAt: e.lastEventAt,
    lastEventKind: e.lastEventKind,
    lastEventSource: e.lastEventSource,
    lastSyncAt: extra.lastSyncAt,
    lastReconciledAt: e.lastReconciledAt,
    eventsReceived: e.eventsReceived,
    eventsRejected: e.eventsRejected,
    driftCount: extra.driftCount,
  };
}

/** Seed in-memory counters from the durable row after a cold start. */
export function hydrateStatus(
  connectionId: string,
  row: { lastEventAt?: string | null; lastReconciledAt?: string | null },
) {
  const e = entry(connectionId);
  if (!e.lastEventAt && row.lastEventAt) {
    e.lastEventAt = row.lastEventAt;
    e.lastEventSource = "eventgrid";
  }
  if (!e.lastReconciledAt && row.lastReconciledAt) e.lastReconciledAt = row.lastReconciledAt;
}