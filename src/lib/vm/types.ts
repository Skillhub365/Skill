/** Shared, client-safe VM orchestration types. */

export type VmStatus =
  | "STOPPED"
  | "STARTING"
  | "BOOTING"
  | "RUNNING"
  | "READINESS_CHECK"
  | "READY"
  | "STOPPING"
  | "ERROR";

export const VM_LIFECYCLE: VmStatus[] = [
  "STOPPED",
  "STARTING",
  "BOOTING",
  "RUNNING",
  "READINESS_CHECK",
  "READY",
];

export type CloudProviderName = "Azure" | "AWS" | "GCP";

export interface VmRecord {
  id: string;
  name: string;
  provider: CloudProviderName;
  region: string;
  size: string;
  image: string;
  status: VmStatus;
  templateId: string;
  workspaceId: string;
  workspaceName: string;
  labId: string;
  labName: string;
  userId: string;
  userName: string;
  sessionId: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  readiness: { checked: boolean; ready: boolean; detail: string };
  message: string;
  error?: string | null;
}

export interface StartLabResult {
  sessionId: string;
  session: import("../session/types").SessionRecord;
  vm: VmRecord;
  reused?: boolean;
}

/** UI progress steps, derived from the VM status. */
export const VM_STEPS = [
  { key: "request", label: "Request received" },
  { key: "assigned", label: "VM assigned" },
  { key: "starting", label: "Starting VM" },
  { key: "booting", label: "VM booting" },
  { key: "readiness", label: "Checking readiness" },
  { key: "ready", label: "VM Ready" },
] as const;

/** How many of the six steps are complete for a given status. */
const DONE_COUNT: Record<VmStatus, number> = {
  STOPPED: 0,
  STARTING: 2,
  BOOTING: 3,
  RUNNING: 4,
  READINESS_CHECK: 4,
  READY: 6,
  STOPPING: 0,
  ERROR: 0,
};

export function stepState(status: VmStatus, index: number): "done" | "active" | "todo" {
  const done = DONE_COUNT[status] ?? 0;
  if (index < done) return "done";
  if (status === "ERROR" || status === "STOPPED" || status === "STOPPING") return "todo";
  return index === done ? "active" : "todo";
}