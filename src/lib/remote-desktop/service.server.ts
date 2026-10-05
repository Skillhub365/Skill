import type { ConnectionState, RemoteConnection } from "./types";
import { assertLiveInfrastructure, infraModes, guacamoleConfig, type GuacamoleConfig } from "@/lib/infra/runtime.server";
import { gatewayFailure, normalizeGatewayError } from "./gateway-errors";

export interface CreateConnectionInput {
  sessionId: string;
  vmId: string;
  machineName: string;
  /** Private address of the lab VM. Never returned to the browser. */
  privateIp?: string | undefined;
  durationMinutes?: number | undefined;
}

/**
 * Remote desktop abstraction. Implementations broker an RDP session behind the
 * platform gateway; the learner's browser only ever speaks HTTPS/WSS on :443.
 */
export interface RemoteDesktopService {
  readonly kind: "simulated" | "guacamole";
  createConnection(input: CreateConnectionInput): Promise<RemoteConnection>;
  getConnectionStatus(sessionId: string): Promise<RemoteConnection | null>;
  terminateConnection(sessionId: string): Promise<RemoteConnection | null>;
}

/** Wall-clock handshake so a rehydrated worker still reports a sane state. */
const HANDSHAKE_MS = 2200;

interface Entry extends RemoteConnection {
  handshakeAt: number;
  terminated: boolean;
}

function project(e: Entry): RemoteConnection {
  const { handshakeAt, terminated, ...rest } = e;
  let state: ConnectionState = rest.state;
  let message = rest.message;
  if (terminated) {
    state = "DISCONNECTED";
    message = "Remote desktop session closed.";
  } else if (state !== "ERROR") {
    if (Date.now() >= handshakeAt) {
      state = "CONNECTED";
      message = "RDP tunnel established through the remote desktop gateway.";
    } else {
      state = "CONNECTING";
      message = "Negotiating RDP tunnel through the remote desktop gateway…";
    }
  }
  return { ...rest, state, message };
}

/**
 * Development broker. Produces a real connection lifecycle without any RDP
 * traffic; the browser renders a simulated Windows desktop instead of a
 * Guacamole canvas.
 */
export class SimulatedRemoteDesktopService implements RemoteDesktopService {
  readonly kind = "simulated" as const;
  private store = new Map<string, Entry>();

  async createConnection(input: CreateConnectionInput): Promise<RemoteConnection> {
    const now = Date.now();
    const entry: Entry = {
      id: `rdc-${Math.random().toString(16).slice(2, 8)}`,
      sessionId: input.sessionId,
      vmId: input.vmId,
      kind: "simulated",
      state: "CONNECTING",
      protocol: "rdp",
      gateway: "gateway.skilltracklabs.com",
      tunnelUrl: null,
      machineName: input.machineName,
      latencyMs: 24 + Math.floor(Math.random() * 20),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (input.durationMinutes ?? 90) * 60_000).toISOString(),
      message: "Negotiating RDP tunnel through the remote desktop gateway…",
      error: null,
      code: null,
      clipboard: "readwrite",
      handshakeAt: now + HANDSHAKE_MS,
      terminated: false,
    };
    this.store.set(input.sessionId, entry);
    return project(entry);
  }

  async getConnectionStatus(sessionId: string): Promise<RemoteConnection | null> {
    const entry = this.store.get(sessionId);
    return entry ? project(entry) : null;
  }

  async terminateConnection(sessionId: string): Promise<RemoteConnection | null> {
    const entry = this.store.get(sessionId);
    if (!entry) return null;
    entry.terminated = true;
    return project(entry);
  }
}

/**
 * Production broker: Apache Guacamole.
 *
 * Browser --HTTPS/WSS:443--> Guacamole web app --> guacd --RDP:3389--> private Azure VM
 *
 * For every SkillTrack session the broker creates:
 *   1. a dedicated RDP connection pointing at the VM's PRIVATE address, and
 *   2. an ephemeral Guacamole user that can read ONLY that connection.
 *
 * The browser is handed a token minted for that ephemeral user, so swapping a
 * VM or connection identifier in the URL grants nothing: the token simply has
 * no permission on any other connection. RDP credentials, the VM's private IP
 * and the Guacamole administrator password never leave the server.
 */
export class GuacamoleRemoteDesktopService implements RemoteDesktopService {
  readonly kind = "guacamole" as const;
  private connections = new Map<string, Broker>();
  private auth: { token: string; dataSource: string; expiresAtMs: number } | null = null;

  constructor(private cfg: GuacamoleConfig) {}

  private async request(path: string, init: RequestInit & { form?: URLSearchParams } = {}) {
    try {
      return await fetch(`${this.cfg.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
      });
    } catch (error) {
      throw normalizeGatewayError(error);
    }
  }

  /** Guacamole admin token; short-lived and cached only in server memory. */
  private async token(): Promise<{ token: string; dataSource: string }> {
    if (this.auth && this.auth.expiresAtMs > Date.now()) return this.auth;
    const res = await this.request("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: this.cfg.username, password: this.cfg.password }),
    });
    if (res.status === 403 || res.status === 401) {
      console.error(`Guacamole admin authentication rejected [${res.status}]`);
      throw gatewayFailure("GATEWAY_AUTH_FAILED");
    }
    if (!res.ok) {
      console.error(`Guacamole auth failed [${res.status}]: ${await res.text()}`);
      throw gatewayFailure("GATEWAY_UNAVAILABLE", `status ${res.status}`);
    }
    const json = (await res.json()) as { authToken: string; dataSource?: string };
    this.auth = {
      token: json.authToken,
      dataSource: json.dataSource ?? this.cfg.dataSource,
      expiresAtMs: Date.now() + 25 * 60_000,
    };
    return this.auth;
  }

  /** Authenticated call against the admin data source. */
  private async api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
    const { token, dataSource } = await this.token();
    const res = await this.request(
      `/api/session/data/${dataSource}${path}?token=${encodeURIComponent(token)}`,
      {
        method: init.method ?? "GET",
        headers: init.body ? { "Content-Type": "application/json" } : {},
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      },
    );
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      this.auth = null;
      throw gatewayFailure("GATEWAY_AUTH_FAILED", `status ${res.status}`);
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw gatewayFailure("GUACD_UNAVAILABLE", `status ${res.status}`);
    }
    if (!res.ok) {
      const detail = await res.text();
      console.error(`Guacamole ${init.method ?? "GET"} ${path} failed [${res.status}]: ${detail}`);
      throw gatewayFailure("GATEWAY_REQUEST_FAILED", `status ${res.status}`);
    }
    if (res.status === 204) return null;
    return (await res.json()) as T;
  }

  /** RDP parameters for a single lab machine, resolved entirely server-side. */
  private rdpParameters(privateIp: string) {
    const clipboard = this.cfg.clipboard;
    return {
      hostname: privateIp,
      port: "3389",
      username: this.cfg.rdpUsername ?? "",
      password: this.cfg.rdpPassword ?? "",
      ...(this.cfg.rdpDomain ? { domain: this.cfg.rdpDomain } : {}),
      security: this.cfg.rdpSecurity,
      "ignore-cert": this.cfg.ignoreCert ? "true" : "false",
      "resize-method": "display-update",
      "enable-wallpaper": "true",
      "enable-font-smoothing": "true",
      // Clipboard policy. Drive redirection and printing stay off so nothing
      // can be moved off the lab machine through the gateway.
      "disable-copy": clipboard === "disabled" ? "true" : "false",
      "disable-paste": clipboard === "readwrite" ? "false" : "true",
      "enable-drive": "false",
      "enable-printing": "false",
      "enable-audio-input": "false",
      timezone: "UTC",
    };
  }

  /**
   * Ephemeral, connection-scoped Guacamole account. It is created per session
   * and deleted on teardown, and is the reason a learner cannot reach another
   * learner's desktop by editing the browser URL.
   */
  private async createSessionUser(sessionId: string, connectionId: string) {
    const username = `stl-${sessionId}`.slice(0, 64);
    const password = randomSecret();
    await this.api(`/users/${encodeURIComponent(username)}`, { method: "DELETE" }).catch(() => null);
    await this.api("/users", {
      method: "POST",
      body: { username, password, attributes: { disabled: "", expired: "", "access-window-start": "" } },
    });
    await this.api(`/users/${encodeURIComponent(username)}/permissions`, {
      method: "PATCH",
      body: [{ op: "add", path: `/connectionPermissions/${connectionId}`, value: "READ" }],
    });
    const res = await this.request("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }),
    });
    if (!res.ok) throw gatewayFailure("UNAUTHORIZED_CONNECTION", `session token status ${res.status}`);
    const json = (await res.json()) as { authToken: string; dataSource?: string };
    return { username, token: json.authToken, dataSource: json.dataSource ?? this.cfg.dataSource };
  }

  async createConnection(input: CreateConnectionInput): Promise<RemoteConnection> {
    if (!input.privateIp) throw gatewayFailure("VM_ENDPOINT_UNAVAILABLE");
    // A stale connection for the same session must never linger on the gateway.
    await this.terminateConnection(input.sessionId).catch(() => null);

    const now = Date.now();
    const created = await this.api<{ identifier: string }>("/connections", {
      method: "POST",
      body: {
        parentIdentifier: "ROOT",
        name: `skilltrack-${input.sessionId}-${now.toString(36)}`,
        protocol: "rdp",
        parameters: this.rdpParameters(input.privateIp),
        attributes: { "max-connections": "1", "max-connections-per-user": "1" },
      },
    });
    if (!created?.identifier) throw gatewayFailure("GATEWAY_REQUEST_FAILED", "no connection identifier returned");

    const user = await this.createSessionUser(input.sessionId, created.identifier);
    // Guacamole client URLs are base64 of "<id>\0c\0<dataSource>".
    const clientId = btoa(`${created.identifier}\u0000c\u0000${user.dataSource}`);
    const broker: Broker = {
      id: `guac-${created.identifier}`,
      identifier: created.identifier,
      guacUsername: user.username,
      connectDeadline: now + this.cfg.connectTimeoutMs,
      sessionId: input.sessionId,
      vmId: input.vmId,
      kind: "guacamole",
      state: "CONNECTING",
      protocol: "rdp",
      gateway: new URL(this.cfg.publicBaseUrl).host,
      // Served over HTTPS/WSS on :443 by the gateway's TLS terminator.
      tunnelUrl: `${this.cfg.publicBaseUrl}/#/client/${clientId}?token=${encodeURIComponent(user.token)}`,
      machineName: input.machineName,
      latencyMs: 0,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (input.durationMinutes ?? 90) * 60_000).toISOString(),
      message: "Opening the remote desktop tunnel…",
      error: null,
      code: null,
      clipboard: this.cfg.clipboard,
    };
    this.connections.set(input.sessionId, broker);
    return strip(broker);
  }

  async getConnectionStatus(sessionId: string): Promise<RemoteConnection | null> {
    const existing = this.connections.get(sessionId);
    if (!existing) return null;
    if (existing.state === "DISCONNECTED" || existing.state === "ERROR") return strip(existing);

    let record: { activeConnections?: number } | null = null;
    try {
      record = await this.api<{ activeConnections?: number }>(`/connections/${existing.identifier}`);
    } catch (error) {
      const failure = normalizeGatewayError(error);
      return strip(this.fail(existing, failure.code, failure.friendly));
    }
    if (!record) {
      // The connection no longer exists on the gateway: access was revoked.
      return strip(this.close(existing, "The remote desktop connection was closed by the platform."));
    }
    const active = (record.activeConnections ?? 0) > 0;
    if (active) {
      const connected: Broker = {
        ...existing,
        state: "CONNECTED",
        message: "RDP tunnel established through the remote desktop gateway.",
        code: null,
      };
      this.connections.set(sessionId, connected);
      return strip(connected);
    }
    if (existing.state === "CONNECTED") {
      // Was up and is now gone — the RDP session dropped.
      return strip(this.close(existing, "The remote desktop session ended."));
    }
    if (Date.now() > existing.connectDeadline) {
      return strip(
        this.fail(
          existing,
          "CONNECTION_TIMEOUT",
          "The machine did not accept a remote desktop connection in time. Reconnect to try again.",
        ),
      );
    }
    return strip(existing);
  }

  /**
   * Revokes access immediately: any live tunnel is killed, the connection and
   * the session's ephemeral gateway account are deleted.
   */
  async terminateConnection(sessionId: string): Promise<RemoteConnection | null> {
    const existing = this.connections.get(sessionId);
    if (!existing) return null;
    await this.killActiveTunnels(existing.identifier);
    await this.api(`/connections/${existing.identifier}`, { method: "DELETE" }).catch(() => null);
    await this.api(`/users/${encodeURIComponent(existing.guacUsername)}`, { method: "DELETE" }).catch(() => null);
    this.connections.delete(sessionId);
    return strip({
      ...existing,
      state: "DISCONNECTED",
      tunnelUrl: null,
      message: "Remote desktop session closed.",
    });
  }

  /** Kill any tunnel currently running against this connection. */
  private async killActiveTunnels(identifier: string) {
    try {
      const active = await this.api<Record<string, { connectionIdentifier?: string }>>("/activeConnections");
      const ids = Object.entries(active ?? {})
        .filter(([, value]) => value.connectionIdentifier === identifier)
        .map(([id]) => id);
      if (!ids.length) return;
      await this.api("/activeConnections", {
        method: "PATCH",
        body: ids.map((id) => ({ op: "remove", path: `/${id}` })),
      });
    } catch {
      /* nothing to kill, or the gateway already released it */
    }
  }

  private fail(existing: Broker, code: string, message: string): Broker {
    const failed: Broker = { ...existing, state: "ERROR", code, error: code, message, tunnelUrl: null };
    this.connections.set(existing.sessionId, failed);
    return failed;
  }

  private close(existing: Broker, message: string): Broker {
    const closed: Broker = { ...existing, state: "DISCONNECTED", message, tunnelUrl: null };
    this.connections.set(existing.sessionId, closed);
    return closed;
  }

  /** Protocols the gateway can broker. Used by the admin health console. */
  async supportedProtocols(): Promise<string[]> {
    const schema = await this.api<Record<string, unknown>>("/schema/protocols");
    return Object.keys(schema ?? {});
  }

  /**
   * End-to-end validation of the brokering path for one machine, with no
   * learner session in play: create a real RDP connection object, mint an
   * ephemeral account scoped to it, then remove both. Nothing sensitive is
   * returned — only whether each stage worked and whether cleanup succeeded.
   */
  async selfTest(input: { privateIp: string; label: string }): Promise<{
    brokered: boolean;
    tokenIssued: boolean;
    cleanedUp: boolean;
    code: string | null;
    detail: string;
  }> {
    let identifier: string | null = null;
    let username: string | null = null;
    let brokered = false;
    let tokenIssued = false;
    let code: string | null = null;
    let detail = "A test desktop connection was brokered and removed successfully.";
    try {
      const created = await this.api<{ identifier: string }>("/connections", {
        method: "POST",
        body: {
          parentIdentifier: "ROOT",
          name: `skilltrack-test-${input.label}-${Date.now().toString(36)}`,
          protocol: "rdp",
          parameters: this.rdpParameters(input.privateIp),
          attributes: { "max-connections": "1", "max-connections-per-user": "1" },
        },
      });
      identifier = created?.identifier ?? null;
      brokered = Boolean(identifier);
      if (!identifier) throw gatewayFailure("GATEWAY_REQUEST_FAILED", "no connection identifier returned");

      username = `stl-test-${Math.random().toString(16).slice(2, 10)}`;
      const password = randomSecret();
      await this.api("/users", { method: "POST", body: { username, password, attributes: {} } });
      await this.api(`/users/${encodeURIComponent(username)}/permissions`, {
        method: "PATCH",
        body: [{ op: "add", path: `/connectionPermissions/${identifier}`, value: "READ" }],
      });
      const res = await this.request("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, password }),
      });
      tokenIssued = res.ok;
      if (!res.ok) {
        code = "UNAUTHORIZED_CONNECTION";
        detail = "The gateway would not issue a session token for a scoped test account.";
      }
    } catch (error) {
      const failure = normalizeGatewayError(error);
      code = failure.code;
      detail = failure.friendly;
    }

    // Cleanup is mandatory: a leftover test object would be a standing grant.
    let cleanedUp = true;
    if (identifier) {
      await this.killActiveTunnels(identifier);
      const removed = await this.api(`/connections/${identifier}`, { method: "DELETE" })
        .then(() => true)
        .catch(() => false);
      if (!removed) cleanedUp = false;
    }
    if (username) {
      const removed = await this.api(`/users/${encodeURIComponent(username)}`, { method: "DELETE" })
        .then(() => true)
        .catch(() => false);
      if (!removed) cleanedUp = false;
    }
    if (!cleanedUp) {
      detail = `${detail} A test object could not be removed from the gateway — check the gateway runbook.`;
    }
    return { brokered, tokenIssued, cleanedUp, code, detail };
  }
}

interface Broker extends RemoteConnection {
  identifier: string;
  guacUsername: string;
  connectDeadline: number;
}

/** Server-only bookkeeping must not travel to the browser. */
function strip(broker: Broker): RemoteConnection {
  const { identifier, guacUsername, connectDeadline, ...rest } = broker;
  void identifier;
  void guacUsername;
  void connectDeadline;
  return rest;
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let service: RemoteDesktopService | null = null;

/**
 * Returns the broker selected by the deployment environment: real Guacamole in
 * staging/production once configured, the simulated desktop in development.
 */
export function remoteDesktop(): RemoteDesktopService {
  if (!service) {
    // Staging and production refuse to hand a learner a simulated desktop when
    // the real gateway is simply missing from the configuration.
    try {
      assertLiveInfrastructure("remote-desktop");
    } catch {
      // Fail visibly with learner-safe copy instead of silently simulating.
      throw gatewayFailure("GATEWAY_NOT_CONFIGURED", "remote desktop gateway missing in a live environment");
    }
    const modes = infraModes();
    const cfg = guacamoleConfig();
    service = modes.remoteDesktop === "guacamole" && cfg
      ? new GuacamoleRemoteDesktopService(cfg)
      : new SimulatedRemoteDesktopService();
  }
  return service;
}

/**
 * Liveness probe used by the admin infrastructure console: confirms the
 * Guacamole web application answers and that credentials are accepted.
 */
export async function gatewayHealth(): Promise<{ configured: boolean; reachable: boolean; detail: string }> {
  const cfg = guacamoleConfig();
  if (!cfg) return { configured: false, reachable: false, detail: "Gateway not configured for this environment." };
  try {
    const res = await fetch(`${cfg.baseUrl}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: cfg.username, password: cfg.password }),
      signal: AbortSignal.timeout(cfg.requestTimeoutMs),
    });
    if (res.ok) return { configured: true, reachable: true, detail: "Gateway reachable and credentials accepted." };
    return { configured: true, reachable: false, detail: `Gateway rejected the platform credentials (${res.status}).` };
  } catch (error) {
    return { configured: true, reachable: false, detail: normalizeGatewayError(error).friendly };
  }
}
