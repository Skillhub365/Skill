import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Boxes, Cpu, FlaskConical, MonitorPlay, Timer, Users, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/layout/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ActiveVmChart,
  LabUsageChart,
  SessionsOverTimeChart,
  VmUsageChart,
} from "@/components/admin/OpsCharts";
import { CATEGORY_TONE } from "@/lib/activity";
import { activeVmCount, buildKpis, labUsage, sessionsOverTime, vmUsage } from "@/lib/admin-metrics";
import { useCatalog } from "@/lib/store";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Overview — SkillTrack Labs" },
      { name: "description", content: "Platform KPIs across workspaces, labs, users, VMs and live lab sessions." },
      { property: "og:title", content: "Admin Overview — SkillTrack Labs" },
      { property: "og:description", content: "Monitor workspaces, published labs, running VMs and active sessions." },
    ],
  }),
  component: AdminOverview,
});

const icons = [Boxes, FlaskConical, Users, Cpu, MonitorPlay, Timer, Zap, Activity];
const RUNNING = ["STARTING", "BOOTING", "RUNNING", "READINESS_CHECK", "READY"];

function AdminOverview() {
  const { workspaces, labs, users, vms, sessions, events } = useCatalog();
  const input = { workspaces, labs, users, vms, sessions, events };
  const kpis = buildKpis(input);
  const active = sessions.filter((s) => s.status === "active");
  const runningVms = vms.filter((v) => RUNNING.includes(v.status));

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live health of your cloud lab delivery platform."
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/admin/sessions">Sessions</Link>
            </Button>
            <Button asChild>
              <Link to="/admin/workspaces">Manage workspaces</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k, i) => (
          <StatCard key={k.label} label={k.label} value={k.value} hint={k.hint} icon={icons[i] ?? undefined} />
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SessionsOverTimeChart data={sessionsOverTime(input)} />
        <VmUsageChart data={vmUsage(input)} />
        <LabUsageChart data={labUsage(input)} />
        <ActiveVmChart data={activeVmCount(input)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Active sessions</CardTitle>
            <Badge variant="secondary">{active.length} live</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {active.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No active sessions right now.
              </p>
            ) : null}
            {active.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-4">
                <div>
                  <p className="text-sm font-semibold">{s.labTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.user} · {s.workspace} · VM {s.vm}
                  </p>
                </div>
                <Badge variant="secondary">{s.remainingMinutes} min left</Badge>
              </div>
            ))}

            <div className="grid gap-3 pt-2 sm:grid-cols-3">
              {[
                { k: "Running VMs", v: runningVms.length },
                { k: "Regions in use", v: new Set(vms.map((v) => v.region)).size },
                { k: "Providers", v: new Set(vms.map((v) => v.provider)).size },
              ].map((i) => (
                <div key={i.k} className="rounded-xl bg-muted/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{i.k}</p>
                  <p className="mt-1 text-xl font-semibold">{i.v}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent activity</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/activity">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {events.slice(0, 7).map((e) => (
              <div key={e.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`font-normal ${CATEGORY_TONE[e.category]}`}>
                    {e.type.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-1">
                  <span className="font-medium">{e.actor}</span>{" "}
                  <span className="text-muted-foreground">{e.detail}</span>
                </p>
                <p className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
