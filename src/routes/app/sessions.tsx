import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Cpu } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { RealtimeStatusBadge } from "@/components/realtime/RealtimeStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/lib/store";
import { formatTimer } from "@/lib/session/types";
import type { LabSession } from "@/lib/mock-data";
import type { VmRecord } from "@/lib/vm/types";

export const Route = createFileRoute("/app/sessions")({
  head: () => ({
    meta: [
      { title: "My Sessions — SkillTrack Labs" },
      { name: "description", content: "Your active, completed and expired lab sessions with remaining time and live VM status." },
      { property: "og:title", content: "My Sessions — SkillTrack Labs" },
      { property: "og:description", content: "Resume a running lab session, watch the countdown and see machine status." },
    ],
  }),
  component: MySessions,
});

const VM_TONE: Record<string, string> = {
  READY: "bg-emerald-600 text-white hover:bg-emerald-600",
  RUNNING: "bg-emerald-600 text-white hover:bg-emerald-600",
  ERROR: "bg-destructive text-destructive-foreground hover:bg-destructive",
};

function MySessions() {
  const { user } = useAuth();
  const { sessions, vms, realtime } = useCatalog();
  const mine = sessions.filter((s) => s.user === user?.name);
  const active = mine.filter((s) => s.status === "active");
  const past = mine.filter((s) => s.status !== "active");

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Session links identify your lab, but you always sign in first. Time remaining and machine status update live."
        action={<RealtimeStatusBadge status={realtime.status} lastUpdatedAt={realtime.lastUpdatedAt} />}
      />
      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Active</h2>
          {active.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No active session. Start a lab from <Link to="/app/labs" className="underline">My Labs</Link>.
            </p>
          ) : null}
          {active.map((s) => (
            <ActiveSessionCard key={s.id} session={s} vm={vms.find((v) => v.id === s.vmId || v.sessionId === s.id) ?? null} />
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">History</h2>
          {past.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No past sessions yet.</p>
          ) : null}
          {past.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-semibold">{s.labTitle}</p>
                  <p className="text-xs text-muted-foreground">Started {s.startedAt} · VM {s.vm} · /session/{s.id}</p>
                </div>
                <Badge variant="secondary" className="capitalize">{s.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </>
  );
}

function ActiveSessionCard({ session, vm }: { session: LabSession; vm: VmRecord | null }) {
  const expiry = session.expiresAt ? new Date(session.expiresAt).getTime() : Date.now() + session.remainingMinutes * 60_000;
  const totalMs = Math.max(1, (session.record?.durationMinutes ?? session.remainingMinutes) * 60_000);
  const [remaining, setRemaining] = useState(() => Math.max(0, expiry - Date.now()));

  useEffect(() => {
    const id = window.setInterval(() => setRemaining(Math.max(0, expiry - Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [expiry]);

  const vmStatus = vm?.status ?? "UNKNOWN";
  const expired = remaining <= 0;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{session.labTitle}</p>
            <p className="text-xs text-muted-foreground">
              {session.workspace} · started {session.startedAt} · /session/{session.id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={VM_TONE[vmStatus] ?? ""} variant={VM_TONE[vmStatus] ? "default" : "secondary"}>
              <Cpu className="mr-1 size-3" /> VM {vmStatus}
            </Badge>
            <Badge variant={expired ? "destructive" : "default"}>{expired ? "Expiring" : "Active"}</Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm">
            <Clock className="size-4 text-muted-foreground" />
            <span className="font-mono tabular-nums">{formatTimer(remaining)}</span>
            <span className="text-xs text-muted-foreground">remaining</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Machine {session.vm}
            {vm?.region ? ` · ${vm.region}` : ""}
            {vm?.readiness?.detail ? ` · ${vm.readiness.detail}` : ""}
          </p>
          <Button asChild size="sm">
            <Link to="/session/$sessionId" params={{ sessionId: session.id }}>Open session</Link>
          </Button>
        </div>

        <Progress value={Math.min(100, (remaining / totalMs) * 100)} />
      </CardContent>
    </Card>
  );
}
