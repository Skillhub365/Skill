import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, Square } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RealtimeStatusBadge } from "@/components/realtime/RealtimeStatusBadge";
import { friendlyFrom } from "@/lib/errors";
import { useLiveRefresh } from "@/lib/realtime/hooks";
import { fetchPool, fetchPoolAudit, poolVmAction, syncPool, type ReaperRun } from "@/lib/vm/pool/client";
import { POOL_STATUS_LABEL, type PoolVm } from "@/lib/vm/pool/types";
import { CLOUD_AUDIT_ACTION_LABEL, type CloudAuditEntry } from "@/lib/cloud/audit/types";

export const Route = createFileRoute("/admin/cloud/orphans")({
  head: () => ({
    meta: [
      { title: "Orphaned VMs — SkillTrack Labs Admin" },
      { name: "description", content: "Machines still running in Azure with no active lab session: stop, release and audit them." },
      { property: "og:title", content: "Orphaned VMs — SkillTrack Labs Admin" },
      { property: "og:description", content: "Detect and reclaim Azure lab machines that outlived their session." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireAuth role="superadmin">
      <OrphansPage />
    </RequireAuth>
  ),
});

function OrphansPage() {
  const [vms, setVms] = useState<PoolVm[]>([]);
  const [entries, setEntries] = useState<CloudAuditEntry[]>([]);
  const [reaper, setReaper] = useState<ReaperRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pool, audit] = await Promise.all([fetchPool(), fetchPoolAudit(120).catch(() => [])]);
      setVms(pool.vms);
      setReaper(pool.reaper ?? null);
      setEntries(audit);
      setError(null);
    } catch (e) {
      setError(friendlyFrom(e).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime first: pool/session changes push a refresh, polling only backs it up.
  const live = useLiveRefresh({
    tables: ["vm_pool_entries", "vm_records", "sessions"],
    refresh: load,
    fallbackMs: 20_000,
  });

  const orphans = vms.filter((v) => v.orphaned);

  const act = async (vm: PoolVm, action: "stop" | "release") => {
    setBusy(`${vm.id}:${action}`);
    try {
      await poolVmAction(vm.id, action);
      toast.success(action === "stop" ? `${vm.azureVmName} deallocated.` : `${vm.azureVmName} released back to the pool.`);
      await load();
    } catch (e) {
      toast.error(friendlyFrom(e).message);
    } finally {
      setBusy(null);
    }
  };

  const sweep = async () => {
    setBusy("sweep");
    try {
      const data = await syncPool();
      setVms(data.vms);
      setReaper(data.reaper);
      toast.success(
        `Sweep complete · ${data.reaper.expiredSessions} session(s) expired, ${data.reaper.releasedVms} machine(s) released, ${data.orphans} orphan(s).`,
      );
      await load();
    } catch (e) {
      toast.error(friendlyFrom(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orphaned VMs"
        description="Machines Azure still reports as running while SkillTrack holds no live session. Stop them to end the spend, release them to return capacity to the pool."
        action={
          <div className="flex items-center gap-3">
            <RealtimeStatusBadge status={live.status} lastUpdatedAt={live.lastUpdatedAt} />
          <Button variant="outline" onClick={() => void sweep()} disabled={busy === "sweep"}>
            {busy === "sweep" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Run sweep now
          </Button>
          </div>
        }
      />

      {error ? (
        <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      ) : null}

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-4">
          <Metric label="Orphaned now" value={orphans.length} />
          <Metric label="Sessions expired (last sweep)" value={reaper?.expiredSessions ?? 0} />
          <Metric label="Machines released (last sweep)" value={reaper?.releasedVms ?? 0} />
          <Metric label="Last automated sweep" value={reaper ? new Date(reaper.at).toLocaleTimeString() : "—"} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-sm font-semibold">Orphaned machines</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Machine</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last session</TableHead>
                <TableHead>Azure</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Checking Azure…</TableCell></TableRow>
              ) : null}
              {!loading && orphans.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No orphaned machines. Every running VM belongs to a live session.</TableCell></TableRow>
              ) : null}
              {orphans.map((vm) => (
                <TableRow key={vm.id}>
                  <TableCell>
                    <span className="font-medium">{vm.name}</span>
                    <span className="block text-xs text-muted-foreground">{vm.azureVmName} · {vm.vmSize} · {vm.region}</span>
                  </TableCell>
                  <TableCell className="text-sm">{vm.templateName}</TableCell>
                  <TableCell>
                    <Badge variant="destructive">Orphan</Badge>
                    <span className="ml-2 text-xs text-muted-foreground">{POOL_STATUS_LABEL[vm.status]}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {vm.currentSessionId ?? "—"}
                    <span className="block">{vm.assignedUserName ?? "unassigned"}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {vm.resourceGroup} · {vm.powerState}
                    <span className="block">Synced {vm.lastSyncedAt ? new Date(vm.lastSyncedAt).toLocaleTimeString() : "never"}</span>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => void act(vm, "stop")} disabled={busy === `${vm.id}:stop`}>
                      <Square className="mr-1 h-3.5 w-3.5" /> Stop
                    </Button>
                    <Button size="sm" onClick={() => void act(vm, "release")} disabled={busy === `${vm.id}:release`}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Stop & release
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-sm font-semibold">Audit trail</p>
          <div className="space-y-2">
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No machine actions recorded yet.</p>
            ) : null}
            {entries.slice(0, 40).map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-xs">
                <div>
                  <span className="font-medium">{CLOUD_AUDIT_ACTION_LABEL[e.action] ?? e.action}</span>
                  <span className="text-muted-foreground"> · {e.target ?? "—"} · {e.detail}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Badge variant={e.outcome === "success" ? "secondary" : "destructive"}>{e.outcome}</Badge>
                  <span>{e.actorName}</span>
                  <span>{new Date(e.at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
