import { RequireAuth } from "@/components/layout/RequireAuth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Cloud,
  Link2,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AzureConnectionDialog } from "@/components/admin/AzureConnectionDialog";
import { CloudAuditLog } from "@/components/admin/CloudAuditLog";
import { ConnectionHealthPanel } from "@/components/admin/ConnectionHealthPanel";
import { AzureInfrastructurePanel } from "@/components/admin/AzureInfrastructurePanel";
import { RefreshScheduleControls } from "@/components/admin/RefreshScheduleControls";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/security/types";
import { useCatalog } from "@/lib/store";
import { RealtimeStatusBadge } from "@/components/realtime/RealtimeStatusBadge";
import { useLiveRefresh } from "@/lib/realtime/hooks";
import { AzureLiveStatusPanel } from "@/components/admin/AzureLiveStatusPanel";
import { useAzureEventStatus } from "@/lib/cloud/events/client";
import { AZURE_STATE_SOURCE_LABEL } from "@/lib/cloud/events/types";
import * as cloud from "@/lib/cloud/connections/client";
import {
  CONNECTION_STATUS_LABEL,
  maskId,
  type AzureInventory,
  type CloudConnection,
  type CloudConnectionStatus,
  type WorkspaceCloudLink,
} from "@/lib/cloud/connections/types";

export const Route = createFileRoute("/admin/cloud/connections")({
  component: () => (
    <RequireAuth role="superadmin">
      <CloudConnectionsPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Cloud Connections — SkillTrack Labs Admin" },
      {
        name: "description",
        content: "Connect and manage real Azure subscriptions that power SkillTrack Labs lab environments.",
      },
      { property: "og:title", content: "Cloud Connections — SkillTrack Labs Admin" },
      {
        property: "og:description",
        content: "Manage Azure subscriptions, resource groups and virtual machines used by SkillTrack Labs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const statusTone: Record<CloudConnectionStatus, string> = {
  CONNECTED: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  AUTHENTICATION_ERROR: "bg-destructive/10 text-destructive border-destructive/30",
  PERMISSION_ERROR: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  SUBSCRIPTION_ERROR: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  UNAVAILABLE: "bg-muted text-muted-foreground border-border",
  DISCONNECTED: "bg-muted text-muted-foreground border-border",
};

function CloudConnectionsPage() {
  const { workspaces } = useCatalog();
  const { user } = useAuth();
  // Managing subscriptions and VM power state are separate admin capabilities.
  const canManage = can(user?.role, "cloud:manage");
  const canManageVms = can(user?.role, "vm:manage");
  const [connections, setConnections] = useState<CloudConnection[]>([]);
  const [links, setLinks] = useState<WorkspaceCloudLink[]>([]);
  const [secretStore, setSecretStore] = useState("");
  const [schedule, setSchedule] = useState<cloud.RefreshSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CloudConnection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inventory, setInventory] = useState<AzureInventory | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [eventKey, setEventKey] = useState(0);
  const eventStatus = useAzureEventStatus(eventKey);

  const readRef = useRef<() => Promise<unknown>>(async () => undefined);

  const load = useCallback(async () => {
    try {
      const data = await cloud.fetchConnections();
      setConnections(data.connections);
      setLinks(data.links);
      setSecretStore(data.secretStore);
      setSchedule(data.schedule ?? null);
      setSelectedId((current) => current ?? data.connections[0]?.id ?? null);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Connection health and cached Azure inventory both live in the database, so
  // realtime pushes health/power-state changes; the 30s poll is only fallback.
  const live = useLiveRefresh({
    tables: ["cloud_connections", "cloud_inventory"],
    refresh: async () => {
      await load();
      await readRef.current();
    },
    fallbackMs: 30_000,
    liveHeartbeatMs: 300_000,
    debounceMs: 800,
  });
  const inventoryPollMs = live.live ? 300_000 : 30_000;

  const selected = useMemo(
    () => connections.find((c) => c.id === selectedId) ?? null,
    [connections, selectedId],
  );

  // The server refreshes Azure on a schedule; re-read the cache so the table
  // follows power-state changes without anyone pressing Refresh Resources.
  useEffect(() => {
    if (!selectedId) {
      setInventory(null);
      return;
    }
    const read = () =>
      cloud
        .getResources(selectedId)
        .then((data) => {
          setInventory(data.inventory);
          if (data.schedule) setSchedule(data.schedule);
        })
        .catch(() => undefined);
    void read();
    readRef.current = read;
    const timer = setInterval(() => void read(), inventoryPollMs);
    return () => clearInterval(timer);
  }, [selectedId, inventoryPollMs]);

  const upsert = (connection: CloudConnection) =>
    setConnections((list) => {
      const exists = list.some((c) => c.id === connection.id);
      setSelectedId(connection.id);
      return exists ? list.map((c) => (c.id === connection.id ? connection : c)) : [...list, connection];
    });

  async function run(id: string, key: string, task: () => Promise<void>) {
    setBusy(`${id}:${key}`);
    try {
      await task();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const test = (connection: CloudConnection) =>
    run(connection.id, "test", async () => {
      const { connection: updated, result } = await cloud.testConnection(connection.id);
      upsert(updated);
      result.ok ? toast.success("Connection verified against Azure.") : toast.error(result.message);
    });

  const refresh = (connection: CloudConnection) =>
    run(connection.id, "refresh", async () => {
      const { connection: updated, inventory: fresh } = await cloud.refreshResources(connection.id);
      upsert(updated);
      setInventory(fresh);
      toast.success(`Loaded ${fresh.resourceGroups.length} resource groups and ${fresh.virtualMachines.length} VMs.`);
    });

  const disconnect = (connection: CloudConnection) =>
    run(connection.id, "delete", async () => {
      await cloud.deleteConnection(connection.id);
      setConnections((list) => list.filter((c) => c.id !== connection.id));
      setLinks((list) => list.filter((l) => l.cloudConnectionId !== connection.id));
      setSelectedId(null);
      toast.success("Connection removed and its secret purged.");
    });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cloud Connections</h1>
          <p className="text-sm text-muted-foreground">
            Every lab VM runs in one of these real Azure subscriptions. Credentials stay server-side
            {secretStore ? ` in the ${secretStore.replace(/-/g, " ")} store` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-3">
        <RealtimeStatusBadge status={live.status} lastUpdatedAt={live.lastUpdatedAt} />
        <Button
          disabled={!canManage}
          title={canManage ? undefined : "Your role cannot manage cloud connections."}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> Add Azure Subscription
        </Button>
        </div>
      </header>

      <AzureLiveStatusPanel
        status={eventStatus.data}
        canReconcile={canManage}
        onReconciled={() => {
          setEventKey((n) => n + 1);
          void load();
        }}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading connections…
        </div>
      ) : connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Cloud className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No cloud subscriptions connected</p>
              <p className="text-sm text-muted-foreground">
                Add a service principal to let SkillTrack start and stop real Azure virtual machines.
              </p>
            </div>
            <Button
              disabled={!canManage}
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Azure Subscription
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {connections.map((connection) => (
            <Card
              key={connection.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(connection.id)}
              onKeyDown={(e) => e.key === "Enter" && setSelectedId(connection.id)}
              className={connection.id === selectedId ? "border-primary/60 ring-1 ring-primary/20" : ""}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{connection.name}</CardTitle>
                    <CardDescription>{connection.subscriptionName ?? "Azure subscription"}</CardDescription>
                  </div>
                  <Badge variant="outline" className={statusTone[connection.status]}>
                    {CONNECTION_STATUS_LABEL[connection.status]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <Row label="Subscription" value={maskId(connection.subscriptionId)} />
                <Row label="Tenant" value={maskId(connection.tenantId)} />
                <Row label="Client ID" value={maskId(connection.clientId)} />
                <Row label="Secret" value="Stored in vault (reference only)" />
                <Row
                  label="Resources"
                  value={`${connection.resourceGroupCount} groups · ${connection.vmCount} VMs`}
                />
                {(() => {
                  const s = eventStatus.data?.statuses.find((x) => x.connectionId === connection.id);
                  if (!s) return null;
                  return (
                    <>
                      <Row
                        label="Last Azure event"
                        value={s.lastEventAt ? new Date(s.lastEventAt).toLocaleString() : "never"}
                      />
                      <Row label="Last sync" value={s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : "never"} />
                      <Row
                        label="Last reconciliation"
                        value={s.lastReconciledAt ? new Date(s.lastReconciledAt).toLocaleString() : "never"}
                      />
                      <Row label="State source" value={AZURE_STATE_SOURCE_LABEL[s.lastEventSource]} />
                      <Row
                        label="Azure health"
                        value={
                          s.liveConnected
                            ? "Live (Event Grid)"
                            : s.eventGridConfigured
                              ? "Configured, awaiting events"
                              : "Manual sync only"
                        }
                      />
                      {s.driftCount ? (
                        <p className="rounded bg-destructive/5 p-2 text-destructive">
                          {s.driftCount} machine(s) drifting from Azure state.
                        </p>
                      ) : null}
                    </>
                  );
                })()}
                {connection.statusDetail ? (
                  <p className="rounded bg-destructive/5 p-2 text-destructive">{connection.statusDetail}</p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" variant="outline" disabled={busy === `${connection.id}:test`} onClick={(e) => { e.stopPropagation(); void test(connection); }}>
                    {busy === `${connection.id}:test` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                    Test
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy === `${connection.id}:refresh`} onClick={(e) => { e.stopPropagation(); void refresh(connection); }}>
                    {busy === `${connection.id}:refresh` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                    Sync
                  </Button>
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(connection); setDialogOpen(true); }}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={(e) => { e.stopPropagation(); void disconnect(connection); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{selected.name}</CardTitle>
            <CardDescription>
              Live Azure inventory{inventory ? ` · synced ${new Date(inventory.syncedAt).toLocaleString()}` : " — not synced yet"}
              {schedule?.enabled
                ? ` · auto refresh every ${Math.round(schedule.intervalMs / 60000)} min${
                    schedule.nextRunAt ? ` (next ${new Date(schedule.nextRunAt).toLocaleTimeString()})` : ""
                  }`
                : " · auto refresh off"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <RefreshScheduleControls connectionId={selected.id} canManage={canManage} />
            </div>
            <Tabs defaultValue="vms">
              <TabsList>
                <TabsTrigger value="vms">Virtual machines</TabsTrigger>
                <TabsTrigger value="groups">Resource groups</TabsTrigger>
                <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
                <TabsTrigger value="health">Health</TabsTrigger>
                <TabsTrigger value="workspaces">Workspace mapping</TabsTrigger>
                <TabsTrigger value="audit">Audit log</TabsTrigger>
              </TabsList>

              <TabsContent value="vms" className="pt-4">
                {inventory?.virtualMachines.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Resource group</TableHead>
                        <TableHead>Region</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Power state</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inventory.virtualMachines.map((vm) => (
                        <TableRow key={vm.id}>
                          <TableCell className="font-medium">{vm.name}</TableCell>
                          <TableCell>{vm.resourceGroup}</TableCell>
                          <TableCell>{vm.location}</TableCell>
                          <TableCell>{vm.vmSize}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={/running/i.test(vm.powerState) ? statusTone.CONNECTED : ""}>
                              {vm.powerState}
                            </Badge>
                          </TableCell>
                          <TableCell className="space-x-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canManageVms || busy === `${selected.id}:vm:${vm.name}`}
                              onClick={() =>
                                run(selected.id, `vm:${vm.name}`, async () => {
                                  await cloud.vmAction(selected.id, "start", vm.resourceGroup, vm.name);
                                  toast.success(`Start requested for ${vm.name}.`);
                                  const { inventory: fresh } = await cloud.refreshResources(selected.id);
                                  setInventory(fresh);
                                })
                              }
                            >
                              <Power className="mr-1 h-3 w-3" /> Start
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canManageVms || busy === `${selected.id}:vm:${vm.name}`}
                              onClick={() =>
                                run(selected.id, `vm:${vm.name}`, async () => {
                                  await cloud.vmAction(selected.id, "stop", vm.resourceGroup, vm.name);
                                  toast.success(`Deallocation requested for ${vm.name}.`);
                                  const { inventory: fresh } = await cloud.refreshResources(selected.id);
                                  setInventory(fresh);
                                })
                              }
                            >
                              Stop
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyInventory onSync={() => void refresh(selected)} />
                )}
              </TabsContent>

              <TabsContent value="groups" className="pt-4">
                {inventory?.resourceGroups.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Resource group</TableHead>
                        <TableHead>Region</TableHead>
                        <TableHead>Provisioning state</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inventory.resourceGroups.map((group) => (
                        <TableRow key={group.name}>
                          <TableCell className="font-medium">{group.name}</TableCell>
                          <TableCell>{group.location}</TableCell>
                          <TableCell>{group.provisioningState ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyInventory onSync={() => void refresh(selected)} />
                )}
              </TabsContent>

              <TabsContent value="audit" className="pt-4">
                <CloudAuditLog connectionId={selected.id} onSchedule={setSchedule} />
              </TabsContent>

              <TabsContent value="infrastructure" className="pt-4">
                <AzureInfrastructurePanel
                  key={selected.id}
                  connectionId={selected.id}
                  defaultResourceGroup={inventory?.resourceGroups[0]?.name ?? null}
                  defaultRegion={inventory?.resourceGroups[0]?.location ?? null}
                  canManage={canManage}
                />
              </TabsContent>

              <TabsContent value="health" className="pt-4">
                <ConnectionHealthPanel connectionId={selected.id} />
              </TabsContent>

              <TabsContent value="workspaces" className="pt-4">
                <WorkspaceMapping
                  connection={selected}
                  connections={connections}
                  inventory={inventory}
                  links={links}
                  workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
                  onChange={setLinks}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <AzureConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connection={editing}
        onSaved={(connection) => {
          upsert(connection);
          toast.success(editing ? "Connection updated." : "Azure subscription connected.");
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono text-[11px] text-foreground/80">{value}</span>
    </div>
  );
}

function EmptyInventory({ onSync }: { onSync: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
      <Server className="h-8 w-8" />
      <p>No inventory cached yet. Sync to pull live resources from Azure.</p>
      <Button size="sm" variant="outline" onClick={onSync}>
        <RefreshCw className="mr-2 h-3.5 w-3.5" /> Sync resources
      </Button>
    </div>
  );
}

function WorkspaceMapping({
  connection,
  connections,
  inventory,
  links,
  workspaces,
  onChange,
}: {
  connection: CloudConnection;
  connections: CloudConnection[];
  inventory: AzureInventory | null;
  links: WorkspaceCloudLink[];
  workspaces: { id: string; name: string }[];
  onChange: (links: WorkspaceCloudLink[]) => void;
}) {
  const [workspaceId, setWorkspaceId] = useState("");
  const [resourceGroup, setResourceGroup] = useState(connection.defaultResourceGroup ?? "");
  const [region, setRegion] = useState(connection.defaultRegion ?? "");
  const [saving, setSaving] = useState(false);

  const nameFor = (id: string) => workspaces.find((w) => w.id === id)?.name ?? id;
  const connectionName = (id: string) => connections.find((c) => c.id === id)?.name ?? id;

  async function link() {
    if (!workspaceId) return;
    setSaving(true);
    try {
      const { link: created } = await cloud.linkWorkspace({
        workspaceId,
        cloudConnectionId: connection.id,
        resourceGroup,
        defaultRegion: region,
      });
      onChange([...links.filter((l) => l.workspaceId !== created.workspaceId), created]);
      setWorkspaceId("");
      toast.success(`${nameFor(created.workspaceId)} now provisions into ${connection.name}.`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function unlink(id: string) {
    try {
      await cloud.unlinkWorkspace(id);
      onChange(links.filter((l) => l.workspaceId !== id));
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const groups = inventory?.resourceGroups.map((g) => g.name) ?? [];
  const regions = inventory ? [...new Set(inventory.resourceGroups.map((g) => g.location))] : [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        A workspace can only provision into the subscription and resource group it is explicitly mapped to.
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Workspace</Label>
          <Select value={workspaceId} onValueChange={setWorkspaceId}>
            <SelectTrigger><SelectValue placeholder="Select workspace" /></SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Resource group</Label>
          {groups.length ? (
            <Select value={resourceGroup} onValueChange={setResourceGroup}>
              <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={resourceGroup} onChange={(e) => setResourceGroup(e.target.value)} placeholder="rg-skilltrack-labs" />
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Region</Label>
          {regions.length ? (
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
              <SelectContent>
                {regions.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="eastus" />
          )}
        </div>
        <div className="flex items-end">
          <Button className="w-full" onClick={() => void link()} disabled={!workspaceId || saving}>
            <Link2 className="mr-2 h-4 w-4" /> Map workspace
          </Button>
        </div>
      </div>

      {links.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Connection</TableHead>
              <TableHead>Resource group</TableHead>
              <TableHead>Region</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((l) => (
              <TableRow key={l.workspaceId}>
                <TableCell className="font-medium">{nameFor(l.workspaceId)}</TableCell>
                <TableCell>{connectionName(l.cloudConnectionId)}</TableCell>
                <TableCell>{l.resourceGroup || "—"}</TableCell>
                <TableCell>{l.defaultRegion || "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => void unlink(l.workspaceId)}>
                    <Unlink className="mr-1 h-3 w-3" /> Unmap
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No workspaces mapped yet.
        </p>
      )}
    </div>
  );
}
