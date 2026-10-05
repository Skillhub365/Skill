import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Play, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCatalog } from "@/lib/store";
import { getVmDetails, getVmStatus, startVm, stopVm } from "@/lib/vm/client";
import type { VmDetails } from "@/lib/cloud/types";
import type { VmRecord, VmStatus } from "@/lib/vm/types";

export const Route = createFileRoute("/admin/virtual-machines")({
  head: () => ({
    meta: [
      { title: "Virtual Machines — SkillTrack Labs Admin" },
      { name: "description", content: "Track lab VM inventory, status, region and uptime hours." },
      { property: "og:title", content: "Virtual Machines — SkillTrack Labs Admin" },
      { property: "og:description", content: "Monitor running, stopped and provisioning lab machines." },
    ],
  }),
  component: VmPage,
});

const TONE: Record<VmStatus, string> = {
  READY: "bg-emerald-600 text-white hover:bg-emerald-600",
  RUNNING: "bg-emerald-600/80 text-white hover:bg-emerald-600/80",
  READINESS_CHECK: "bg-amber-500 text-white hover:bg-amber-500",
  BOOTING: "bg-amber-500/80 text-white hover:bg-amber-500/80",
  STARTING: "bg-amber-500/70 text-white hover:bg-amber-500/70",
  STOPPING: "bg-muted text-muted-foreground hover:bg-muted",
  STOPPED: "bg-muted text-muted-foreground hover:bg-muted",
  ERROR: "bg-destructive text-destructive-foreground hover:bg-destructive",
};

function fmt(value: string | null) {
  return value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

function VmPage() {
  const { vms, upsertVm } = useCatalog();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<VmRecord | null>(null);
  const [cloud, setCloud] = useState<VmDetails["cloudMapping"] | null>(null);

  // Cloud resource mapping is fetched on demand and only for administrators.
  useEffect(() => {
    setCloud(null);
    if (!detail) return;
    let active = true;
    void getVmDetails(detail.id)
      .then((d) => active && setCloud(d.cloudMapping ?? null))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [detail]);

  // Poll machines mid-lifecycle so the console tracks the orchestrator.
  const vmsRef = useRef<VmRecord[]>(vms);
  vmsRef.current = vms;
  const upsertRef = useRef(upsertVm);
  upsertRef.current = upsertVm;
  useEffect(() => {
    const id = window.setInterval(() => {
      vmsRef.current
        .filter((v) => ["STARTING", "BOOTING", "RUNNING", "READINESS_CHECK"].includes(v.status))
        .forEach((v) => {
          void getVmStatus(v).then((next) => upsertRef.current(next)).catch(() => undefined);
        });
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const filtered = vms.filter((v) =>
    [v.name, v.workspaceName, v.labName, v.userName, v.region, v.status].join(" ").toLowerCase().includes(query.toLowerCase()),
  );

  const act = async (vm: VmRecord, action: "start" | "stop" | "refresh") => {
    setBusy(vm.id);
    try {
      const next =
        action === "start" ? await startVm(vm) : action === "stop" ? await stopVm(vm) : await getVmStatus(vm);
      if (next) upsertVm(next);
      toast.success(
        action === "start" ? `Start requested for ${vm.name}` : action === "stop" ? `${vm.name} stopped` : `${vm.name} refreshed`,
      );
    } catch {
      toast.error(`Could not ${action} ${vm.name}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Virtual Machines"
        description="Session-level view of the machines learners are currently using, served by the platform VM orchestrator."
      />
      {/* Production capacity is operated from the VM Pool; this page is a read-mostly session view. */}
      <p className="mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
        <span className="text-muted-foreground">
          Registering Azure machines, power actions and connection tests live in the VM Pool console.
        </span>
        <Link to="/admin/cloud/vm-pool" className="font-medium underline underline-offset-4">
          Open VM Pool
        </Link>
      </p>
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <Input
              placeholder="Search VMs, workspaces, labs or users"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-sm"
            />
            <Badge variant="secondary">{filtered.length} machines</Badge>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>VM Name</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Lab</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>Expiry Time</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell className="text-muted-foreground">{v.workspaceName}</TableCell>
                    <TableCell className="text-muted-foreground">{v.labName}</TableCell>
                    <TableCell className="text-muted-foreground">{v.userName}</TableCell>
                    <TableCell>{v.provider}</TableCell>
                    <TableCell className="text-muted-foreground">{v.region}</TableCell>
                    <TableCell><Badge className={TONE[v.status]}>{v.status}</Badge></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{v.sessionId ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(v.startedAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(v.expiresAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" disabled={busy === v.id || v.status === "READY"} onClick={() => void act(v, "start")}>
                          <Play className="size-4" /><span className="sr-only">Start</span>
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy === v.id || v.status === "STOPPED"} onClick={() => void act(v, "stop")}>
                          <Square className="size-4" /><span className="sr-only">Stop</span>
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy === v.id} onClick={() => void act(v, "refresh")}>
                          <RefreshCw className="size-4" /><span className="sr-only">Refresh</span>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setDetail(v)}>View</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{detail?.name}</DialogTitle></DialogHeader>
          {detail ? (
            <dl className="space-y-2 text-sm">
              {[
                ["Status", detail.status],
                ["Provider", detail.provider],
                ["Region", detail.region],
                ["Size", detail.size],
                ["Image", detail.image],
                ["Template", detail.templateId],
                ["Workspace", detail.workspaceName],
                ["Lab", detail.labName],
                ["User", detail.userName],
                ["Session", detail.sessionId ?? "—"],
                ["Started", fmt(detail.startedAt)],
                ["Expires", fmt(detail.expiresAt)],
                ["Readiness", detail.readiness.detail],
                ["Message", detail.error ?? detail.message],
                ...(cloud
                  ? ([
                      ["Azure subscription", cloud.azureSubscriptionId],
                      ["Resource group", cloud.azureResourceGroup],
                      ["Azure VM name", cloud.azureVmName],
                      ["Azure region", cloud.azureRegion],
                    ] as [string, string][])
                  : []),
              ].map(([k, val]) => (
                <div key={k} className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="max-w-[60%] break-words text-right font-medium">{val}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
