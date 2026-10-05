import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw, Square, TimerReset } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/AppShell";
import { RealtimeStatusBadge } from "@/components/realtime/RealtimeStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCatalog } from "@/lib/store";
import { extendSession, fetchSession, stopSession } from "@/lib/session/client";
import {
  EXTENSION_STEP_MINUTES,
  SESSION_STATE_LABEL,
  formatTimer,
  isLive,
  timerTier,
  TIMER_TIER_CLASS,
  type SessionRecord,
} from "@/lib/session/types";

export const Route = createFileRoute("/admin/sessions")({
  head: () => ({
    meta: [
      { title: "Sessions — SkillTrack Labs Admin" },
      { name: "description", content: "Live lab sessions with server-enforced expiry, extensions and remote stop." },
      { property: "og:title", content: "Sessions — SkillTrack Labs Admin" },
      { property: "og:description", content: "Audit active, expired and stopped lab sessions." },
    ],
  }),
  component: SessionsPage,
});

function SessionsPage() {
  const { sessions, sessionAudit, syncSessionRecord, realtime } = useCatalog();
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const act = async (record: SessionRecord, action: "refresh" | "extend" | "stop") => {
    setBusyId(record.id);
    try {
      const snap =
        action === "extend"
          ? await extendSession(record, EXTENSION_STEP_MINUTES)
          : action === "stop"
            ? await stopSession(record)
            : await fetchSession(record);
      syncSessionRecord(snap.session);
      if (action === "extend") toast.success(`Extended ${record.id} by ${EXTENSION_STEP_MINUTES} min`);
      if (action === "stop") toast.success(`Session ${record.id} stopped and VM deallocated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Session action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Sessions"
        description="The platform owns session expiry: a closed browser never leaves a VM running."
        action={<RealtimeStatusBadge status={realtime.status} lastUpdatedAt={realtime.lastUpdatedAt} />}
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Lab</TableHead>
                <TableHead>User</TableHead>
                <TableHead>VM</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const record = s.record;
                const live = record ? isLive(record.status) : s.status === "active";
                const remaining = record && live ? Math.max(0, new Date(record.expiryTime).getTime() - now) : 0;
                const tier = timerTier(remaining);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">/session/{s.id}</TableCell>
                    <TableCell className="font-medium">{s.labTitle}</TableCell>
                    <TableCell className="text-muted-foreground">{s.user}</TableCell>
                    <TableCell className="text-muted-foreground">{s.vm}</TableCell>
                    <TableCell>
                      <Badge variant={live ? "default" : "secondary"}>
                        {record ? SESSION_STATE_LABEL[record.status] : s.status === "expired" ? "Expired" : "Stopped"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground capitalize">
                      {(record?.connectionStatus ?? "none").toLowerCase()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {record ? new Date(record.expiryTime).toLocaleTimeString() : "—"}
                    </TableCell>
                    <TableCell>
                      {record && live ? (
                        <span className={`rounded-md border px-2 py-0.5 font-mono text-xs tabular-nums ${TIMER_TIER_CLASS[tier]}`}>
                          {formatTimer(remaining)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {record ? (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" title="Refresh" onClick={() => void act(record, "refresh")}>
                            {busyId === record.id ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title={`Extend ${EXTENSION_STEP_MINUTES} min`}
                            disabled={!live || record.extendedMinutes >= record.maxExtensionMinutes}
                            onClick={() => void act(record, "extend")}
                          >
                            <TimerReset className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Stop session"
                            disabled={!live}
                            onClick={() => void act(record, "stop")}
                          >
                            <Square className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Archived</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-6">
          <p className="text-sm font-semibold">Session audit trail</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Every stop, extension and automatic expiry is recorded with the VM it reclaimed.
          </p>
          {sessionAudit.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No session events recorded yet.</p>
          ) : (
            <ul className="mt-4 space-y-2 text-xs">
              {sessionAudit.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-2 last:border-0">
                  <Badge variant="outline" className="font-mono">{e.action}</Badge>
                  <span className="font-medium">{e.actor}</span>
                  <span className="text-muted-foreground">{e.detail}</span>
                  <span className="ml-auto font-mono text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
