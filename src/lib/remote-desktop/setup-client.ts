import { ApiError } from "@/lib/errors";
import { authHeaders } from "@/lib/security/token-store";
import type { SecurityErrorCode } from "@/lib/security/types";
import type { GatewaySettingsInput, GatewaySetupStatus, GatewayVerification } from "./gateway-setup-types";

const ENDPOINT = "/api/admin/cloud/gateway-setup";

async function call<T>(init?: RequestInit): Promise<T> {
  const res = await fetch(ENDPOINT, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { code?: SecurityErrorCode; detail?: string };
  if (!res.ok) throw new ApiError(data.code ?? "UNKNOWN", data.detail, res.status);
  return data;
}

export async function fetchGatewaySetup(): Promise<GatewaySetupStatus> {
  const data = await call<{ status: GatewaySetupStatus }>();
  return data.status;
}

export async function saveGatewaySetup(input: GatewaySettingsInput): Promise<GatewaySetupStatus> {
  const data = await call<{ status: GatewaySetupStatus }>({
    method: "POST",
    body: JSON.stringify({ action: "save", ...input }),
  });
  return data.status;
}

export async function verifyGatewaySetup(vmId?: string | null): Promise<{
  verification: GatewayVerification;
  status: GatewaySetupStatus;
}> {
  return await call<{ verification: GatewayVerification; status: GatewaySetupStatus }>({
    method: "POST",
    body: JSON.stringify({ action: "verify", vmId: vmId ?? undefined }),
  });
}
