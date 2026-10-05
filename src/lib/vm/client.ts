import type { StartLabResult, VmRecord } from "./types";
import { authHeaders } from "@/lib/security/token-store";
import { ApiError } from "@/lib/errors";
import type { SecurityErrorCode } from "@/lib/security/types";

/**
 * The launch request carries only the lab id. Workspace, entitlement,
 * template, image, region, size, provider and duration are resolved
 * server-side from database records.
 */
export interface StartLabPayload {
  labId: string;
}

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: SecurityErrorCode; detail?: string };
  if (!res.ok) throw new ApiError(data.code ?? "UNKNOWN", data.detail, res.status);
  return data;
}

export async function startLab({ labId }: StartLabPayload): Promise<StartLabResult> {
  const res = await fetch(`/api/labs/${labId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({}),
  });
  return unwrap<StartLabResult>(res);
}

function snapshotParam(vm: VmRecord) {
  const { readiness: _r, message: _m, error: _e, ...rest } = vm;
  return encodeURIComponent(JSON.stringify(rest));
}

export async function getVmStatus(vm: VmRecord): Promise<VmRecord> {
  const res = await fetch(`/api/vms/${vm.id}/status?snapshot=${snapshotParam(vm)}`, { headers: authHeaders() });
  const data = await unwrap<{ vm: VmRecord }>(res);
  return data.vm;
}

export async function startVm(vm: VmRecord, durationMinutes = 60): Promise<VmRecord> {
  const { readiness: _r, message: _m, error: _e, ...snapshot } = vm;
  const res = await fetch(`/api/vms/${vm.id}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ durationMinutes, snapshot }),
  });
  const data = await unwrap<{ vm: VmRecord }>(res);
  return data.vm;
}

export async function stopVm(vm: VmRecord): Promise<VmRecord | null> {
  const res = await fetch(`/api/vms/${vm.id}/stop`, { method: "POST", headers: authHeaders() });
  const data = await unwrap<{ vm: VmRecord | null }>(res);
  return data.vm;
}

/** Admin view of a machine, including its masked cloud resource mapping. */
export async function getVmDetails(vmId: string): Promise<import("@/lib/cloud/types").VmDetails> {
  const res = await fetch(`/api/vms/${vmId}/details`, { headers: authHeaders() });
  const data = await unwrap<{ details: import("@/lib/cloud/types").VmDetails }>(res);
  return data.details;
}