/**
 * Client-safe model for event-driven Azure state.
 *
 * Anything in here can be rendered in the admin console: it carries only
 * timestamps, counters and normalised labels — never resource IDs, secrets or
 * raw provider payloads.
 */

/** Where the last known state of a machine came from. */
export type AzureStateSource = "eventgrid" | "manual-sync" | "reconciliation" | "unknown";

export const AZURE_STATE_SOURCE_LABEL: Record<AzureStateSource, string> = {
  eventgrid: "Event Grid",
  "manual-sync": "Manual sync",
  reconciliation: "Reconciliation",
  unknown: "Not observed yet",
};

/** Normalised Azure event kinds SkillTrack acts on. */
export type AzureEventKind =
  | "start-accepted"
  | "running"
  | "deallocating"
  | "deallocated"
  | "failed"
  | "provisioning-failed"
  | "deleted";

export const AZURE_EVENT_KIND_LABEL: Record<AzureEventKind, string> = {
  "start-accepted": "Start accepted",
  running: "Running",
  deallocating: "Deallocating",
  deallocated: "Deallocated",
  failed: "Operation failed",
  "provisioning-failed": "Provisioning failed",
  deleted: "Resource deleted",
};

/** Outcome of one Event Grid POST, as reported back to Azure. */
export interface IngestSummary {
  received: number;
  applied: number;
  ignored: number;
  unknownResources: number;
}

/** One machine's drift finding from a reconciliation pass. */
export interface ReconcileFinding {
  vmId: string;
  vmName: string;
  kind: "drift" | "orphan" | "missing" | "stale";
  expected: string;
  actual: string;
  corrected: boolean;
}

export interface ReconcileSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  connectionsChecked: number;
  vmsChecked: number;
  corrected: number;
  orphans: number;
  missing: number;
  stale: number;
  failures: number;
  findings: ReconcileFinding[];
}

/** Per-connection live-integration status shown on the cloud admin pages. */
export interface ConnectionEventStatus {
  connectionId: string;
  connectionName: string;
  /** True only when the ingest secret is configured AND an event has arrived. */
  liveConnected: boolean;
  eventGridConfigured: boolean;
  lastEventAt: string | null;
  lastEventKind: AzureEventKind | null;
  lastEventSource: AzureStateSource;
  lastSyncAt: string | null;
  lastReconciledAt: string | null;
  eventsReceived: number;
  eventsRejected: number;
  driftCount: number;
}

/** How long without an event before a machine's state is called stale. */
export const STALE_AFTER_MS = 30 * 60_000;