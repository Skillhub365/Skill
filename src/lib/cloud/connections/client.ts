/**
 * Browser client for cloud connection management.
 *
 * The browser only ever talks to SkillTrack endpoints — never to Azure. Client
 * secrets travel one way (form -> server) and are never returned.
 */

import { authHeaders } from "@/lib/security/token-store";
import { ApiError } from "@/lib/errors";
import type { SecurityErrorCode } from "@/lib/security/types";
import type { CloudAuditEntry } from "@/lib/cloud/audit/types";
import type { ConnectionHealth, ConnectionSchedule } from "./health-types";
import type {
  AzureInventory,
  AzureVirtualMachine,
  CloudConnection,
  ValidationResult,
  WorkspaceCloudLink,
} from "./types";

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & {
    code?: SecurityErrorCode;
    detail?: string;
    result?: ValidationResult;
  };
  if (!res.ok) {
    const error = new ApiError((data.code as SecurityErrorCode) ?? "UNKNOWN", data.detail, res.status);
    // Validation failures carry the per-step trace so the modal can show it.
    (error as ApiError & { result?: ValidationResult | undefined }).result = data.result;
    throw error;
  }
  return data;
}

function json(method: string, body?: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

const base = "/api/admin/cloud";

export async function fetchConnections() {
  return unwrap<{
    connections: CloudConnection[];
    links: WorkspaceCloudLink[];
    secretStore: string;
    schedule?: RefreshSchedule;
  }>(
    await fetch(`${base}/connections`, { headers: authHeaders() }),
  );
}

export interface ConnectionDraft {
  name: string;
  tenantId: string;
  subscriptionId: string;
  clientId: string;
  clientSecret: string;
  defaultResourceGroup?: string;
  defaultRegion?: string;
  description?: string;
}

/** Real Azure test for credentials that have not been saved yet. */
export async function validateDraft(draft: ConnectionDraft & { connectionId?: string }) {
  return unwrap<{ result: ValidationResult }>(await fetch(`${base}/validate`, json("POST", draft)));
}

export async function createConnection(draft: ConnectionDraft) {
  return unwrap<{ connection: CloudConnection; result: ValidationResult }>(
    await fetch(`${base}/connections`, json("POST", draft)),
  );
}

export async function updateConnection(id: string, patch: Partial<ConnectionDraft>) {
  return unwrap<{ connection: CloudConnection }>(await fetch(`${base}/connections/${id}`, json("PATCH", patch)));
}

export async function deleteConnection(id: string) {
  return unwrap<{ disconnected: boolean }>(await fetch(`${base}/connections/${id}`, json("DELETE")));
}

export async function testConnection(id: string) {
  return unwrap<{ connection: CloudConnection; result: ValidationResult }>(
    await fetch(`${base}/connections/${id}/test`, json("POST")),
  );
}

export async function refreshResources(id: string) {
  return unwrap<{ connection: CloudConnection; inventory: AzureInventory }>(
    await fetch(`${base}/connections/${id}/resources`, json("POST")),
  );
}

export async function getResources(id: string) {
  return unwrap<{ inventory: AzureInventory | null; schedule?: RefreshSchedule }>(
    await fetch(`${base}/connections/${id}/resources`, { headers: authHeaders() }),
  );
}

export async function vmAction(id: string, action: "start" | "stop" | "status", resourceGroup: string, vmName: string) {
  return unwrap<{ vm: AzureVirtualMachine | null }>(
    await fetch(`${base}/connections/${id}/vm-action`, json("POST", { action, resourceGroup, vmName })),
  );
}

export async function linkWorkspace(input: {
  workspaceId: string;
  cloudConnectionId: string;
  resourceGroup?: string;
  defaultRegion?: string;
}) {
  return unwrap<{ link: WorkspaceCloudLink }>(await fetch(`${base}/workspace-links`, json("PUT", input)));
}

export async function unlinkWorkspace(workspaceId: string) {
  return unwrap<{ removed: boolean }>(
    await fetch(`${base}/workspace-links?workspaceId=${encodeURIComponent(workspaceId)}`, json("DELETE")),
  );
}

export interface RefreshSchedule {
  enabled: boolean;
  intervalMs: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  running: boolean;
  runs: number;
  failures: number;
}

/** Cloud + VM audit trail (requires the audit:read capability). */
export async function fetchAudit(
  params: { connectionId?: string | undefined; workspaceId?: string | undefined; limit?: number | undefined } = {},
) {
  const query = new URLSearchParams();
  if (params.connectionId) query.set("connectionId", params.connectionId);
  if (params.workspaceId) query.set("workspaceId", params.workspaceId);
  query.set("limit", String(params.limit ?? 200));
  return unwrap<{ entries: CloudAuditEntry[]; schedule: RefreshSchedule }>(
    await fetch(`${base}/audit?${query.toString()}`, { headers: authHeaders() }),
  );
}

export interface WorkspaceCloudScope {
  workspaceId: string;
  connectionId: string;
  connectionName: string;
  provider: string;
  subscriptionId: string;
  subscriptionName: string | null;
  resourceGroup: string;
  region: string;
  status: string;
  linkedAt: string;
  lastSyncAt: string | null;
}

/** Only the resource group and connection mapped to this one workspace. */
export async function fetchWorkspaceResources(workspaceId: string) {
  return unwrap<{
    mapped: boolean;
    scope: WorkspaceCloudScope | null;
    virtualMachines: AzureVirtualMachine[];
    schedule: RefreshSchedule;
  }>(await fetch(`${base}/workspace-resources?workspaceId=${encodeURIComponent(workspaceId)}`, { headers: authHeaders() }));
}

/** Health diagnostics (samples + recurring failures) and per-connection schedules. */
export async function fetchHealth(connectionId?: string) {
  const query = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
  return unwrap<{ health: ConnectionHealth[]; schedules: ConnectionSchedule[] }>(
    await fetch(`${base}/health${query}`, { headers: authHeaders() }),
  );
}

export async function getConnectionSchedule(id: string) {
  return unwrap<{ schedule: ConnectionSchedule }>(
    await fetch(`${base}/connections/${id}/schedule`, { headers: authHeaders() }),
  );
}

export async function setConnectionSchedule(id: string, patch: { paused?: boolean; intervalMs?: number }) {
  return unwrap<{ schedule: ConnectionSchedule }>(
    await fetch(`${base}/connections/${id}/schedule`, json("PATCH", patch)),
  );
}
