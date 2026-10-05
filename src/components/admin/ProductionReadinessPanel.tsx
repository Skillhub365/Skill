import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { fetchReadiness, type ReadinessReportView, type ReadinessStatusView } from "@/lib/infra/readiness-client";

const STATUS_ICON: Record<ReadinessStatusView, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  skip: CircleDashed,
};

const STATUS_CLASS: Record<ReadinessStatusView, string> = {
  pass: "text-emerald-600",
  warn: "text-amber-600",
  fail: "text-destructive",
  skip: "text-muted-foreground",
};

/**
 * Live integration status plus the production cutover checklist.
 * Every value comes from a server-side probe — nothing is simulated here.
 */
export function ProductionReadinessPanel() {
  const { authHeaders } = useAuth();
  const [report, setReport] = useState<ReadinessReportView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchReadiness(authHeaders()));
      setError(null);
    } catch {
      setError("Readiness status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" /> Production readiness
          </CardTitle>
          <div className="flex items-center gap-2">
            {report ? (
              <Badge variant={report.productionReady ? "secondary" : "destructive"}>
                {report.productionReady ? "Ready" : "Not ready"}
              </Badge>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Re-check
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <p className="text-xs text-muted-foreground">
            Environment: <span className="font-medium capitalize text-foreground">{report?.environment ?? "…"}</span>
            {report ? ` · checked ${new Date(report.checkedAt).toLocaleString()}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">{report?.summary ?? "Probing integrations…"}</p>

          {report?.emergencyFallbackActive ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive">
              <p className="font-semibold">Emergency mock fallback is active</p>
              <p className="mt-1">
                Simulated infrastructure may be serving real users. Remove <code>ALLOW_MOCK_FALLBACK</code> from the
                deployment configuration and restart the service once the incident is resolved.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integration status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(report?.integrations ?? []).map((item) => {
              const good = item.fallback ? !item.connected : item.connected;
              return (
                <div key={item.key} className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 last:border-0">
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <Badge variant={good ? "secondary" : "destructive"} className="shrink-0">
                    {item.fallback ? (item.connected ? "Active" : "Inactive") : item.connected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
              );
            })}
            {!report && !error ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cutover checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(report?.checks ?? []).map((check) => {
              const Icon = STATUS_ICON[check.status];
              return (
                <div key={check.key} className="flex items-start gap-2 border-b border-border/50 pb-2 last:border-0">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${STATUS_CLASS[check.status]}`} />
                  <div>
                    <p className="font-medium">
                      {check.label}
                      {check.required ? null : <span className="ml-2 text-[10px] uppercase text-muted-foreground">optional</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{check.detail}</p>
                  </div>
                </div>
              );
            })}
            {!report && !error ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
