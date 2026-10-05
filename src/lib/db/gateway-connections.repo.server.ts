import { db } from "./client.server";
import type { ClipboardPolicy, ConnectionKind, ConnectionState, RemoteConnection } from "@/lib/remote-desktop/types";

/**
 * Durable remote-desktop broker state.
 *
 * One row per session (unique index on `session_id`). It holds only what the
 * platform needs in order to rebuild or clean up a connection from any worker:
 * the Guacamole connection identifier, the ephemeral username, status and
 * timings. It deliberately stores NO tunnel token, NO RDP credentials and NO
 * private VM address.
 */

export type GatewayStatus = "PENDING" | "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "ERROR" | "CLEANED";

export interface GatewayRecord {
  id: string;
  sessionId: string;
  guacConnectionId: string | null;
  guacUsername: string | null;
  guacUserCreatedAt: string | null;
  status: GatewayStatus;
  tokenExpiresAt: string | null;
  expiresAt: string | null;
  cleanedUpAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** Non-sensitive broker bookkeeping needed to rebuild a RemoteConnection. */
  metadata: {
    vmRef?: string;
    kind?: ConnectionKind;
    machineName?: string;
    gateway?: string;
    clipboard?: ClipboardPolicy;
    message?: string;
    code?: string | null;
    connectDeadline?: number;
    handshakeAt?: number;
    latencyMs?: number;
  };
}

const STATE_FOR: Record<GatewayStatus, ConnectionState> = {
  PENDING: "CONNECTING",
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  ERROR: "ERROR",
  CLEANED: "DISCONNECTED",
};

export function stateFor(status: GatewayStatus): ConnectionState {
  return STATE_FOR[status] ?? "DISCONNECTED";
}

export function statusFor(state: ConnectionState): GatewayStatus {
  if (state === "CONNECTED") return "CONNECTED";
  if (state === "ERROR") return "ERROR";
  if (state === "CONNECTING") return "CONNECTING";
  return "DISCONNECTED";
}

function toRecord(row: Record<string, unknown>): GatewayRecord {
  return {
    id: String(row["id"]),
    sessionId: String(row["session_id"]),
    guacConnectionId: (row["guac_connection_id"] as string | null) ?? null,
    guacUsername: (row["guac_username"] as string | null) ?? null,
    guacUserCreatedAt: (row["guac_user_created_at"] as string | null) ?? null,
    status: (row["status"] as GatewayStatus) ?? "PENDING",
    tokenExpiresAt: (row["token_expires_at"] as string | null) ?? null,
    expiresAt: (row["expires_at"] as string | null) ?? null,
    cleanedUpAt: (row["cleaned_up_at"] as string | null) ?? null,
    lastError: (row["last_error"] as string | null) ?? null,
    createdAt: String(row["created_at"]),
    metadata: (row["metadata"] as GatewayRecord["metadata"]) ?? {},
  };
}

export interface UpsertGatewayInput {
  sessionId: string;
  status: GatewayStatus;
  guacConnectionId?: string | null;
  guacUsername?: string | null;
  guacUserCreatedAt?: string | null;
  tokenExpiresAt?: string | null;
  expiresAt?: string | null;
  cleanedUpAt?: string | null;
  lastError?: string | null;
  metadata?: GatewayRecord["metadata"];
}

/** Idempotent write-through keyed by session. */
export async function upsertGateway(input: UpsertGatewayInput): Promise<GatewayRecord | null> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("gateway_connections")
      .upsert(
        {
          session_id: input.sessionId,
          status: input.status,
          guac_connection_id: input.guacConnectionId ?? null,
          guac_username: input.guacUsername ?? null,
          guac_user_created_at: input.guacUserCreatedAt ?? null,
          token_expires_at: input.tokenExpiresAt ?? null,
          expires_at: input.expiresAt ?? null,
          cleaned_up_at: input.cleanedUpAt ?? null,
          last_error: input.lastError ?? null,
          metadata: (input.metadata ?? {}) as never,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "session_id" },
      )
      .select("*")
      .single();
    return data ? toRecord(data as Record<string, unknown>) : null;
  } catch (error) {
    console.error("[gateway] persist failed", (error as Error)?.message);
    return null;
  }
}

/** Partial status update that never resurrects a cleaned record. */
export async function patchGateway(sessionId: string, patch: Partial<UpsertGatewayInput>): Promise<void> {
  try {
    const supabase = await db();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) update["status"] = patch.status;
    if (patch.lastError !== undefined) update["last_error"] = patch.lastError;
    if (patch.cleanedUpAt !== undefined) update["cleaned_up_at"] = patch.cleanedUpAt;
    if (patch.tokenExpiresAt !== undefined) update["token_expires_at"] = patch.tokenExpiresAt;
    if (patch.metadata !== undefined) update["metadata"] = patch.metadata;
    await supabase.from("gateway_connections").update(update as never).eq("session_id", sessionId);
  } catch (error) {
    console.error("[gateway] patch failed", (error as Error)?.message);
  }
}

export async function getGateway(sessionId: string): Promise<GatewayRecord | null> {
  try {
    const supabase = await db();
    const { data } = await supabase.from("gateway_connections").select("*").eq("session_id", sessionId).maybeSingle();
    return data ? toRecord(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Cleanup is idempotent: marking an already-cleaned record is a no-op. */
export async function markGatewayCleaned(sessionId: string, detail?: string): Promise<void> {
  try {
    const supabase = await db();
    await supabase
      .from("gateway_connections")
      .update({
        status: "CLEANED",
        cleaned_up_at: new Date().toISOString(),
        last_error: detail ?? null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("session_id", sessionId)
      .is("cleaned_up_at", null);
  } catch (error) {
    console.error("[gateway] cleanup mark failed", (error as Error)?.message);
  }
}

/**
 * Gateway records that still hold resources: never cleaned, and either past
 * their tunnel expiry or attached to a session that is no longer live. The
 * reaper resolves the session check itself.
 */
export async function listUncleanedGateways(limit = 200): Promise<GatewayRecord[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("gateway_connections")
      .select("*")
      .is("cleaned_up_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    return (data ?? []).map((row) => toRecord(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

/** Rebuild the client-safe connection view from a durable record. */
export function recordToConnection(record: GatewayRecord, tunnelUrl: string | null): RemoteConnection {
  return {
    id: record.id,
    sessionId: record.sessionId,
    vmId: record.metadata.vmRef ?? "",
    kind: record.metadata.kind ?? "simulated",
    state: stateFor(record.status),
    protocol: "rdp",
    gateway: record.metadata.gateway ?? "gateway.skilltracklabs.com",
    tunnelUrl,
    machineName: record.metadata.machineName ?? "",
    latencyMs: record.metadata.latencyMs ?? 0,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    message: record.metadata.message ?? "",
    error: record.lastError,
    code: record.metadata.code ?? null,
    clipboard: record.metadata.clipboard ?? "readwrite",
  };
}
