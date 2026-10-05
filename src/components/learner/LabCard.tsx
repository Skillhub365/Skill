import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarRange, Clock, Loader2, MonitorPlay, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/lib/store";
import { startLab } from "@/lib/vm/client";
import type { Lab } from "@/lib/mock-data";
import { evaluateAccess, formatDate, formatHours, usedPercent } from "@/lib/labs/persistence";

export function LabCard({ lab }: { lab: Lab }) {
  const { user } = useAuth();
  const { labAssignments, workspaces, templates, workspaceUsers, registerSession, sessions } = useCatalog();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const assignment = labAssignments.find((a) => a.userId === user?.id && a.labId === lab.id);
  const status = assignment?.status ?? "assigned";
  const persistent = lab.labMode === "persistent";
  const access = assignment?.access;
  // Same rules the server enforces, so the card explains exactly why a launch
  // is unavailable instead of failing after the click.
  const evaluation = persistent && access ? evaluateAccess(access, { status }) : null;
  const blocked = Boolean(evaluation && !evaluation.allowed);
  const resuming = Boolean(persistent && access?.persistentVmId);
  const activeSession = sessions.find(
    (s) => s.status === "active" && s.labId === lab.id && (s.userId === user?.id || s.user === user?.name),
  );

  const launch = async () => {
    if (!user) return;
    const workspace = workspaces.find((w) => w.id === lab.workspaceId);
    const template = templates.find((t) => t.id === lab.templateId) ?? templates[0];
    if (!workspace || !template) {
      toast.error("This lab has no workspace template configured");
      return;
    }
    setStarting(true);
    try {
      const { sessionId, session, vm } = await startLab({ labId: lab.id });
      registerSession(
        {
          id: sessionId,
          labTitle: lab.title,
          workspace: workspace.name,
          user: user.name,
          userId: user.id,
          labId: lab.id,
          status: "active",
          startedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          remainingMinutes: lab.durationMinutes,
          vm: vm.name,
          vmId: vm.id,
          expiresAt: session.expiryTime,
          record: session,
        },
        vm,
      );
      toast.success("Lab environment starting", { description: `${vm.provider} VM ${vm.name} is booting.` });
      void navigate({ to: "/session/$sessionId", params: { sessionId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the lab");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold">{lab.title}</h3>
          <Badge variant="outline" className="font-normal">{lab.level}</Badge>
        </div>
        <p className="mt-2 flex-1 text-xs text-muted-foreground">{lab.description}</p>
        {lab.objectives.length ? (
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {lab.objectives.slice(0, 3).map((o) => <li key={o}>· {o}</li>)}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5" /> {lab.durationMinutes} min
          <Badge variant="secondary" className="font-normal capitalize">{status.replace("_", " ")}</Badge>
          {persistent ? <Badge variant="outline" className="font-normal">Multi-day lab</Badge> : null}
        </div>
        {persistent && access ? (
          <div className="mt-3 space-y-1.5 rounded-lg border border-border p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Hours remaining</span>
              <span className="font-medium">{formatHours(access.remainingMinutes)}</span>
            </div>
            <Progress value={usedPercent(access)} />
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarRange className="size-3.5" />
              {formatDate(access.accessStartsAt)} → {formatDate(access.accessEndsAt)}
            </p>
            {resuming ? (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <RotateCcw className="size-3.5" /> Your machine and files are saved.
              </p>
            ) : null}
            {blocked ? <p className="text-destructive">{evaluation?.message}</p> : null}
          </div>
        ) : null}
        {activeSession ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to="/session/$sessionId" params={{ sessionId: activeSession.id }}>
                <MonitorPlay className="size-4" /> Resume session
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/app/sessions">View sessions</Link>
            </Button>
          </div>
        ) : (
          <Button size="sm" className="mt-4" onClick={() => void launch()} disabled={starting || blocked}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {starting ? "Starting…" : resuming ? "Resume Lab" : "Start Lab"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
