import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, Ban, Loader2, MoreHorizontal, Plus, Power, PowerOff,
  RefreshCw, RotateCcw, Search, ShieldCheck, Trash2, UserCog, Undo2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { VmPoolRegisterWizard } from "@/components/admin/VmPoolRegisterWizard";
import { VmAssignDialog } from "@/components/admin/VmAssignDialog";
import { VmRdpTestDialog } from "@/components/admin/VmRdpTestDialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RealtimeStatusBadge } from "@/components/realtime/RealtimeStatusBadge";
import { AzureLiveStatusPanel } from "@/components/admin/AzureLiveStatusPanel";
import { RemoteDesktopHealthPanel } from "@/components/admin/RemoteDesktopHealthPanel";
import { GatewaySetupPanel } from "@/components/admin/GatewaySetupPanel";
import { useGatewayHealth } from "@/lib/remote-desktop/health-client";
import { useAzureEventStatus } from "@/lib/cloud/events/client";
import { AZURE_EVENT_KIND_LABEL, AZURE_STATE_SOURCE_LABEL, type AzureEventKind, type AzureStateSource } from "@/lib/cloud/events/types";
import { friendlyFrom } from "@/lib/errors";
import { useLiveRefresh } from "@/lib/realtime/hooks";
import {
  fetchPool, poolVmAction, removePoolVm, syncPool, testVmAzure, testVmRdp,
  type PoolActionPayload, type PoolRuntimeBadge, type PoolTemplateOption, type PoolVmAction,
} from "@/lib/vm/pool/client";
import {
  POOL_KIND_LABEL, POOL_STATUS_LABEL,
  type PoolTemplateSummary, type PoolVm, type PoolVmKind, type RdpTestResult,
} from "@/lib/vm/pool/types";

export const Route = createFileRoute("/admin/cloud/vm-pool")({
  head: () => ({
    meta: [
      { title: "VM Pool — SkillTrack Labs Admin" },
      { name: "description", content: "Register real Azure virtual machines and monitor lab capacity, allocation and orphans." },
      { property: "og:title", content: "VM Pool — SkillTrack Labs Admin" },
      { property: "og:description", content: "Pre-created Azure VM pool: capacity per template, allocation state and orphan reclaim." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireAuth role="superadmin">
      <VmPoolPage />
    </RequireAuth>
  ),
});

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  AVAILABLE: "secondary",
  ALLOCATED: "outline",
  STARTING: "outline",
  RUNNING: "default",
  READY: "default",
  IN_USE: "default",
  STOPPING: "outline",
  STOPPED: "secondary",
  ERROR: "destructive",
  RETIRED: "outline",
};

/** A machine can only be booted when nothing else is happening to it. */
const STARTABLE = new Set(["AVAILABLE", "STOPPED", "ERROR", "ALLOCATED"]);
const STOPPABLE = new Set(["AVAILABLE", "RUNNING", "READY", "STARTING", "BOOTING", "ERROR", "ALLOCATED"]);

function VmPoolPage() {
  const [vms, setVms] = useState<PoolVm[]>([]);
  const [summaries, setSummaries] = useState<PoolTemplateSummary[]>([]);
  const [templates, setTemplates] = useState<PoolTemplateOption[]>([]);
  const [dynamic, setDynamic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [templateFilter, setTemplateFilter] = useState("all");
  const [connectionFilter, setConnectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [auto, setAuto] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [wizard, setWizard] = useState(false);
  const [kinds, setKinds] = useState<Record<string, PoolVmKind>>({});
  const [runtime, setRuntime] = useState<PoolRuntimeBadge | null>(null);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [busyVm, setBusyVm] = useState<string | null>(null);
  const [assignVm, setAssignVm] = useState<PoolVm | null>(null);
  const [rdpVm, setRdpVm] = useState<PoolVm | null>(null);
  const [rdpResult, setRdpResult] = useState<RdpTestResult | null>(null);
  const [rdpRunning, setRdpRunning] = useState(false);
  const [eventKey, setEventKey] = useState(0);
  const eventStatus = useAzureEventStatus(eventKey);
  const gateway = useGatewayHealth();

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await fetchPool();
      setVms(data.vms);
      setSummaries(data.summaries);
      setTemplates(data.templates);
      setDynamic(data.dynamicProvisioning);
      setKinds(data.kinds ?? {});
      setRuntime(data.runtime ?? null);
      setWorkspaces(data.workspaces ?? []);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(friendlyFrom(e).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Realtime first: Supabase pushes pool/session row changes and we re-read our
  // own authorised API (the browser never talks to Azure). Polling is fallback.
  const live = useLiveRefresh({
    tables: ["vm_pool_entries", "vm_records", "sessions", "gateway_connections"],
    refresh: () => load(true),
    fallbackMs: 15_000,
    enabled: auto,
  });

  const connections = useMemo(() => {
    const map = new Map<string, string>();
    vms.forEach((v) => map.set(v.cloudConnectionId, v.cloudConnectionName));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [vms]);

  const filtered = useMemo(
    () =>
      vms
        .filter((v) => templateFilter === "all" || v.templateId === templateFilter)
        .filter((v) => connectionFilter === "all" || v.cloudConnectionId === connectionFilter)
        .filter((v) =>
          statusFilter === "all"
            ? true
            : statusFilter === "ORPHAN"
              ? v.orphaned
              : v.status === statusFilter,
        )
        .filter((v) =>
          [v.name, v.azureVmName, v.templateName, v.resourceGroup, v.region, v.assignedUserName ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q.toLowerCase()),
        ),
    [vms, q, templateFilter, connectionFilter, statusFilter],
  );

  const orphans = vms.filter((v) => v.orphaned);

  const refresh = async () => {
    setSyncing(true);
    try {
      const data = await syncPool();
      setVms(data.vms);
      setSummaries(data.summaries);
      toast.success(data.orphans ? `${data.orphans} orphaned machine(s) detected.` : "Pool synchronised with Azure.");
    } catch (e) {
      toast.error(friendlyFrom(e).message);
    } finally {
      setSyncing(false);
    }
  };

  const applyVm = (updated: PoolVm | null) => {
    if (updated) setVms((list) => list.map((v) => (v.id === updated.id ? updated : v)));
  };

  const SUCCESS: Partial<Record<PoolVmAction, string>> = {
    sync: "Status refreshed from Azure.",
    start: "Start requested — the machine will report running shortly.",
    stop: "Deallocation requested — compute billing stops once Azure completes it.",
    restart: "Restart requested.",
    reclaim: "Machine deallocated and returned to the pool.",
    release: "Session released and the machine returned to the pool.",
    retire: "Machine retired. It keeps its history but will not be offered to learners.",
    restore: "Machine returned to service.",
    "assign-workspace": "Workspace assignment saved.",
    "assign-user-lab": "Reservation saved.",
  };

  const act = async (vm: PoolVm, action: PoolVmAction, payload: PoolActionPayload = {}) => {
    setBusyVm(vm.id);
    try {
      const { vm: updated, message } = await poolVmAction(vm.id, action, payload);
      applyVm(updated);
      toast.success(message ?? SUCCESS[action] ?? "Done.");
      if (action === "start" || action === "stop" || action === "restart") {
        // Azure state settles asynchronously; pick it up on the next tick.
        window.setTimeout(() => { void load(true); }, 4000);
      }
    } catch (e) {
      toast.error(friendlyFrom(e).message);
    } finally {
      setBusyVm(null);
    }
  };

  const runAzureTest = async (vm: PoolVm) => {
    setBusyVm(vm.id);
    try {
      const { test } = await testVmAzure(vm.id);
      (test.ok ? toast.success : toast.warning)(
        `${vm.name}: ${test.powerState} · ${test.detail}`,
      );
      void load(true);
    } catch (e) {
      toast.error(friendlyFrom(e).message);
    } finally {
      setBusyVm(null);
    }
  };

  const runRdpTest = async (vm: PoolVm) => {
    setRdpVm(vm);
    setRdpResult(null);
    setRdpRunning(true);
    try {
      const { rdp } = await testVmRdp(vm.id);
      setRdpResult(rdp);
    } catch (e) {
      toast.error(friendlyFrom(e).message);
      setRdpVm(null);
    } finally {
      setRdpRunning(false);
    }
  };

  const remove = async (vm: PoolVm) => {
    try {
      await removePoolVm(vm.id);
      setVms((list) => list.filter((v) => v.id !== vm.id));
      toast.success(`${vm.azureVmName} removed from the pool.`);
    } catch (e) {
      toast.error(friendlyFrom(e).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="VM Pool"
        description="Pre-created Azure virtual machines mapped to SkillTrack templates. Learners are allocated a free machine atomically when they start a lab."
        action={
          <div className="flex items-center gap-2">
            <RealtimeStatusBadge status={auto ? live.status : "fallback"} lastUpdatedAt={live.lastUpdatedAt ?? lastRefresh} />
            <Button variant="outline" onClick={() => void refresh()} disabled={syncing}>
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sync with Azure
            </Button>
            <Button onClick={() => setWizard(true)}>
              <Plus className="mr-2 h-4 w-4" /> Register VM
            </Button>
          </div>
        }
      />

      {error ? (
        <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      ) : null}

      {runtime ? (
        <AzureLiveStatusPanel
          status={eventStatus.data}
          onReconciled={() => {
            setEventKey((n) => n + 1);
            void load(true);
          }}
        />
      ) : null}

      <RemoteDesktopHealthPanel
        health={gateway.data}
        loading={gateway.loading}
        onRefresh={() => void gateway.refresh()}
      />

      <GatewaySetupPanel
        machines={vms.filter((v) => v.status !== "RETIRED").map((v) => ({ id: v.id, name: v.name }))}
        onVerified={() => void gateway.refresh()}
      />

      {runtime ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs">
          <Badge variant={runtime.environment === "development" ? "outline" : "secondary"}>
            {runtime.environment === "development" ? "Development environment" : `Environment: ${runtime.environment}`}
          </Badge>
          <Badge variant={runtime.azureConfigured ? "secondary" : "destructive"}>
            {runtime.azureConfigured ? "Azure connected" : "Azure not configured"}
          </Badge>
          <Badge variant={runtime.guacamoleConfigured ? "secondary" : "outline"}>
            {runtime.guacamoleConfigured ? "Remote desktop gateway live" : "Simulated desktop"}
          </Badge>
          {runtime.degraded ? (
            <span className="text-muted-foreground">{runtime.degradedReasons.join(" · ")}</span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {summaries.map((s) => (
          <Card key={s.templateId}>
            <CardContent className="space-y-3 p-4">
              <p className="font-medium">{s.templateName}</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <Metric label="Available" value={s.available} />
                <Metric label="Allocated" value={s.allocated} />
                <Metric label="In use" value={s.inUse} />
                <Metric label="Running" value={s.running} />
                <Metric label="Stopped" value={s.stopped} />
                <Metric label="Errors" value={s.error} />
              </div>
            </CardContent>
          </Card>
        ))}
        {!loading && summaries.length === 0 ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="p-6 text-sm text-muted-foreground">
              No machines registered yet. Register an existing Azure VM to give learners lab capacity.
            </CardContent>
          </Card>
        ) : null}
      </div>

      {orphans.length ? (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-muted/40 p-3 text-sm">
          <AlertTriangle className="h-4 w-4" />
          {orphans.length} machine(s) are running in Azure with no active session. Reclaim them to stop the spend.
        </p>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search machines" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={templateFilter} onValueChange={setTemplateFilter}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Template" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All templates</SelectItem>
                {summaries.map((s) => (
                  <SelectItem key={s.templateId} value={s.templateId}>{s.templateName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={connectionFilter} onValueChange={setConnectionFilter}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Cloud connection" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All connections</SelectItem>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(POOL_STATUS_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
                <SelectItem value="ORPHAN">Orphaned</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">
              <Switch id="auto-refresh" checked={auto} onCheckedChange={setAuto} />
              <Label htmlFor="auto-refresh" className="text-xs text-muted-foreground">
                Live updates{live.lastUpdatedAt ?? lastRefresh ? ` · ${(live.lastUpdatedAt ?? lastRefresh)!.toLocaleTimeString()}` : ""}
              </Label>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Machine</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Backing</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead>Azure</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Loading pool…</TableCell></TableRow>
              ) : null}
              {filtered.map((vm) => (
                <TableRow key={vm.id}>
                  <TableCell>
                    <span className="font-medium">{vm.name}</span>
                    <span className="block text-xs text-muted-foreground">{vm.vmSize} · {vm.region}</span>
                  </TableCell>
                  <TableCell className="text-sm">{vm.templateName}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[vm.status] ?? "outline"}>{POOL_STATUS_LABEL[vm.status]}</Badge>
                    {vm.orphaned ? <Badge variant="destructive" className="ml-2">Orphan</Badge> : null}
                    <span className="mt-1 block text-xs text-muted-foreground">{vm.powerState}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={kinds[vm.id] === "azure" ? "secondary" : kinds[vm.id] === "mock" ? "outline" : "destructive"}>
                      {POOL_KIND_LABEL[kinds[vm.id] ?? (vm.mock ? "mock" : "azure")]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{vm.assignedUserName ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="block">{vm.resourceGroup} · {vm.powerState}</span>
                    <span className="block">
                      Event: {vm.lastAzureEventAt ? new Date(vm.lastAzureEventAt).toLocaleTimeString() : "—"}
                      {vm.lastEventType ? ` · ${AZURE_EVENT_KIND_LABEL[vm.lastEventType as AzureEventKind] ?? vm.lastEventType}` : ""}
                    </span>
                    <span className="block">
                      Synced: {vm.lastSyncedAt ? new Date(vm.lastSyncedAt).toLocaleTimeString() : "—"} ·{" "}
                      {AZURE_STATE_SOURCE_LABEL[(vm.lastEventSource as AzureStateSource) ?? "unknown"] ?? "Not observed yet"}
                    </span>
                    {vm.azureMissing ? (
                      <Badge variant="destructive" className="mt-1">Missing in Azure</Badge>
                    ) : vm.driftDetected ? (
                      <Badge variant="destructive" className="mt-1" title={vm.driftDetail ?? undefined}>Drift</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={busyVm === vm.id}>
                          {busyVm === vm.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <MoreHorizontal className="h-4 w-4" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>Power</DropdownMenuLabel>
                        <DropdownMenuItem
                          disabled={!STARTABLE.has(vm.status)}
                          onSelect={() => void act(vm, "start")}
                        >
                          <Power className="mr-2 h-4 w-4" /> Start VM
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!STOPPABLE.has(vm.status) || Boolean(vm.currentSessionId)}
                          onSelect={() => void act(vm, "stop")}
                        >
                          <PowerOff className="mr-2 h-4 w-4" /> Stop VM
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={vm.status === "RETIRED" || Boolean(vm.currentSessionId)}
                          onSelect={() => void act(vm, "restart")}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" /> Restart VM
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Diagnostics</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => void act(vm, "sync")}>
                          <RefreshCw className="mr-2 h-4 w-4" /> Refresh status
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void runAzureTest(vm)}>
                          <ShieldCheck className="mr-2 h-4 w-4" /> Test Azure status
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void runRdpTest(vm)}>
                          <ShieldCheck className="mr-2 h-4 w-4" /> Test remote desktop
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Allocation</DropdownMenuLabel>
                        <DropdownMenuItem
                          disabled={Boolean(vm.currentSessionId)}
                          onSelect={() => setAssignVm(vm)}
                        >
                          <UserCog className="mr-2 h-4 w-4" /> Assign workspace / learner
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!vm.currentSessionId}
                          onSelect={() => void act(vm, "release")}
                        >
                          <Undo2 className="mr-2 h-4 w-4" /> Release session
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!vm.orphaned}
                          onSelect={() => void act(vm, "reclaim")}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" /> Reclaim orphan
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Lifecycle</DropdownMenuLabel>
                        {vm.status === "RETIRED" ? (
                          <DropdownMenuItem onSelect={() => void act(vm, "restore")}>
                            <Undo2 className="mr-2 h-4 w-4" /> Return to service
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled={Boolean(vm.currentSessionId)}
                            onSelect={() => void act(vm, "retire")}
                          >
                            <Ban className="mr-2 h-4 w-4" /> Retire VM
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          disabled={Boolean(vm.currentSessionId)}
                          onSelect={() => void remove(vm)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Unregister from SkillTrack
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No machines match this search.</TableCell></TableRow>
              ) : null}
            </TableBody>
          </Table>

          <p className="text-xs text-muted-foreground">
            Dynamic provisioning from gallery images is {dynamic ? "enabled" : "disabled"} — capacity comes from
            pre-created machines registered above.
          </p>
        </CardContent>
      </Card>

      <VmAssignDialog
        vm={assignVm}
        workspaces={workspaces}
        saving={busyVm === assignVm?.id}
        onOpenChange={(open) => { if (!open) setAssignVm(null); }}
        onSave={async (input) => {
          const target = assignVm;
          if (!target) return;
          await act(target, "assign-user-lab", input);
          setAssignVm(null);
        }}
      />

      <VmRdpTestDialog
        open={Boolean(rdpVm)}
        onOpenChange={(open) => { if (!open) { setRdpVm(null); setRdpResult(null); } }}
        vmName={rdpVm?.name ?? ""}
        running={rdpRunning}
        result={rdpResult}
        onRerun={() => { if (rdpVm) void runRdpTest(rdpVm); }}
      />

      <VmPoolRegisterWizard
        open={wizard}
        onOpenChange={setWizard}
        templates={templates}
        onRegistered={(vm) => {
          setVms((list) => [vm, ...list]);
          void load();
          toast.success(`${vm.azureVmName} registered.`);
        }}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
