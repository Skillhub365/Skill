/**
 * Redaction rules for everything an MCP tool returns.
 *
 * Agents get operational status only: never a gateway URL, connection token,
 * RDP credential, private IP, Azure resource id or service-principal detail.
 */

const SENSITIVE_KEY = /token|password|secret|credential|private_?ip|authorization|connection_?url|rdp|subscription|client_?id|tenant_secret/i;

export function scrub<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY.test(key)));
}

export interface SafeSession {
  sessionId: string;
  labId: string;
  labName: string;
  workspaceId: string;
  workspaceName: string;
  status: string;
  connectionStatus: string;
  startedAt: string;
  expiresAt: string;
  remainingMinutes: number;
  extendedMinutes: number;
  vmStatus: string | null;
  /** Opaque handle only — never the provider resource id. */
  machine: string;
  message: string;
}

interface Sessionish {
  id: string;
  labId: string;
  labName: string;
  workspaceId: string;
  workspaceName: string;
  status: string;
  connectionStatus: string;
  startTime: string;
  expiryTime: string;
  extendedMinutes: number;
  vmName: string;
  message?: string;
}

/** Machine names can carry customer naming; expose a short stable suffix. */
function machineHandle(vmName: string) {
  return vmName ? `vm-${vmName.slice(-6)}` : "vm-unknown";
}

export function safeSession(
  session: Sessionish,
  extra: { remainingMs?: number; vmStatus?: string | null } = {},
): SafeSession {
  const remainingMs = extra.remainingMs ?? Math.max(0, Date.parse(session.expiryTime) - Date.now());
  return {
    sessionId: session.id,
    labId: session.labId,
    labName: session.labName,
    workspaceId: session.workspaceId,
    workspaceName: session.workspaceName,
    status: session.status,
    connectionStatus: session.connectionStatus,
    startedAt: session.startTime,
    expiresAt: session.expiryTime,
    remainingMinutes: Math.round(remainingMs / 60_000),
    extendedMinutes: session.extendedMinutes,
    vmStatus: extra.vmStatus ?? null,
    machine: machineHandle(session.vmName),
    message: session.message ?? "",
  };
}
