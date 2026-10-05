/** Browser client for Azure live-event status and reconciliation. */

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/errors";
import { authHeaders } from "@/lib/security/token-store";
import type { SecurityErrorCode } from "@/lib/security/types";
import type { ConnectionEventStatus, ReconcileSummary } from "./types";

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { code?: SecurityErrorCode; detail?: string };
  if (!res.ok) throw new ApiError((data.code as SecurityErrorCode) ?? "UNKNOWN", data.detail, res.status);
  return data;
}

const base = "/api/admin/cloud/reconcile";

export interface AzureEventStatusResponse {
  eventGridConfigured: boolean;
  statuses: ConnectionEventStatus[];
  lastReconcile: ReconcileSummary | null;
}

export async function fetchAzureEventStatus() {
  return unwrap<AzureEventStatusResponse>(await fetch(base, { headers: authHeaders() }));
}

export async function runReconciliation() {
  return unwrap<{ summary: ReconcileSummary }>(
    await fetch(base, { method: "POST", headers: authHeaders() }),
  );
}

/** Small read-only hook shared by the VM Pool and Cloud Connections pages. */
export function useAzureEventStatus(refreshKey?: unknown) {
  const [data, setData] = useState<AzureEventStatusResponse | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await fetchAzureEventStatus());
    } catch {
      setData(null);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);
  return { data, reload };
}