/** Client-safe remote desktop (Guacamole broker) types. */

export type ConnectionState = "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "ERROR";

/** Which renderer the browser should mount for this connection. */
export type ConnectionKind = "simulated" | "guacamole";

/** Clipboard policy the viewport advertises to the learner. */
export type ClipboardPolicy = "readwrite" | "readonly" | "disabled";

export interface RemoteConnection {
  id: string;
  sessionId: string;
  vmId: string;
  kind: ConnectionKind;
  state: ConnectionState;
  protocol: "rdp";
  /** Gateway host the browser talks to over HTTPS/WSS — never the VM itself. */
  gateway: string;
  /**
   * Signed, single-use tunnel URL. For the simulated broker this is a local
   * placeholder; with a real Guacamole deployment it is the embed URL that the
   * viewport renders in an iframe over WSS:443.
   */
  tunnelUrl: string | null;
  /** Display name of the machine, purely informational for the UI. */
  machineName: string;
  latencyMs: number;
  createdAt: string;
  expiresAt: string | null;
  message: string;
  error?: string | null;
  /** Stable failure code when state is ERROR (see gateway-errors). */
  code?: string | null;
  /** Clipboard support granted for this desktop. */
  clipboard?: ClipboardPolicy;
}

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  CONNECTING: "Connecting",
  CONNECTED: "Connected",
  DISCONNECTED: "Disconnected",
  ERROR: "Connection error",
};