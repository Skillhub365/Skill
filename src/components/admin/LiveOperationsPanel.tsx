import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

type Severity = "ok" | "warning" | "critical";

interface Item {
  id: string;
  label: string;
  detail: string;
}

interface Counter {
  key: string;
  label: string;
  value: number;
  severity: Severity;
  detail: string;
  items: Item[];
}

interface Snapshot {
  generatedAt: string;
  degraded: boolean;
  counters: Counter[];
  reaper: { enabled: boolean; lastRunAt: string | null; status: string | null; failures: number; reclaimed: number; stale: boolean; detail: string };
  capacity: { total: number; available: number; inUse: number; error: number; severity: Severity; detail: string };
  budget: { monthlyBudgetUsd: number | null; estimatedSpendUsd: number; projectedSpendUsd: number; percentUsed: number | null; severity: Severity; detail: string };
}

const TONE: Record<Severity, string> = {
  ok: "secondary",
  warning: "outline",
  critical: "destructive",
};

/** Right-now view of sessions, machines, cleanup, capacity and spend. */
export function LiveOperationsPanel() {
  const { authHeaders } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/operational-state", { headers: authHeaders() });
      if (!res.ok) throw new Error("failed");
      setSnapshot((await res.json()) as Snapshot);
      setError(null);
    } catch {
      setError("The live operational snapshot could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {snapshot ? `Snapshot taken ${new Date(snapshot.generatedAt).toLocaleTimeString()}` : "Loading live state…"}
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(snapshot?.counters ?? []).map((counter) => (
          <Card key={counter.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
                {counter.label}
                <Badge variant={TONE[counter.severity] as "secondary" | "outline" | "destructive"}>{counter.value}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">{counter.detail}</p>
              {counter.items.length ? (
                <ul className="space-y-1 text-xs">
                  {counter.items.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <span className="font-medium">{item.label}</span> — {item.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pool capacity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-2xl font-semibold">
              {snapshot ? `${snapshot.capacity.available}/${snapshot.capacity.total}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground">{snapshot?.capacity.detail ?? ""}</p>
            {snapshot && snapshot.capacity.severity !== "ok" ? (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="size-3" /> Low capacity — register or free machines before the next cohort.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cleanup reaper</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="flex items-center gap-2 text-2xl font-semibold">
              {snapshot?.reaper.enabled && !snapshot.reaper.stale ? (
                <CheckCircle2 className="size-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="size-5 text-destructive" />
              )}
              {snapshot?.reaper.enabled ? (snapshot.reaper.stale ? "Stale" : "Healthy") : "Disabled"}
            </p>
            <p className="text-xs text-muted-foreground">{snapshot?.reaper.detail ?? ""}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Budget this month</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-2xl font-semibold">
              {snapshot ? `$${snapshot.budget.estimatedSpendUsd.toFixed(2)}` : "—"}
              {snapshot?.budget.percentUsed != null ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">{snapshot.budget.percentUsed}% of budget</span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">{snapshot?.budget.detail ?? ""}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
