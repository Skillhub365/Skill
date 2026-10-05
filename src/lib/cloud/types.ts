/**
 * Client-safe cloud controller types.
 *
 * The browser only ever sees lifecycle phases and sanitised machine details.
 * Subscription IDs, resource IDs, private addresses and credentials stay on
 * the server.
 */

export type LifecyclePhase =
  | "REQUESTED"
  | "STARTING"
  | "BOOTING"
  | "RUNNING"
  | "CHECKING"
  | "READY"
  | "CONNECTING"
  | "CONNECTED"
  | "STOPPING"
  | "STOPPED"
  | "ERROR";

export type LifecycleSource = "controller" | "poller" | "eventgrid" | "gateway";

export interface LifecycleEvent {
  /** Monotonic per-session sequence so a reconnecting browser can catch up. */
  seq: number;
  sessionId: string;
  vmId: string;
  phase: LifecyclePhase;
  message: string;
  progress: number;
  source: LifecycleSource;
  at: string;
}

export const PHASE_PROGRESS: Record<LifecyclePhase, number> = {
  REQUESTED: 5,
  STARTING: 25,
  BOOTING: 50,
  RUNNING: 70,
  CHECKING: 88,
  READY: 100,
  CONNECTING: 100,
  CONNECTED: 100,
  STOPPING: 10,
  STOPPED: 0,
  ERROR: 100,
};

export const PHASE_LABEL: Record<LifecyclePhase, string> = {
  REQUESTED: "Request received",
  STARTING: "Starting machine",
  BOOTING: "Machine booting",
  RUNNING: "Machine running",
  CHECKING: "Checking readiness",
  READY: "Ready",
  CONNECTING: "Connecting desktop",
  CONNECTED: "Desktop connected",
  STOPPING: "Stopping",
  STOPPED: "Stopped",
  ERROR: "Failed",
};

/** Lifecycle phases after which no further machine updates are expected. */
export function isTerminalPhase(phase: LifecyclePhase) {
  return phase === "READY" || phase === "STOPPED" || phase === "ERROR" || phase === "CONNECTED";
}

/**
 * Sanitised machine details returned by CloudController.getVMDetails().
 * Azure identifiers are included for administrators only and are masked.
 */
export interface VmDetails {
  vmId: string;
  name: string;
  provider: "Azure" | "AWS" | "GCP";
  region: string;
  size: string;
  image: string;
  status: string;
  phase: LifecyclePhase;
  workspaceId: string;
  labId: string;
  sessionId: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  readiness: { checked: boolean; ready: boolean; detail: string };
  /** Present for administrators; subscription ID masked, no private IP. */
  cloudMapping?: {
    templateId: string;
    azureSubscriptionId: string;
    azureResourceGroup: string;
    azureVmName: string;
    azureResourceId: string;
    azureRegion: string;
  };
}