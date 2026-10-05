import { useCallback, useEffect, useState } from "react";
import { Cloud, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import * as cloud from "@/lib/cloud/connections/client";
import { maskId, type AzureVirtualMachine } from "@/lib/cloud/connections/types";

/**
 * Workspace-scoped Azure view: only the connection and resource group this
 * workspace is mapped to, plus the power state of the VMs inside it.
 */
export function WorkspaceCloudResources({ workspaceId }: { workspaceId: string }) {
  const [scope, setScope] = useState<cloud.WorkspaceCloudScope | null>(null);
  const [vms, setVms] = useState<AzureVirtualMachine[]>([]);
  const [schedule, setSchedule] = useState<cloud.RefreshSchedule | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await cloud.fetchWorkspaceResources(workspaceId);
      setScope(data.scope);
      setVms(data.virtualMachines);
      setSchedule(data.schedule);
    } catch {
      setScope(null);
      setVms([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // The server keeps inventory warm on a timer; re-read it so the table follows.
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Azure resources</CardTitle>
          <CardDescription>
            {scope
              ? `${scope.connectionName} · ${scope.resourceGroup || "no resource group"} · ${scope.region || "region unset"}`
              : "This workspace is not mapped to a cloud subscription yet."}
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          Reload
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {scope ? (
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <Detail label="Subscription" value={scope.subscriptionName ?? maskId(scope.subscriptionId)} />
            <Detail label="Resource group" value={scope.resourceGroup || "—"} />
            <Detail
              label="Last sync"
              value={scope.lastSyncAt ? new Date(scope.lastSyncAt).toLocaleString() : "Never"}
            />
          </div>
        ) : null}

        {schedule?.enabled ? (
          <p className="text-xs text-muted-foreground">
            Auto refresh every {Math.round(schedule.intervalMs / 60000)} min
            {schedule.nextRunAt ? ` · next ${new Date(schedule.nextRunAt).toLocaleTimeString()}` : ""}
          </p>
        ) : null}

        {vms.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Virtual machine</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Power state</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vms.map((vm) => (
                <TableRow key={vm.id}>
                  <TableCell className="font-medium">{vm.name}</TableCell>
                  <TableCell>{vm.location}</TableCell>
                  <TableCell>{vm.vmSize}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        /running/i.test(vm.powerState)
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                          : ""
                      }
                    >
                      {vm.powerState}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
            <Cloud className="h-7 w-7" />
            <p>
              {scope
                ? "No virtual machines in this workspace's resource group yet."
                : "Map this workspace to a cloud connection to see its Azure resources."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-[11px] uppercase tracking-wide">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  );
}
