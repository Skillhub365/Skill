import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import * as cloud from "@/lib/cloud/connections/client";
import { healthTone, type ConnectionHealth } from "@/lib/cloud/connections/health-types";

const SOURCE_LABEL: Record<string, string> = {
  "manual-test": "Test connection",
  "manual-refresh": "Manual refresh",
  "scheduled-refresh": "Scheduled refresh",
  validation: "Credential validation",
};

/**
 * Health diagnostics for a single cloud connection: every recorded probe,
 * a rolling success rate and any failure code that keeps coming back.
 */
export function ConnectionHealthPanel({ connectionId }: { connectionId: string }) {
  const [health, setHealth] = useState<ConnectionHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await cloud.fetchHealth(connectionId);
      setHealth(data.health[0] ?? null);
    } catch {
      /* the page surfaces connection errors already */
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    setLoading(true);
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !health) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading health history…
      </p>
    );
  }

  if (!health || health.total === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
        <Activity className="h-8 w-8" />
        <p>No health data yet. Test the connection or wait for the next scheduled refresh.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className={`${healthTone(health.verdict)} capitalize`}>
          {health.verdict}
        </Badge>
        <Metric label="Success rate" value={`${health.successRate}%`} />
        <Metric label="Probes" value={String(health.total)} />
        <Metric label="Failures" value={String(health.failures)} />
        <Metric label="Consecutive failures" value={String(health.consecutiveFailures)} />
        <Metric label="Avg latency" value={`${health.averageLatencyMs} ms`} />
        <Metric
          label="Last success"
          value={health.lastOkAt ? new Date(health.lastOkAt).toLocaleString() : "never"}
        />
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" /> Reload
        </Button>
      </div>

      {health.recurring.length ? (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-700">
            <AlertTriangle className="h-4 w-4" /> Recurring failures
          </p>
          <ul className="space-y-1 text-xs text-amber-800">
            {health.recurring.map((failure) => (
              <li key={failure.status}>
                <span className="font-mono">{failure.status}</span> — seen {failure.count} times, first{" "}
                {new Date(failure.firstSeen).toLocaleString()}, last {new Date(failure.lastSeen).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {health.samples.map((sample) => (
            <TableRow key={sample.id}>
              <TableCell className="whitespace-nowrap text-xs">{new Date(sample.at).toLocaleString()}</TableCell>
              <TableCell className="text-xs">{SOURCE_LABEL[sample.source] ?? sample.source}</TableCell>
              <TableCell>
                <Badge variant="outline" className={healthTone(sample.ok ? "healthy" : "failing")}>
                  {sample.ok ? "success" : "failure"}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-[11px]">{sample.status}</TableCell>
              <TableCell className="text-xs">{sample.latencyMs} ms</TableCell>
              <TableCell className="max-w-[24rem] truncate text-xs text-muted-foreground">
                {sample.message ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
