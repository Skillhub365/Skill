import type { SessionRecord, SessionSnapshot, SessionConnectionStatus } from "./types";
import { authHeaders } from "@/lib/security/token-store";
import { ApiError } from "@/lib/errors";
import type { SecurityErrorCode } from "@/lib/security/types";

async function unwrap(res: Response): Promise<SessionSnapshot> {
  const data = (await res.json().catch(() => ({}))) as SessionSnapshot & {
    error?: string;
    code?: SecurityErrorCode;
    detail?: string;
  };
  if (!res.ok && !data.session) throw new ApiError(data.code ?? "SESSION_NOT_FOUND", data.detail, res.status);
  if (data.error) throw Object.assign(new ApiError(data.code ?? "UNKNOWN", data.error, res.status), { snapshot: data });
  return data;
}

const path = (id: string) => `/api/sessions/${id}/state`;

export async function fetchSession(session: SessionRecord): Promise<SessionSnapshot> {
  const res = await fetch(`${path(session.id)}?snapshot=${encodeURIComponent(JSON.stringify(session))}`, {
    headers: authHeaders(),
  });
  return unwrap(res);
}

export async function sendHeartbeat(
  session: SessionRecord,
  patch?: { connectionStatus?: SessionConnectionStatus; vmStatus?: string },
): Promise<SessionSnapshot> {
  const res = await fetch(path(session.id), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ action: "heartbeat", snapshot: session, ...patch }),
  });
  return unwrap(res);
}

export async function extendSession(session: SessionRecord, minutes: number): Promise<SessionSnapshot> {
  const res = await fetch(path(session.id), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ action: "extend", minutes, snapshot: session }),
  });
  return unwrap(res);
}

export async function stopSession(session: SessionRecord): Promise<SessionSnapshot> {
  const res = await fetch(path(session.id), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ action: "stop", snapshot: session }),
  });
  return unwrap(res);
}
