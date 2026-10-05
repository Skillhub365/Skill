import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCcwDot, Radio, RadioTower } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { friendlyFrom } from "@/lib/errors";
import { runReconciliation, type AzureEventStatusResponse } from "@/lib/cloud/events/client";
import { AZURE_EVENT_KIND_LABEL, AZURE_STATE_SOURCE_LABEL } from "@/lib/cloud/events/types";

function when(value: string | null | undefined) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "never" : date.toLocaleString();
}

/**
 * Live-integration banner: whether Azure Event Grid is actually delivering,
 * when the last event and reconciliation happened, and any drift found.
 * When Event Grid is not configured this says so plainly rather than implying
 * the subscription is live.
 */
export function AzureLiveStatusPanel({
  status,
  onReconciled,
  canReconcile = true,
}: {
  status: AzureEventStatusResponse | null;
  onReconciled?: () => void;
  canReconcile?: boolean;
}) {
  const [running, setRunning] = useState(false);
  if (!status) return null;

  const drift = status.statuses.reduce((sum, s) => sum + s.driftCount, 0);
  const live = status.statuses.some((s) => s.liveConnected);

  const reconcile = async () => {
    setRunning(true);
    try {
      const { summary } = await runReconciliation();
      toast.success(
        `Reconciled ${summary.vmsChecked} machine(s): ${summary.corrected} corrected, ${summary.orphans} orphaned, ${summary.missing} missing.`,
      );
      onReconciled?.();
    } catch (e) {
      toast.error(friendlyFrom(e).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <Badge variant="secondary" className="gap-1">
              <RadioTower className="h-3 w-3" /> Event Grid live
            </Badge>
          ) : status.eventGridConfigured ? (
            <Badge variant="outline" className="gap-1">
              <Radio className="h-3 w-3" /> Event Grid configured — no events received yet
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Event Grid not configured
            </Badge>
          )}
          {drift ? <Badge variant="destructive">{drift} drift warning(s)</Badge> : null}
          <span className="text-xs text-muted-foreground">
            Last reconciliation: {when(status.lastReconcile?.finishedAt ?? null)}
          </span>
          {canReconcile ? (
            <Button size="sm" variant="outline" className="ml-auto" disabled={running} onClick={() => void reconcile()}>
              {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCcwDot className="mr-2 h-3 w-3" />}
              Reconcile with Azure
            </Button>
          ) : null}
        </div>

        {!status.eventGridConfigured ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            Azure is not pushing state changes to SkillTrack. VM state is only as fresh as the last manual sync or
            reconciliation run. Configure the Event Grid subscription and ingest key to get live updates.
          </p>
        ) : null}

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {status.statuses.map((s) => (
            <div key={s.connectionId} className="rounded-md border p-2 text-xs">
              <p className="font-medium text-foreground">{s.connectionName}</p>
              <p className="text-muted-foreground">
                Last Azure event: {when(s.lastEventAt)}
                {s.lastEventKind ? ` · ${AZURE_EVENT_KIND_LABEL[s.lastEventKind]}` : ""}
              </p>
              <p className="text-muted-foreground">Last sync: {when(s.lastSyncAt)}</p>
              <p className="text-muted-foreground">Last reconciliation: {when(s.lastReconciledAt)}</p>
              <p className="text-muted-foreground">
                Source: {AZURE_STATE_SOURCE_LABEL[s.lastEventSource]} · {s.eventsReceived} received
                {s.eventsRejected ? ` · ${s.eventsRejected} rejected` : ""}
              </p>
              {s.driftCount ? <p className="text-destructive">{s.driftCount} machine(s) drifting from Azure.</p> : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}