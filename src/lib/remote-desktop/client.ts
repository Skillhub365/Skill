import type { RemoteConnection } from "./types";
import { authHeaders } from "@/lib/security/token-store";
import { ApiError } from "@/lib/errors";
import type { SecurityErrorCode } from "@/lib/security/types";

async function unwrap(res: Response): Promise<RemoteConnection | null> {
  const data = (await res.json().catch(() => ({}))) as {
    connection?: RemoteConnection | null;
    error?: string;
    code?: SecurityErrorCode;
    detail?: string;
  };
  if (!res.ok) throw new ApiError(data.code ?? "CONNECTION_FAILED", data.detail, res.status);
  return data.connection ?? null;
}

/**
 * Bearer token + identity hint. The gateway re-verifies the token signature and
 * the session's owner server-side; the URL alone authorizes nothing.
 */
function identity(userId: string) {
  return { "x-stl-user-id": userId, ...authHeaders() };
}

export async function createConnection(
  sessionId: string,
  input: { vmId: string; machineName: string; durationMinutes?: number; userId: string },
): Promise<RemoteConnection> {
  const res = await fetch(`/api/sessions/${sessionId}/connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identity(input.userId) },
    body: JSON.stringify(input),
  });
  const connection = await unwrap(res);
  if (!connection) throw new Error("Gateway did not return a connection");
  return connection;
}

export async function getConnectionStatus(sessionId: string, userId: string): Promise<RemoteConnection | null> {
  return unwrap(await fetch(`/api/sessions/${sessionId}/connection`, { headers: identity(userId) }));
}

export async function terminateConnection(sessionId: string, userId: string): Promise<RemoteConnection | null> {
  return unwrap(await fetch(`/api/sessions/${sessionId}/connection`, { method: "DELETE", headers: identity(userId) }));
}