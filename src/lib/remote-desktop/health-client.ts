import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/errors";
import { authHeaders } from "@/lib/security/token-store";
import type { SecurityErrorCode } from "@/lib/security/types";
import type { RemoteDesktopHealthReport } from "./health-types";

/** Browser client for the remote-desktop health probe. */
export async function fetchGatewayHealth(): Promise<RemoteDesktopHealthReport> {
  const res = await fetch("/api/admin/cloud/gateway-health", { headers: authHeaders() });
  const data = (await res.json().catch(() => ({}))) as {
    health?: RemoteDesktopHealthReport;
    code?: SecurityErrorCode;
    detail?: string;
  };
  if (!res.ok || !data.health) throw new ApiError(data.code ?? "UNKNOWN", data.detail, res.status);
  return data.health;
}

export function useGatewayHealth() {
  const [data, setData] = useState<RemoteDesktopHealthReport | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchGatewayHealth());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, refresh };
}
