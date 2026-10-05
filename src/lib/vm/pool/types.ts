/** Client-safe VM pool model: registered Azure machines mapped to SkillTrack. */

export type PoolVmStatus =
  | "AVAILABLE"
  | "ALLOCATED"
  | "STARTING"
  | "BOOTING"
  | "RUNNING"
  | "READY"
  | "IN_USE"
  | "STOPPING"
  | "STOPPED"
  | "ERROR"
  | "RETIRED";

export const POOL_STATUS_LABEL: Record<PoolVmStatus, string> = {
  AVAILABLE: "Available",
  ALLOCATED: "Allocated",
  STARTING: "Starting",
  BOOTING: "Booting",
  RUNNING: "Running",
  READY: "Ready",
  IN_USE: "In use",
  STOPPING: "Stopping",
  STOPPED: "Stopped",
  ERROR: "Error",
  RETIRED: "Retired",
};

/** A registered Azure VM as the admin console sees it (identifiers masked). */
export interface PoolVm {
  id: string;
  name: string;
  workspaceId: string | null;
  labId: string | null;
  templateId: string;
  templateName: string;
  cloudConnectionId: string;
  cloudConnectionName: string;
  subscriptionId: string;
  resourceGroup: string;
  azureResourceId: string;
  azureVmName: string;
  region: string;
  vmSize: string;
  imageVersion: string;
  osType: string;
  status: PoolVmStatus;
  assignedUserId: string | null;
  assignedUserName: string | null;
  currentSessionId: string | null;
  /** Normalised Azure power state, never the raw ARM payload. */
  powerState: string;
  lastSyncedAt: string | null;
  orphaned: boolean;
  error: string | null;
  mock: boolean;
  createdAt: string;
  updatedAt: string;
  /* ------------------------------------- Event-driven state (Event Grid) */
  /** When Azure last pushed an event for this machine. */
  lastAzureEventAt?: string | null;
  /** Normalised kind of that event, e.g. "running". */
  lastEventType?: string | null;
  /** Where the current state came from: eventgrid | manual-sync | reconciliation. */
  lastEventSource?: string | null;
  /** Set when Azure and SkillTrack disagreed at the last reconciliation. */
  driftDetected?: boolean;
  driftDetail?: string | null;
  /** Azure no longer returns this resource. */
  azureMissing?: boolean;
  lastReconciledAt?: string | null;
  /** Allocation lease: set while a machine is claimed for a launch. */
  allocationLockToken?: string | null;
  allocationExpiresAt?: string | null;
  /** Server-only; never serialised to the browser (see poolVmForClient). */
  privateIp?: string | null;
}

/** Strip server-only fields before a pool record reaches an admin browser. */
export function poolVmForClient(vm: PoolVm): PoolVm {
  const { privateIp: _privateIp, allocationLockToken: _token, ...safe } = vm;
  return safe as PoolVm;
}

export interface PoolTemplateSummary {
  templateId: string;
  templateName: string;
  total: number;
  available: number;
  allocated: number;
  running: number;
  inUse: number;
  stopped: number;
  error: number;
}

export interface RegisterVmDraft {
  cloudConnectionId: string;
  resourceGroup: string;
  azureVmName: string;
  templateId: string;
  workspaceId?: string | null | undefined;
  displayName?: string | undefined;
}

export interface CompatibilityWarning {
  field: string;
  expected: string;
  actual: string;
}

/** A candidate Azure VM discovered in the subscription, before registration. */
export interface DiscoveredVm {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  vmSize: string;
  osType: string;
  powerState: string;
  provisioningState: string;
  registered: boolean;
}

export const REGISTER_STEP_LABEL = [
  "Cloud connection",
  "Resource group",
  "Azure VM",
  "SkillTrack template",
  "Review & register",
] as const;

/* --------------------------------------------- Super Admin operations model */

/** How a registered machine is backed right now. */
export type PoolVmKind = "azure" | "mock" | "unavailable";

export const POOL_KIND_LABEL: Record<PoolVmKind, string> = {
  azure: "Real Azure",
  mock: "Development sample",
  unavailable: "Unavailable",
};

/** Result of probing Azure for one machine. Contains no raw ARM payload. */
export interface VmTestResult {
  ok: boolean;
  kind: PoolVmKind;
  powerState: string;
  provisioningState: string;
  agentReady: boolean;
  detail: string;
  durationMs: number;
  checkedAt: string;
}

export interface RdpTestStep {
  label: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}

/** Redacted remote-desktop readiness report: no addresses, no credentials. */
export interface RdpTestResult {
  ready: boolean;
  mode: string;
  kind: PoolVmKind;
  steps: RdpTestStep[];
  summary: string;
  durationMs: number;
  checkedAt: string;
}
