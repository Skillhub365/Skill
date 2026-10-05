import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock, MonitorPlay, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Brand } from "@/components/layout/Brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LoginForm } from "@/routes/login";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/lib/store";
import { VmLaunchPanel } from "@/components/learner/VmLaunchPanel";
import { RemoteDesktopViewport } from "@/components/learner/remote/RemoteDesktopViewport";
import { SessionEndedScreen } from "@/components/learner/session/SessionEndedScreen";
import { SessionTimer } from "@/components/learner/session/SessionTimer";
import { StopLabDialog } from "@/components/learner/session/StopLabDialog";
import { CONNECTION_LABEL, type RemoteConnection } from "@/lib/remote-desktop/types";
import { getConnectionStatus } from "@/lib/remote-desktop/client";
import { useSessionLifecycle } from "@/lib/session/useSessionLifecycle";
import {
  DEFAULT_MAX_EXTENSION_MINUTES,
  EXTENSION_STEP_MINUTES,
  SESSION_STATE_LABEL,
  formatTimer,
  type SessionRecord,
} from "@/lib/session/types";
import type { LabSession } from "@/lib/mock-data";
import type { VmRecord } from "@/lib/vm/types";

export const Route = createFileRoute("/session/$sessionId")({
  head: () => ({
    meta: [
      { title: "Lab session — SkillTrack Labs" },
      { name: "description", content: "Session links identify a lab session but never grant access; sign in to continue." },
      { property: "og:title", content: "Lab session — SkillTrack Labs" },
      { property: "og:description", content: "Authenticate to open your cloud lab session." },
    ],
  }),
  component: SessionEntry,
});

function SessionEntry() {
  const { sessionId } = Route.useParams();
  const { user, ready } = useAuth();
  const { sessions, vms } = useCatalog();
  const session = sessions.find((s) => s.id === sessionId);
  const vm = vms.find((v) => v.id === session?.vmId || v.sessionId === sessionId);

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6" style={{ backgroundImage: "var(--gradient-surface)" }}>
        <Card className="w-full max-w-md shadow-[var(--shadow-elevated)]">
          <CardContent className="p-8">
            <Brand subtitle="Session access" />
            <p className="mt-6 flex items-center gap-2 text-sm font-semibold">
              <Lock className="size-4 text-primary" /> Authentication required
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              This link identifies session {sessionId}. It does not grant access on its own.
            </p>
            <LoginForm workspaceName={session?.workspace} redirectTo={`/session/${sessionId}`} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold">Session not found</h1>
        <p className="text-sm text-muted-foreground">Session {sessionId} does not exist or has been removed.</p>
        <Button asChild variant="outline"><Link to="/app">Back to home</Link></Button>
      </div>
    );
  }

  const authorized = user.role === "admin" || session.userId === user.id || session.user === user.name;
  if (!authorized) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold">You don't have access to this session</h1>
        <p className="text-sm text-muted-foreground">Signed in as {user.email}.</p>
        <Button asChild variant="outline"><Link to="/app">Go to my labs</Link></Button>
      </div>
    );
  }

  return <SessionWorkspace key={session.id} entry={session} vm={vm ?? null} userName={user.name} userId={user.id} />;
}

/** Historic sessions predate the server registry — project a record for them. */
function toRecord(entry: LabSession, vm: VmRecord | null): SessionRecord {
  if (entry.record) return entry.record;
  const started = Date.now() - 5 * 60_000;
  const ended = entry.status === "active" ? null : new Date().toISOString();
  return {
    id: entry.id,
    userId: entry.userId ?? "unknown",
    userName: entry.user,
    workspaceId: vm?.workspaceId ?? "",
    workspaceName: entry.workspace,
    workspaceSlug: "",
    labId: entry.labId ?? vm?.labId ?? "",
    labName: entry.labTitle,
    vmId: entry.vmId ?? vm?.id ?? "",
    vmName: entry.vm,
    provider: vm?.provider ?? "Azure",
    createdAt: new Date(started).toISOString(),
    startTime: new Date(started).toISOString(),
    expiryTime: entry.expiresAt ?? new Date(Date.now() + entry.remainingMinutes * 60_000).toISOString(),
    endedAt: ended,
    durationMinutes: Math.max(entry.remainingMinutes, 60),
    extendedMinutes: 0,
    maxExtensionMinutes: DEFAULT_MAX_EXTENSION_MINUTES,
    status: entry.status === "active" ? "STARTING" : entry.status === "expired" ? "EXPIRED" : "STOPPED",
    connectionStatus: "NONE",
    endReason: entry.status === "expired" ? "expired" : entry.status === "completed" ? "user_stopped" : null,
    lastSeenAt: new Date().toISOString(),
    message: "",
  };
}

function SessionWorkspace({
  entry,
  vm: initialVm,
  userName,
  userId,
}: {
  entry: LabSession;
  vm: VmRecord | null;
  userName: string;
  userId: string;
}) {
  const { syncSessionRecord, logSessionEvent, workspaces } = useCatalog();
  const [vm, setVm] = useState<VmRecord | null>(initialVm);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<RemoteConnection | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const baseRecord = useMemo(() => toRecord(entry, initialVm), [entry, initialVm]);

  // Browser refresh: if the gateway still holds a live connection for this
  // session, drop the learner straight back into the desktop.
  useEffect(() => {
    let cancelled = false;
    void getConnectionStatus(entry.id, userId)
      .then((existing) => {
        if (cancelled || !existing) return;
        if (existing.state === "CONNECTED" || existing.state === "CONNECTING") {
          setConnection(existing);
          setConnected(true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry.id, userId]);

  const syncRef = useRef(syncSessionRecord);
  syncRef.current = syncSessionRecord;

  // Auto-connect: as soon as the machine reports READY, move the learner into
  // the remote desktop without an extra click.
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (autoConnectedRef.current || connected) return;
    if (vm?.status !== "READY") return;
    autoConnectedRef.current = true;
    setConnected(true);
    toast.success("Machine ready", { description: "Connecting you to the remote desktop…" });
  }, [vm?.status, connected]);

  const logRef = useRef(logSessionEvent);
  logRef.current = logSessionEvent;

  const onSync = useCallback((record: SessionRecord) => {
    syncRef.current(record);
  }, []);

  const { session, remainingMs, tier, extendable, busy, extend, stop, live } = useSessionLifecycle(
    baseRecord,
    {
      ...(connection?.state ? { connectionStatus: connection.state } : {}),
      ...(vm?.status ? { vmStatus: vm.status } : {}),
    },
    onSync,
  );

  // Audit + UX for server-driven endings (expiry, reclaim, VM failure).
  const endedRef = useRef(false);
  useEffect(() => {
    if (live || endedRef.current) return;
    endedRef.current = true;
    setConnected(false);
    setVm((current) => (current ? { ...current, status: "STOPPED", readiness: { checked: false, ready: false, detail: "Deallocated" } } : current));
    logRef.current(session.id, "System", `session.${session.status.toLowerCase()}`, session.message);
    if (session.status === "EXPIRED") {
      toast.error("Session expired", { description: "The remote connection closed and the VM was deallocated." });
    }
  }, [live, session]);

  const workspaceSlug =
    session.workspaceSlug || workspaces.find((w) => w.name === session.workspaceName)?.slug || "";
  const totalMs = (session.durationMinutes + session.extendedMinutes) * 60_000;

  const handleExtend = async () => {
    try {
      const snap = await extend(EXTENSION_STEP_MINUTES);
      logSessionEvent(session.id, userName, "session.extended", `Extended by ${EXTENSION_STEP_MINUTES} minutes.`);
      toast.success(`Session extended by ${EXTENSION_STEP_MINUTES} minutes`, {
        description: `New expiry ${new Date(snap.session.expiryTime).toLocaleTimeString()}.`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not extend the session");
    }
  };

  const handleStop = async () => {
    try {
      await stop();
      endedRef.current = true;
      setConnected(false);
      setVm((current) => (current ? { ...current, status: "STOPPED", readiness: { checked: false, ready: false, detail: "Deallocated" } } : current));
      logSessionEvent(session.id, userName, "session.stopped", "Learner stopped the lab.");
      toast.success("Lab stopped", { description: "The remote desktop was disconnected and the VM deallocated." });
    } catch {
      toast.error("Could not stop the session");
    } finally {
      setConfirmStop(false);
    }
  };

  const connState = connection?.state ?? "CONNECTING";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-8">
        <div className="flex items-center gap-4">
          <Brand subtitle="Lab session" />
          <div className="hidden border-l border-border pl-4 text-xs leading-tight md:block">
            <p className="font-semibold">{session.labName}</p>
            <p className="text-muted-foreground">{session.workspaceName}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={session.status === "ACTIVE" ? "default" : "secondary"}>
            {SESSION_STATE_LABEL[session.status]}
          </Badge>
          <Badge variant={live && vm?.status === "READY" ? "default" : "secondary"}>
            VM {live ? (vm?.status ?? "—") : "STOPPED"}
          </Badge>
          {connected && (
            <Badge
              variant={connState === "CONNECTED" ? "default" : connState === "ERROR" ? "destructive" : "secondary"}
              className="gap-1"
            >
              <Wifi className="size-3" /> {CONNECTION_LABEL[connState]}
            </Badge>
          )}
          {live ? (
            <SessionTimer
              remainingMs={remainingMs}
              tier={tier}
              extendable={extendable}
              busy={busy}
              onExtend={() => void handleExtend()}
              onStop={() => setConfirmStop(true)}
              compact
            />
          ) : null}
          <Button asChild variant="outline" size="sm"><Link to="/app">Exit</Link></Button>
        </div>
      </header>

      {!live ? (
        <SessionEndedScreen session={session} workspaceSlug={workspaceSlug} />
      ) : connected && vm ? (
        <main className="flex-1 px-4 py-4 md:px-8">
          <RemoteDesktopViewport
            sessionId={session.id}
            vmId={vm.id}
            userId={userId}
            machineName={vm.name}
            userName={userName}
            vmReady={vm.status === "READY" || vm.status === "RUNNING"}
            durationMinutes={Math.max(1, Math.round(remainingMs / 60_000))}
            onStateChange={setConnection}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Streamed over HTTPS/WSS via the remote desktop gateway ({connection?.gateway ?? "gateway.skilltracklabs.com"}).
            Session expiry is enforced by the platform, not by this browser tab.
          </p>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-5xl px-4 py-10 md:px-8">
          <h1 className="text-2xl font-bold tracking-tight">{session.labName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {session.workspaceName} · VM {session.vmName} · session {session.id}
          </p>

          <Card className="mt-6">
            <CardContent className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Allotted time</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(session.expiryTime).toLocaleTimeString()} · extension used{" "}
                    {session.extendedMinutes}/{session.maxExtensionMinutes} min
                  </p>
                </div>
                <p className="font-mono text-sm tabular-nums">{formatTimer(remainingMs)} remaining</p>
              </div>
              <Progress className="mt-3" value={Math.min(100, (remainingMs / totalMs) * 100)} />
              <div className="mt-4">
                <SessionTimer
                  remainingMs={remainingMs}
                  tier={tier}
                  extendable={extendable}
                  busy={busy}
                  onExtend={() => void handleExtend()}
                  onStop={() => setConfirmStop(true)}
                />
              </div>
            </CardContent>
          </Card>

          {vm ? (
            <VmLaunchPanel vm={vm} sessionId={session.id} onVmChange={setVm} onConnect={() => setConnected(true)} onStopRequest={() => setConfirmStop(true)} />
          ) : (
            <Card className="mt-6 border-dashed">
              <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
                <MonitorPlay className="size-8 text-muted-foreground" />
                <p className="text-sm font-semibold">No machine attached to this session</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  This is a historical session record. Start the lab again from your workspace to have the orchestrator
                  provision a fresh VM.
                </p>
              </CardContent>
            </Card>
          )}
        </main>
      )}

      <StopLabDialog open={confirmStop} onOpenChange={setConfirmStop} onConfirm={() => void handleStop()} busy={busy} />
    </div>
  );
}
