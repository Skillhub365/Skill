/** Client-safe contracts for connection health diagnostics and refresh schedules. */

export type HealthSource = "manual-test" | "scheduled-refresh" | "manual-refresh" | "validation";

export interface HealthSample {
  id: string;
  connectionId: string;
  at: string;
  source: HealthSource;
  ok: boolean;
  /** Normalized status/error code — never a raw provider message. */
  status: string;
  latencyMs: number;
  message: string | null;
}

export interface RecurringFailure {
  status: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

export interface ConnectionHealth {
  connectionId: string;
  connectionName: string;
  samples: HealthSample[];
  total: number;
  failures: number;
  /** Rolling success rate across the retained window, 0-100. */
  successRate: number;
  consecutiveFailures: number;
  averageLatencyMs: number;
  lastOkAt: string | null;
  lastFailureAt: string | null;
  lastStatus: string | null;
  /** Failure codes seen 2+ times in the window, worst first. */
  recurring: RecurringFailure[];
  /** "healthy" | "degraded" | "failing" | "unknown" */
  verdict: "healthy" | "degraded" | "failing" | "unknown";
}

export interface ConnectionSchedule {
  connectionId: string;
  paused: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastOutcome: "success" | "failure" | null;
  running: boolean;
  runs: number;
  failures: number;
}

export const MIN_REFRESH_INTERVAL_MS = 30_000;
export const MAX_REFRESH_INTERVAL_MS = 6 * 60 * 60_000;

export const REFRESH_INTERVAL_CHOICES = [
  { label: "30 seconds", value: 30_000 },
  { label: "1 minute", value: 60_000 },
  { label: "5 minutes", value: 300_000 },
  { label: "15 minutes", value: 900_000 },
  { label: "30 minutes", value: 1_800_000 },
  { label: "1 hour", value: 3_600_000 },
  { label: "6 hours", value: 21_600_000 },
];

export function healthTone(verdict: ConnectionHealth["verdict"]) {
  switch (verdict) {
    case "healthy":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
    case "degraded":
      return "bg-amber-500/10 text-amber-700 border-amber-500/30";
    case "failing":
      return "bg-destructive/10 text-destructive border-destructive/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
