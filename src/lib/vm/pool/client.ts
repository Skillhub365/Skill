/** Browser client for the VM pool. Every call goes to SkillTrack, never Azure. */

import { ApiError } from "@/lib/errors";
import { authHeaders } from "@/lib/security/token-store";
import type { SecurityErrorCode } from "@/lib/security/types";
import type { AzureResourceGroup } from "@/lib/cloud/connections/types";
import type { CloudAuditEntry } from "@/lib/cloud/audit/types";
import type { GalleryConnectionOption } from "@/lib/cloud/gallery/types";
import type {
  DiscoveredVm,
  PoolTemplateSummary,
  PoolVm,
  PoolVmKind,
  RdpTestResult,
  RegisterVmDraft,
  VmTestResult,
} from "./types";

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { code?: SecurityErrorCode; detail?: string };
  if (!res.ok) throw new ApiError((data.code as SecurityErrorCode) ?? "UNKNOWN", data.detail, res.status);
  return data;
}

const base = "/api/admin/cloud/vm-pool";

export interface PoolTemplateOption {
  id: string;
  name: string;
  region: string;
  vmSize: string;
  osType: string;
  cloudConnectionId: string;
  cloudConnectionName: string;
  defaultSessionDuration: number;
}

/** How the platform is wired right now, shown as a banner on the console. */
export interface PoolRuntimeBadge {
  environment: string;
  vmMode: string;
  remoteDesktopMode: string;
  azureConfigured: boolean;
  guacamoleConfigured: boolean;
  degraded: boolean;
  degradedReasons: string[];
}

export interface PoolWorkspaceOption {
  id: string;
  name: string;
}

export async function fetchPool() {
  return unwrap<{
    vms: PoolVm[];
    summaries: PoolTemplateSummary[];
    templates: PoolTemplateOption[];
    dynamicProvisioning: boolean;
    reaper: ReaperRun | null;
    kinds: Record<string, PoolVmKind>;
    runtime: PoolRuntimeBadge;
    workspaces: PoolWorkspaceOption[];
  }>(await fetch(base, { headers: authHeaders() }));
}

export interface ReaperRun {
  at: string;
  expiredSessions: number;
  releasedVms: number;
  orphans: number;
  errors: string[];
}

export async function discoverAzureVms(connectionId: string, resourceGroup: string) {
  const search = new URLSearchParams({ connectionId, resourceGroup });
  return unwrap<{ vms: DiscoveredVm[] }>(await fetch(`${base}/discover?${search}`, { headers: authHeaders() }));
}

export async function registerPoolVm(draft: RegisterVmDraft) {
  return unwrap<{ vm: PoolVm }>(
    await fetch(base, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }),
  );
}

export type PoolVmAction =
  | "sync"
  | "start"
  | "stop"
  | "restart"
  | "reclaim"
  | "release"
  | "retire"
  | "restore"
  | "assign-workspace"
  | "assign-user-lab";

export interface PoolActionPayload {
  workspaceId?: string | null;
  userId?: string | null;
  userName?: string | null;
  labId?: string | null;
}

export async function poolVmAction(vmId: string, action: PoolVmAction, payload: PoolActionPayload = {}) {
  return unwrap<{ vm: PoolVm | null; message?: string }>(
    await fetch(`${base}/${vmId}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    }),
  );
}

/** Ask the server to probe Azure for the true state of one machine. */
export async function testVmAzure(vmId: string) {
  return unwrap<{ test: VmTestResult }>(
    await fetch(`${base}/${vmId}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test-azure" }),
    }),
  );
}

/** Run the redacted remote-desktop readiness checklist for one machine. */
export async function testVmRdp(vmId: string) {
  return unwrap<{ rdp: RdpTestResult }>(
    await fetch(`${base}/${vmId}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test-rdp" }),
    }),
  );
}

export async function syncPool() {
  return unwrap<{ vms: PoolVm[]; summaries: PoolTemplateSummary[]; orphans: number; reaper: ReaperRun }>(
    await fetch(`${base}/sync`, { method: "POST", headers: authHeaders() }),
  );
}

/** Audit entries for pool/VM actions, newest first. */
export async function fetchPoolAudit(limit = 100) {
  const data = await unwrap<{ entries: CloudAuditEntry[] }>(
    await fetch(`/api/admin/cloud/audit?limit=${limit}`, { headers: authHeaders() }),
  );
  return data.entries.filter((e) => e.action.startsWith("vmpool.") || e.action.startsWith("vm."));
}

export async function removePoolVm(vmId: string) {
  return unwrap<{ removed: boolean }>(
    await fetch(`${base}/${vmId}`, { method: "DELETE", headers: authHeaders() }),
  );
}

/** Connection + resource-group pickers are shared with the gallery importer. */
export async function fetchPoolConnections() {
  return unwrap<{ connections: GalleryConnectionOption[] }>(
    await fetch("/api/admin/cloud/gallery?level=connections", { headers: authHeaders() }),
  );
}

export async function fetchPoolResourceGroups(connectionId: string) {
  const search = new URLSearchParams({ level: "resource-groups", connectionId });
  return unwrap<{ resourceGroups: AzureResourceGroup[] }>(
    await fetch(`/api/admin/cloud/gallery?${search}`, { headers: authHeaders() }),
  );
}
