/**
 * Remote desktop (gateway) health banner.
 *
 * Tells an administrator, in plain language, whether learners can actually be
 * put on a real desktop right now — and where the chain breaks if not. The
 * server sends only pass/fail posture, so nothing here can leak an address,
 * credential or token.
 */
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, MonitorCheck, MonitorX, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { GatewayCheck, RemoteDesktopHealthReport } from "@/lib/remote-desktop/health-types";

function Icon({ status }: { status: GatewayCheck["status"] }) {
  if (status === "pass") return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" />;
  if (status === "fail") return <XCircle className="mt-0.5 h-3.5 w-3.5 text-destructive" />;
  if (status === "warn") return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" />;
  return <MinusCircle className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />;
}

export function RemoteDesktopHealthPanel({
  health,
  loading,
  onRefresh,
}: {
  health: RemoteDesktopHealthReport | null;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  if (!health) return null;
  const real = health.mode === "guacamole" && health.configured;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {real ? (
            <Badge variant={health.productionBlocked ? "destructive" : "secondary"} className="gap-1">
              <MonitorCheck className="h-3 w-3" />
              {health.productionBlocked ? "Remote desktop gateway degraded" : "Remote desktop gateway live"}
            </Badge>
          ) : (
            <Badge variant={health.environment === "development" ? "outline" : "destructive"} className="gap-1">
              <MonitorX className="h-3 w-3" />
              {health.environment === "development" ? "Simulated desktop (development)" : "Gateway not configured"}
            </Badge>
          )}
          {health.gatewayHost ? <Badge variant="outline">{health.gatewayHost}</Badge> : null}
          <Badge variant="outline">Clipboard: {health.clipboard}</Badge>
          {health.emergencyFallbackActive ? <Badge variant="destructive">Mock fallback enabled</Badge> : null}
          <span className="text-xs text-muted-foreground">
            Checked {new Date(health.checkedAt).toLocaleTimeString()} · {health.durationMs} ms
          </span>
          {onRefresh ? (
            <Button size="sm" variant="outline" className="ml-auto" disabled={loading} onClick={onRefresh}>
              {loading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
              Re-check gateway
            </Button>
          ) : null}
        </div>

        <p className="text-sm">{health.summary}</p>

        {health.productionBlocked ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            Learners will see a clear connection failure instead of a simulated desktop. Fix the failing checks below
            before publishing labs on this environment.
          </p>
        ) : null}

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {health.checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2 rounded-md border p-2 text-xs">
              <Icon status={c.status} />
              <div>
                <p className="font-medium text-foreground">{c.label}</p>
                <p className="text-muted-foreground">{c.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Gateway call budget {health.requestTimeoutMs} ms · desktop connect budget {health.connectTimeoutMs} ms ·{" "}
          {health.lastTest
            ? `last RDP test ${health.lastTest.ok ? "passed" : "failed"} on ${health.lastTest.machine} at ${new Date(
                health.lastTest.at,
              ).toLocaleString()}${health.lastTest.cleanedUp ? "" : " — test objects left on the gateway"}`
            : "no RDP test has been run on this instance yet"}
        </p>
      </CardContent>
    </Card>
  );
}
