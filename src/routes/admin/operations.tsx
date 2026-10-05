import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Timer,
} from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { RealtimeStatusBadge } from "@/components/realtime/RealtimeStatusBadge";
import { useLiveRefresh } from "@/lib/realtime/hooks";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { StatCard } from "@/components/layout/StatCard";
import { ProductionReadinessPanel } from "@/components/admin/ProductionReadinessPanel";
import { LiveOperationsPanel } from "@/components/admin/LiveOperationsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { friendlyFrom } from "@/lib/errors";
import {
  downloadUsageCsv,
  fetchOpsStatus,
  fetchUsageReport,
  isDurationMetric,
  metricLabel,
  type OpsStatus,
  type UsageBucketView,
  type UsageReportView,
} from "@/lib/observability/client";

export const Route = createFileRoute("/admin/operations")({
  head: () => ({
    meta: [
      { title: "Operations — SkillTrack Labs Admin" },
      {
        name: "description",
        content: "Live platform health, lab reliability metrics, alerts and estimated compute usage for SkillTrack Labs.",
      },
      { property: "og:title", content: "Operations — SkillTrack Labs Admin" },
      { property: "og:description", content: "Reliability metrics, alerts and usage reporting for the lab platform." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth role="admin">
      <OperationsPage />
    </RequireAuth>
  ),
});

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function duration(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function OperationsPage() {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [usage, setUsage] = useState<UsageReportView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [ops, report] = await Promise.all([fetchOpsStatus(24), fetchUsageReport(30)]);
      setStatus(ops);
      setUsage(report);
      setError(null);
    } catch (e) {
      setError(friendlyFrom(e).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const live = useLiveRefresh({
    tables: ["lifecycle_events", "sessions", "activity_logs"],
    refresh: load,
    fallbackMs: 60_000,
    liveHeartbeatMs: 300_000,
    debounceMs: 1_500,
  });

  const firing = status?.alerts.filter((alert) => alert.state === "firing") ?? [];
  const launches = status?.metrics.find((m) => m.metric === "lab.launch.requested")?.total ?? 0;
  const failures = status?.metrics.find((m) => m.metric === "lab.launch.failed")?.total ?? 0;
  const successRate = launches > 0 ? ((launches - failures) / launches) * 100 : 100;
  const readyP95 = status?.metrics.find((m) => m.metric === "vm.readiness.duration_ms")?.p95 ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations"
        description="Live reliability, alerting and estimated usage for the lab platform. Cost figures are estimates, not cloud invoices."
        action={
          <div className="flex items-center gap-2">
            <RealtimeStatusBadge status={live.status} lastUpdatedAt={live.lastUpdatedAt} />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
              {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              Refresh
            </Button>
            <Button size="sm" onClick={() => void downloadUsageCsv(30)}>
              <Download className="mr-2 size-4" />
              Export usage
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 p-5 text-sm">
            <AlertTriangle className="size-4 text-destructive" />
            {error}
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Gathering platform telemetry…
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Lab start success"
              value={`${successRate.toFixed(1)}%`}
              hint={`${launches} starts in the last 24h`}
              icon={CheckCircle2}
            />
            <StatCard
              label="Time to ready desktop (p95)"
              value={readyP95 ? duration(readyP95) : "—"}
              hint="95% of learners waited less than this"
              icon={Timer}
            />
            <StatCard
              label="Open alerts"
              value={String(firing.length)}
              hint={firing.length ? "Action needed" : "All checks passing"}
              icon={ShieldAlert}
            />
            <StatCard
              label="Estimated spend (30d)"
              value={usage ? usd(usage.totals.estimatedCostCents) : "—"}
              hint={usage ? `${usage.totals.vmHours.toFixed(1)} machine hours — estimate` : "Estimate"}
              icon={Gauge}
            />
          </div>

          <Tabs defaultValue="live">
            <TabsList>
              <TabsTrigger value="live">Live state</TabsTrigger>
              <TabsTrigger value="alerts">Alerts</TabsTrigger>
              <TabsTrigger value="metrics">Metrics</TabsTrigger>
              <TabsTrigger value="usage">Usage &amp; cost</TabsTrigger>
              <TabsTrigger value="cleanup">Cleanup</TabsTrigger>
              <TabsTrigger value="readiness">Production readiness</TabsTrigger>
            </TabsList>

            <TabsContent value="live" className="mt-4">
              <LiveOperationsPanel />
            </TabsContent>

            <TabsContent value="alerts" className="mt-4 space-y-3">
              {(status?.alerts ?? []).map((alert) => (
                <Card key={alert.id} className={alert.state === "firing" ? "border-destructive/50" : undefined}>
                  <CardContent className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{alert.title}</span>
                        <Badge variant={alert.state === "firing" ? "destructive" : "secondary"}>
                          {alert.state === "firing" ? alert.severity : "healthy"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{alert.detail}</p>
                      {alert.state === "firing" ? (
                        <p className="mt-1 text-sm">
                          <span className="font-medium">Next step: </span>
                          {alert.action}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <div>Observed {alert.observed}</div>
                      <div>Threshold {alert.threshold}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="metrics" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Last {status?.windowHours ?? 24} hours</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead className="text-right">Events</TableHead>
                        <TableHead className="text-right">Total / average</TableHead>
                        <TableHead className="text-right">p95</TableHead>
                        <TableHead className="text-right">Failures</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(status?.metrics ?? []).map((metric) => (
                        <TableRow key={metric.metric}>
                          <TableCell className="font-medium">{metricLabel(metric.metric)}</TableCell>
                          <TableCell className="text-right">{metric.count}</TableCell>
                          <TableCell className="text-right">
                            {isDurationMetric(metric.metric)
                              ? duration(metric.average)
                              : Math.round(metric.total).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {metric.p95 !== null && isDurationMetric(metric.metric) ? duration(metric.p95) : "—"}
                          </TableCell>
                          <TableCell className="text-right">{metric.failures || "—"}</TableCell>
                        </TableRow>
                      ))}
                      {!status?.metrics.length ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                            No activity recorded in this window yet.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="usage" className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Machine hours are measured from durable session records. Costs are estimates from the configured rate
                card and will not match a cloud invoice exactly.
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <UsageTable title="By workspace" rows={usage?.byWorkspace ?? []} />
                <UsageTable title="By lab" rows={usage?.byLab ?? []} />
                <UsageTable title="By learner" rows={usage?.byUser ?? []} />
                <UsageTable title="By machine size" rows={usage?.bySize ?? []} />
              </div>
              <Card>
                <CardContent className="grid gap-4 p-5 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">Peak simultaneous sessions</p>
                    <p className="text-2xl font-semibold">{usage?.peakConcurrentSessions.count ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Sessions in window</p>
                    <p className="text-2xl font-semibold">{usage?.totals.sessions ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Currently running</p>
                    <p className="text-2xl font-semibold">{usage?.totals.active ?? 0}</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cleanup" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Last background cleanup run</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-5 text-sm">
                  {status?.lastCleanupRun ? (
                    <>
                      <p className="text-muted-foreground">
                        {new Date(status.lastCleanupRun.at).toLocaleString()}
                      </p>
                      <ul className="grid gap-1 sm:grid-cols-2">
                        <li>Sessions expired: {status.lastCleanupRun.expiredSessions}</li>
                        <li>Machines released: {status.lastCleanupRun.releasedVms}</li>
                        <li>Orphans detected: {status.lastCleanupRun.orphans}</li>
                        <li>Abandoned launches: {status.lastCleanupRun.stuckLaunches ?? 0}</li>
                      </ul>
                      {status.lastCleanupRun.errors.length ? (
                        <p className="flex items-center gap-2 text-destructive">
                          <AlertTriangle className="size-4" />
                          {status.lastCleanupRun.errors.length} cleanup errors — see the stuck-session runbook.
                        </p>
                      ) : (
                        <p className="flex items-center gap-2 text-muted-foreground">
                          <Activity className="size-4" />
                          Cleanup completed without errors.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground">No cleanup run has completed on this instance yet.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="readiness" className="mt-4">
              <ProductionReadinessPanel />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function UsageTable({ title, rows }: { title: string; rows: UsageBucketView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Est. cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 10).map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-right">{row.sessions}</TableCell>
                <TableCell className="text-right">{row.vmHours.toFixed(1)}</TableCell>
                <TableCell className="text-right">{usd(row.estimatedCostCents)}</TableCell>
              </TableRow>
            ))}
            {!rows.length ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  No usage recorded yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
