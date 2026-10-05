import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, Clock, Download, Loader2, RefreshCw, ServerCrash, Timer, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { RealtimeStatusBadge } from "@/components/realtime/RealtimeStatusBadge";
import { useLiveRefresh } from "@/lib/realtime/hooks";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { StatCard } from "@/components/layout/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { friendlyFrom } from "@/lib/errors";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/lib/store";
import {
  downloadUsageExport,
  fetchSessionUsage,
  fetchUsageActivity,
  type ActivityRowView,
  type SessionUsageView,
  type UsageDimensionView,
  type UsageQuery,
} from "@/lib/reporting/client";

export const Route = createFileRoute("/admin/usage")({
  head: () => ({
    meta: [
      { title: "Usage Reports — SkillTrack Labs Admin" },
      {
        name: "description",
        content:
          "Precise VM, learner, lab and session usage reporting with activity audit trails and CSV exports for SkillTrack Labs.",
      },
      { property: "og:title", content: "Usage Reports — SkillTrack Labs Admin" },
      { property: "og:description", content: "Session-level lab usage, VM hours, estimated cost and activity history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth role="admin">
      <UsageReportsPage />
    </RequireAuth>
  ),
});

const ANY = "__any__";

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function hhmm(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function when(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function isoDay(offsetDays: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function DimensionTable({ title, rows, unitLabel }: { title: string; rows: UsageDimensionView[]; unitLabel: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{unitLabel}</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">VM hours</TableHead>
              <TableHead className="text-right">Estimated cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-muted-foreground">No usage in this window.</TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right">{r.sessions}</TableCell>
                  <TableCell className="text-right">{r.vmHours.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{usd(r.estimatedCostCents)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function UsageReportsPage() {
  const { user } = useAuth();
  const superAdmin = user?.role === "superadmin";
  const { workspaces, labs, users } = useCatalog();

  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(0));
  const [tenantId, setTenantId] = useState(ANY);
  const [workspaceId, setWorkspaceId] = useState(ANY);
  const [labId, setLabId] = useState(ANY);
  const [userId, setUserId] = useState(ANY);
  const [vm, setVm] = useState("");
  const [status, setStatus] = useState(ANY);
  const [stream, setStream] = useState<"user" | "vm" | "admin">("user");

  const [report, setReport] = useState<SessionUsageView | null>(null);
  const [activity, setActivity] = useState<ActivityRowView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo<UsageQuery>(() => {
    const q: UsageQuery = {};
    if (from) q.from = new Date(`${from}T00:00:00.000Z`).toISOString();
    if (to) q.to = new Date(`${to}T23:59:59.999Z`).toISOString();
    if (superAdmin && tenantId !== ANY) q.tenantId = tenantId;
    if (workspaceId !== ANY) q.workspaceId = workspaceId;
    if (labId !== ANY) q.labId = labId;
    if (userId !== ANY) q.userId = userId;
    if (vm.trim()) q.vm = vm.trim();
    if (status !== ANY) q.status = status;
    return q;
  }, [from, to, superAdmin, tenantId, workspaceId, labId, userId, vm, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usage, feed] = await Promise.all([
        fetchSessionUsage(query),
        fetchUsageActivity({ ...query, stream }),
      ]);
      setReport(usage);
      setActivity(feed.rows);
    } catch (err) {
      setError(friendlyFrom(err).message);
    } finally {
      setLoading(false);
    }
  }, [query, stream]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: new/updated sessions and audit rows re-run the current report.
  const live = useLiveRefresh({
    tables: ["sessions", "activity_logs", "session_events", "lifecycle_events"],
    refresh: load,
    fallbackMs: 60_000,
    liveHeartbeatMs: 0,
    debounceMs: 2_000,
  });

  const scopedLabs = useMemo(
    () => (workspaceId === ANY ? labs : labs.filter((l) => l.workspaceId === workspaceId)),
    [labs, workspaceId],
  );

  const totals = report?.totals;

  const exportNow = async (endpoint: "sessions" | "activity", format: "csv" | "json") => {
    try {
      await downloadUsageExport(endpoint, endpoint === "activity" ? { ...query, stream } : query, format);
    } catch (err) {
      setError(friendlyFrom(err).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage Reports"
        description={
          superAdmin
            ? "Platform-wide learner, lab, VM and session usage. Durations are server-derived; costs are estimates."
            : "Learner, lab, VM and session usage for your organisation. Durations are server-derived; costs are estimates."
        }
        action={<RealtimeStatusBadge status={live.status} lastUpdatedAt={live.lastUpdatedAt} />}
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportNow("sessions", "csv")}>
              <Download className="mr-2 size-4" /> CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void exportNow("sessions", "json")}>
              JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="usage-from">From</Label>
            <Input id="usage-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usage-to">To</Label>
            <Input id="usage-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {superAdmin ? (
            <div className="space-y-1.5">
              <Label>Organisation</Label>
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger><SelectValue placeholder="All organisations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All organisations</SelectItem>
                  {(report?.tenants ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Workspace</Label>
            <Select value={workspaceId} onValueChange={(v) => { setWorkspaceId(v); setLabId(ANY); }}>
              <SelectTrigger><SelectValue placeholder="All workspaces" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All workspaces</SelectItem>
                {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Lab</Label>
            <Select value={labId} onValueChange={setLabId}>
              <SelectTrigger><SelectValue placeholder="All labs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All labs</SelectItem>
                {scopedLabs.map((l) => <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Learner</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="All learners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All learners</SelectItem>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usage-vm">VM</Label>
            <Input id="usage-vm" placeholder="Azure VM name" value={vm} onChange={(e) => setVm(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Any status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any status</SelectItem>
                {["ACTIVE", "READY", "STARTING", "EXPIRED", "STOPPED", "ERROR"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Total sessions" value={String(totals?.sessions ?? 0)} hint={report ? `${when(report.from)} → ${when(report.to)}` : "Loading window"} icon={BarChart3} />
        <StatCard label="Active sessions" value={String(totals?.active ?? 0)} hint="Billing through current server time" icon={Timer} />
        <StatCard label="VM hours" value={(totals?.vmHours ?? 0).toFixed(2)} hint="Server-derived from session timestamps" icon={Clock} />
        <StatCard label="Estimated cost" value={usd(totals?.estimatedCostCents ?? 0)} hint="Estimate — not Azure billing" icon={Wallet} />
        <StatCard label="Failed sessions" value={String(totals?.failed ?? 0)} hint="Ended with an error" icon={ServerCrash} />
        <StatCard label="Expired sessions" value={String(totals?.expired ?? 0)} hint={`${totals?.stopped ?? 0} stopped by learner`} icon={Users} />
      </div>

      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">Session detail</TabsTrigger>
          <TabsTrigger value="dimensions">Breakdowns</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Session-level usage</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Learner</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Lab</TableHead>
                    <TableHead>VM</TableHead>
                    <TableHead>Size / region</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Ended</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assignment</TableHead>
                    <TableHead className="text-right">Hours left</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                    <TableHead>Correlation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report?.rows ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={12} className="text-muted-foreground">No sessions match these filters.</TableCell></TableRow>
                  ) : (
                    (report?.rows ?? []).map((r) => (
                      <TableRow key={r.sessionId}>
                        <TableCell className="font-medium">
                          {r.learnerName}
                          {r.learnerEmail ? <span className="block text-xs text-muted-foreground">{r.learnerEmail}</span> : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.workspace}</TableCell>
                        <TableCell className="text-muted-foreground">{r.lab}</TableCell>
                        <TableCell>
                          {r.vmName ?? "—"}
                          {r.azureResourceId ? (
                            <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={r.azureResourceId}>
                              {r.azureResourceId}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{[r.vmSize, r.region].filter(Boolean).join(" · ") || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{when(r.startedAt)}</TableCell>
                        <TableCell className="text-muted-foreground">{r.live ? "Running" : when(r.endedAt)}</TableCell>
                        <TableCell className="text-right">{hhmm(r.durationMinutes)}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "ERROR" ? "destructive" : r.live ? "default" : "secondary"}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.assignmentType}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {r.persistentRemainingHours == null
                            ? "—"
                            : `${r.persistentRemainingHours.toFixed(1)}${
                                r.persistentAllowedHours ? ` / ${r.persistentAllowedHours.toFixed(0)}` : ""
                              } h`}
                        </TableCell>
                        <TableCell className="text-right">{usd(r.estimatedCostCents)}</TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground" title={r.correlationId ?? ""}>
                          {r.correlationId ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dimensions" className="mt-4 grid gap-4 xl:grid-cols-2">
          <DimensionTable title="Usage by learner" rows={report?.byLearner ?? []} unitLabel="Learner" />
          <DimensionTable title="Usage by workspace" rows={report?.byWorkspace ?? []} unitLabel="Workspace" />
          <DimensionTable title="Usage by lab" rows={report?.byLab ?? []} unitLabel="Lab" />
          <DimensionTable title="Usage by VM" rows={report?.byVm ?? []} unitLabel="Azure VM" />
          <DimensionTable title="Usage by VM size" rows={report?.bySize ?? []} unitLabel="VM size" />
          <DimensionTable title="Usage by lab type" rows={report?.byMode ?? []} unitLabel="Lab type" />
        </TabsContent>

        <TabsContent value="activity" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(["user", "vm", "admin"] as const).map((s) => (
              <Button key={s} size="sm" variant={stream === s ? "default" : "outline"} onClick={() => setStream(s)}>
                {s === "user" ? "User activity" : s === "vm" ? "VM activity" : "Admin activity"}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => void exportNow("activity", "csv")}>
              <Download className="mr-2 size-4" /> Export activity CSV
            </Button>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Durable audit trail</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activity.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-muted-foreground">No recorded activity in this window.</TableCell></TableRow>
                  ) : (
                    activity.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{when(r.at)}</TableCell>
                        <TableCell className="font-medium">{r.action}</TableCell>
                        <TableCell className="text-muted-foreground">{r.actor}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-muted-foreground" title={r.target}>{r.target}</TableCell>
                        <TableCell>
                          <Badge variant={r.outcome === "failure" ? "destructive" : "secondary"}>{r.outcome}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate text-muted-foreground" title={r.detail ?? ""}>{r.detail ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.source}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Costs are estimates derived from the configured rate card, not Azure Cost Management. Azure resource identifiers are
        truncated and no credentials, private IPs or tokens are ever included in reports or exports.
      </p>
    </div>
  );
}
