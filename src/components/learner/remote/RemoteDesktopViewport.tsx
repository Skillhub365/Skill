import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clipboard, ClipboardX, Loader2, Maximize2, Minimize2, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createConnection,
  getConnectionStatus,
  terminateConnection,
} from "@/lib/remote-desktop/client";
import type { RemoteConnection } from "@/lib/remote-desktop/types";
import { ApiError, friendlyFrom } from "@/lib/errors";
import { SimulatedWindowsDesktop } from "./SimulatedWindowsDesktop";

interface Props {
  sessionId: string;
  vmId: string;
  /** Caller identity re-checked by the gateway before any connection is issued. */
  userId: string;
  machineName: string;
  userName: string;
  durationMinutes?: number;
  /** False while the machine is not READY — no connection is attempted. */
  vmReady?: boolean;
  onStateChange?: (connection: RemoteConnection | null) => void;
}

/**
 * Browser-based remote desktop surface.
 *
 * In production it embeds the real Apache Guacamole client over HTTPS/WSS on
 * :443, which reaches the private Azure VM through guacd over RDP. In
 * development it falls back to the simulated Windows desktop. RDP, the VM's
 * address and any Azure credential never reach the learner's browser.
 */
export function RemoteDesktopViewport({
  sessionId,
  vmId,
  machineName,
  userId,
  userName,
  durationMinutes,
  vmReady = true,
  onStateChange,
}: Props) {
  const [connection, setConnection] = useState<RemoteConnection | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const notify = useRef(onStateChange);
  notify.current = onStateChange;

  const apply = useCallback((next: RemoteConnection | null) => {
    setConnection(next);
    notify.current?.(next);
  }, []);

  const failLocally = useCallback(
    (message: string, code?: string) => {
      apply({
        id: "local", sessionId, vmId, kind: "simulated", state: "ERROR", protocol: "rdp",
        gateway: "gateway.skilltracklabs.com", tunnelUrl: null, machineName, latencyMs: 0,
        createdAt: new Date().toISOString(), expiresAt: null,
        message,
        error: code ?? "CONNECTION_FAILED",
        code: code ?? "CONNECTION_FAILED",
      });
    },
    [apply, machineName, sessionId, vmId],
  );

  const connect = useCallback(async () => {
    setBusy(true);
    apply(null);
    try {
      const next = await createConnection(sessionId, {
        vmId,
        machineName,
        userId,
        ...(durationMinutes ? { durationMinutes } : {}),
      });
      apply(next);
    } catch (err) {
      failLocally(friendlyFrom(err).message, err instanceof ApiError ? err.code : undefined);
    } finally {
      setBusy(false);
    }
  }, [apply, failLocally, sessionId, vmId, machineName, userId, durationMinutes]);

  /**
   * On mount — including after a browser refresh — resume the existing gateway
   * connection if one is still valid instead of brokering a second desktop.
   * Nothing is attempted while the machine is not READY.
   */
  useEffect(() => {
    let cancelled = false;
    if (!vmReady) {
      apply(null);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const existing = await getConnectionStatus(sessionId, userId).catch(() => null);
      if (cancelled) return;
      if (existing && (existing.state === "CONNECTED" || existing.state === "CONNECTING")) {
        apply(existing);
        return;
      }
      await connect();
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, connect, sessionId, userId, vmReady]);

  // Track the gateway while a tunnel is negotiating or live, so a dropped RDP
  // session or a revoked connection is reflected immediately.
  useEffect(() => {
    const state = connection?.state;
    if (state !== "CONNECTING" && state !== "CONNECTED") return;
    const interval = state === "CONNECTING" ? 1000 : 5000;
    const id = window.setInterval(() => {
      void getConnectionStatus(sessionId, userId)
        .then((next) => next && apply(next))
        .catch(() => undefined);
    }, interval);
    return () => window.clearInterval(id);
  }, [connection?.state, sessionId, userId, apply]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      setFullscreen((v) => !v); // fall back to a CSS-only fullscreen overlay
    }
    // Guacamole resizes its display when the frame regains focus.
    window.setTimeout(() => frameRef.current?.contentWindow?.focus(), 250);
  };

  const disconnect = async () => {
    setBusy(true);
    const next = await terminateConnection(sessionId, userId).catch(() => null);
    apply(
      next ?? {
        ...(connection as RemoteConnection),
        state: "DISCONNECTED",
        tunnelUrl: null,
        message: "Remote desktop session closed.",
      },
    );
    setBusy(false);
  };

  const state = connection?.state ?? (vmReady ? "CONNECTING" : "DISCONNECTED");
  const clipboard = connection?.clipboard ?? "readwrite";
  const live = state === "CONNECTED";
  const guac = connection?.kind === "guacamole" && Boolean(connection.tunnelUrl);
  // A simulated desktop is a development convenience and is always labelled.
  const simulated = live && !guac;

  return (
    <div
      ref={shellRef}
      className={`relative overflow-hidden rounded-xl border border-border bg-[oklch(0.19_0.06_265)] shadow-[var(--shadow-elevated)] ${
        fullscreen ? "fixed inset-0 z-50 rounded-none" : "aspect-[16/10] w-full"
      }`}
    >
      <div className="absolute inset-0">
        {!vmReady ? (
          <Overlay
            icon={<Plug className="size-8 text-white/70" />}
            title="Machine is not running"
            detail="Your lab machine has stopped, so the remote desktop cannot be opened. Start the lab again for a fresh environment."
          />
        ) : (state === "CONNECTED" || state === "CONNECTING") && guac ? (
          /* Real Apache Guacamole client, served over HTTPS/WSS on :443. */
          <iframe
            ref={frameRef}
            title={`Remote desktop — ${machineName}`}
            src={connection?.tunnelUrl ?? ""}
            className="size-full border-0 bg-black"
            allow={
              clipboard === "disabled"
                ? "fullscreen"
                : clipboard === "readonly"
                  ? "clipboard-read; fullscreen"
                  : "clipboard-read; clipboard-write; fullscreen"
            }
            /* Keyboard and pointer input are handled inside the Guacamole client. */
            allowFullScreen
          />
        ) : state === "CONNECTED" ? (
          <SimulatedWindowsDesktop machineName={machineName} userName={userName} />
        ) : state === "ERROR" ? (
          <Overlay
            icon={<AlertTriangle className="size-8 text-destructive" />}
            title="Remote desktop connection failed"
            detail={
              connection?.code === "GATEWAY_NOT_CONFIGURED"
                ? "The secure remote desktop gateway is not available on this environment. Your administrator has been notified — no simulated desktop is served in its place."
                : (connection?.message ?? "The secure remote desktop gateway did not respond.")
            }
            action={
              <Button size="sm" disabled={busy} onClick={() => void connect()}>
                <RefreshCw className="size-4" /> Reconnect
              </Button>
            }
          />
        ) : state === "DISCONNECTED" ? (
          <Overlay
            icon={<Plug className="size-8 text-white/70" />}
            title="Disconnected"
            detail="Your remote desktop session was closed. The VM is still running until you stop the lab."
            action={
              <Button size="sm" disabled={busy} onClick={() => void connect()}>
                <Plug className="size-4" /> Reconnect
              </Button>
            }
          />
        ) : (
          <Overlay
            icon={<Loader2 className="size-8 animate-spin text-white/80" />}
            title="Connecting to the remote desktop"
            detail={
              connection?.message ??
              "Connecting through the secure remote desktop gateway over HTTPS/WSS — your machine is never exposed to the internet."
            }
          />
        )}
      </div>

      {/* Viewport toolbar */}
      <div className="pointer-events-none absolute right-3 top-3 z-50 flex items-center gap-2">
        {live && (
          <span className="pointer-events-auto hidden items-center gap-1.5 rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white/85 backdrop-blur sm:flex">
            {clipboard === "disabled" ? <ClipboardX className="size-3.5" /> : <Clipboard className="size-3.5" />}
            {clipboard === "disabled"
              ? "Clipboard disabled"
              : clipboard === "readonly"
                ? "Copy only"
                : "Clipboard enabled"}
          </span>
        )}
        {live && (
          <span className="pointer-events-auto hidden items-center gap-1.5 rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white/85 backdrop-blur md:flex">
            <ShieldCheck className="size-3.5" /> Secure gateway · HTTPS/WSS · {connection?.gateway}
          </span>
        )}
        {simulated && (
          <span className="pointer-events-auto flex items-center gap-1.5 rounded-md bg-warning px-2 py-1 text-[11px] font-semibold text-warning-foreground backdrop-blur">
            <AlertTriangle className="size-3.5" /> Development desktop — not a real machine
          </span>
        )}
        {(live || state === "CONNECTING") && vmReady && (
          <Button
            size="sm"
            variant="secondary"
            className="pointer-events-auto h-8"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            <Plug className="size-3.5" /> Disconnect
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="pointer-events-auto h-8"
          onClick={() => void toggleFullscreen()}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}
        </Button>
      </div>
    </div>
  );
}

function Overlay({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
      {icon}
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="max-w-md text-xs text-white/70">{detail}</p>
      {action}
    </div>
  );
}
