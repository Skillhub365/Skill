/** Browser client for the Usage Reports console. Read-only, admin endpoints. */

import { ApiError } from "@/lib/errors";
import { authHeaders } from "@/lib/security/token-store";
import type { SecurityErrorCode } from "@/lib/security/types";

export interface UsageDimensionView {
  key: string;
  label: string;
  sessions: number;
  vmHours: number;
  estimatedCostCents: number;
}

export interface SessionUsageRowView {
  sessionId: string;
  learnerName: string;
  learnerEmail: string | null;
  workspace: string;
  lab: string;
  vmName: string | null;
  azureResourceId: string | null;
  vmSize: string | null;
  region: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  status: string;
  live: boolean;
  estimatedCostCents: number;
  assignmentType: "session-based" | "persistent";
  persistentRemainingHours: number | null;
  persistentAllowedHours: number | null;
  accessEndsAt: string | null;
  correlationId: string | null;
}

export interface SessionUsageView {
  generatedAt: string;
  pricingSource: string;
  from: string;
  to: string;
  scope: "tenant" | "platform";
  rows: SessionUsageRowView[];
  totals: {
    sessions: number;
    active: number;
    completed: number;
    expired: number;
    stopped: number;
    failed: number;
    vmHours: number;
    estimatedCostCents: number;
  };
  byVm: UsageDimensionView[];
  byLearner: UsageDimensionView[];
  byWorkspace: UsageDimensionView[];
  byLab: UsageDimensionView[];
  bySize: UsageDimensionView[];
  byMode: UsageDimensionView[];
  tenants: Array<{ id: string; name: string }>;
}

export interface ActivityRowView {
  id: string;
  at: string;
  stream: "user" | "vm" | "admin";
  source: string;
  action: string;
  actor: string;
  target: string;
  outcome: "success" | "failure" | "info";
  detail: string | null;
  correlationId: string | null;
  sessionId: string | null;
}

export interface UsageQuery {
  from?: string;
  to?: string;
  tenantId?: string;
  workspaceId?: string;
  labId?: string;
  userId?: string;
  vm?: string;
  status?: string;
  stream?: string;
}

export function usageParams(query: UsageQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  return params;
}

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { code?: SecurityErrorCode; detail?: string };
  if (!res.ok) throw new ApiError((data.code as SecurityErrorCode) ?? "UNKNOWN", data.detail, res.status);
  return data;
}

export async function fetchSessionUsage(query: UsageQuery): Promise<SessionUsageView> {
  const res = await fetch(`/api/admin/usage-report/sessions?${usageParams(query).toString()}`, {
    headers: authHeaders(),
  });
  return unwrap<SessionUsageView>(res);
}

export async function fetchUsageActivity(
  query: UsageQuery,
): Promise<{ generatedAt: string; from: string; to: string; rows: ActivityRowView[] }> {
  const res = await fetch(`/api/admin/usage-report/activity?${usageParams(query).toString()}`, {
    headers: authHeaders(),
  });
  return unwrap<{ generatedAt: string; from: string; to: string; rows: ActivityRowView[] }>(res);
}

/** Streams an export through the authorised endpoint and saves it locally. */
export async function downloadUsageExport(
  endpoint: "sessions" | "activity",
  query: UsageQuery,
  format: "csv" | "json",
) {
  const params = usageParams(query);
  params.set("format", format);
  const res = await fetch(`/api/admin/usage-report/${endpoint}?${params.toString()}`, { headers: authHeaders() });
  if (!res.ok) throw new ApiError("UNKNOWN", "The export could not be generated.", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const from = (query.from ?? "").slice(0, 10) || "start";
  const to = (query.to ?? "").slice(0, 10) || "today";
  anchor.download = `skilltrack-${endpoint}-${from}_${to}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
