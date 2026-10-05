import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Cpu, MonitorPlay, Boxes } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard, StatusDot } from "@/components/layout/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth";
import { useLearnerView } from "@/lib/learner";
import { LabCard } from "@/components/learner/LabCard";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Your Lab Home — SkillTrack Labs" },
      { name: "description", content: "Your workspace, published labs, active session and VM status in one view." },
      { property: "og:title", content: "Your Lab Home — SkillTrack Labs" },
      { property: "og:description", content: "Launch cloud labs from the browser and track your session time." },
    ],
  }),
  component: UserHome,
});

function UserHome() {
  const { user } = useAuth();
  const { workspace, myLabs, activeSession: active } = useLearnerView(user);
  const ws = workspace!;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.name.split(" ")[0]}`}
        description={`You are working in ${ws.name}.`}
        action={
          active ? (
            <Button asChild>
              <Link to="/session/$sessionId" params={{ sessionId: active.id }}>Resume session</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Current Workspace" value={ws.org} hint={ws.name} icon={Boxes} />
        <StatCard label="Assigned Labs" value={String(myLabs.length)} hint="published to you" icon={MonitorPlay} />
        <StatCard label="VM Status" value={active ? "Running" : "Stopped"} hint={active?.vm ?? "No machine assigned"} icon={Cpu} />
        <StatCard label="Remaining Session Time" value={active ? `${active.remainingMinutes}m` : "—"} hint={active ? `Started ${active.startedAt}` : "No active session"} icon={Clock} />
      </div>

      <Card className="mt-8">
        <CardHeader><CardTitle className="text-base">Active session</CardTitle></CardHeader>
        <CardContent>
          {active ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold"><StatusDot tone="running" /> {active.labTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">VM {active.vm} · session {active.id}</p>
              </div>
              <div className="w-full max-w-xs">
                <Progress value={(active.remainingMinutes / 90) * 100} />
                <p className="mt-1 text-xs text-muted-foreground">{active.remainingMinutes} minutes remaining</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active session. Launch a lab below to start one.</p>
          )}
        </CardContent>
      </Card>

      <h2 className="mt-8 mb-4 text-lg font-semibold">Your labs</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {myLabs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
            No labs assigned to you yet.
          </p>
        ) : null}
        {myLabs.map((l) => <LabCard key={l.id} lab={l} />)}
      </div>
    </>
  );
}
