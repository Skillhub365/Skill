/** Browser client for infrastructure provisioning. Server-mediated only. */

import { authHeaders } from "@/lib/security/token-store";
import { ApiError } from "@/lib/errors";
import type { SecurityErrorCode } from "@/lib/security/types";
import type { InfrastructureState, ProvisionRequest, ProvisionResult } from "./types";

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { code?: SecurityErrorCode; detail?: string };
  if (!res.ok) throw new ApiError((data.code as SecurityErrorCode) ?? "UNKNOWN", data.detail, res.status);
  return data;
}

export async function fetchInfrastructure(params: {
  connectionId: string;
  resourceGroup?: string;
  vnetName?: string;
  subnetName?: string;
}) {
  const query = new URLSearchParams({ connectionId: params.connectionId });
  if (params.resourceGroup) query.set("resourceGroup", params.resourceGroup);
  if (params.vnetName) query.set("vnetName", params.vnetName);
  if (params.subnetName) query.set("subnetName", params.subnetName);
  return unwrap<{ state: InfrastructureState }>(
    await fetch(`/api/admin/cloud/provision?${query}`, { headers: authHeaders() }),
  );
}

export async function applyInfrastructure(request: ProvisionRequest) {
  return unwrap<ProvisionResult>(
    await fetch("/api/admin/cloud/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(request),
    }),
  );
}
