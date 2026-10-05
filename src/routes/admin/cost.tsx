import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Wallet, TrendingUp, Server, Building2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { StatCard } from "@/components/layout/StatCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCatalog } from "@/lib/store";

export const Route = createFileRoute("/admin/cost")({
  head: () => ({
    meta: [
      { title: "Cost Management — SkillTrack Labs Super Admin" },
      { name: "description", content: "Track lab compute spend by workspace, VM size and cloud region." },
      { property: "og:title", content: "Cost Management — SkillTrack Labs" },
      { property: "og:description", content: "Super Admin view of estimated cloud spend across all workspaces." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth role="superadmin">
      <CostPage />
    </RequireAuth>
  ),
});

/** Indicative on-demand rates (USD / hour) used for estimated spend. */
const RATE: Record<string, number> = {
  Standard_B2ms: 0.083,
  Standard_D2s_v5: 0.096,
  Standard_D4s_v5: 0.192,
  Standard_D8s_v5: 0.384,
  Standard_E4s_v5: 0.252,
};

const RUNNING = ["STARTING", "BOOTING", "RUNNING", "READINESS_CHECK", "READY"];

function rateFor(size: string) {
  return RATE[size] ?? 0.12;
}

function usd(value: number) {
  return `$${value.toFixed(2)}`;
}

function CostPage() {
  const { vms, workspaces, sessions } = useCatalog();

  const rows = useMemo(() => {
    return workspaces.map((w) => {
      const wsVms = vms.filter((v) => v.workspaceId === w.id);
      const running = wsVms.filter((v) => RUNNING.includes(v.status));
      const hourly = running.reduce((sum, v) => sum + rateFor(v.size), 0);
      // Monthly projection assumes each lab VM runs a 2h session per weekday.
      const projected = wsVms.reduce((sum, v) => sum + rateFor(v.size) * 2 * 22, 0);
      return { workspace: w, vms: wsVms.length, running: running.length, hourly, projected };
    });
  }, [vms, workspaces]);

  const hourlyTotal = rows.reduce((s, r) => s + r.hourly, 0);
  const projectedTotal = rows.reduce((s, r) => s + r.projected, 0);
  const runningTotal = rows.reduce((s, r) => s + r.running, 0);
  const activeSessions = sessions.filter((s) => s.status === "active").length;

  const bySize = useMemo(() => {
    const map = new Map<string, { size: string; count: number; hourly: number }>();
    for (const vm of vms) {
      const entry = map.get(vm.size) ?? { size: vm.size, count: 0, hourly: 0 };
      entry.count += 1;
      if (RUNNING.includes(vm.status)) entry.hourly += rateFor(vm.size);
      map.set(vm.size, entry);
    }
    return [...map.values()].sort((a, b) => b.hourly - a.hourly);
  }, [vms]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cost Management"
        description="Estimated cloud spend across every subscription and workspace. Owned by the Super Admin persona."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Current burn rate" value={`${usd(hourlyTotal)}/hr`} hint="Running lab VMs" icon={Wallet} />
        <StatCard label="Projected monthly" value={usd(projectedTotal)} hint="2h/day × 22 days" icon={TrendingUp} />
        <StatCard label="Running VMs" value={String(runningTotal)} hint={`${vms.length} provisioned`} icon={Server} />
        <StatCard label="Active sessions" value={String(activeSessions)} hint="Billable right now" icon={Building2} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Spend by workspace</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>VMs</TableHead>
                <TableHead>Running</TableHead>
                <TableHead className="text-right">Burn rate</TableHead>
                <TableHead className="text-right">Projected month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.workspace.id}>
                  <TableCell className="font-medium">{r.workspace.name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.workspace.org}</TableCell>
                  <TableCell>{r.vms}</TableCell>
                  <TableCell>
                    <Badge variant={r.running > 0 ? "default" : "secondary"}>{r.running}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{usd(r.hourly)}/hr</TableCell>
                  <TableCell className="text-right">{usd(r.projected)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Rate card by VM size</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>VM size</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Provisioned</TableHead>
                <TableHead className="text-right">Current burn</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bySize.map((s) => (
                <TableRow key={s.size}>
                  <TableCell className="font-medium">{s.size}</TableCell>
                  <TableCell className="text-muted-foreground">{usd(rateFor(s.size))}/hr</TableCell>
                  <TableCell>{s.count}</TableCell>
                  <TableCell className="text-right">{usd(s.hourly)}/hr</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}