import { useCallback, useEffect, useState } from "react";
import { Pause, Play, Timer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as cloud from "@/lib/cloud/connections/client";
import { REFRESH_INTERVAL_CHOICES, type ConnectionSchedule } from "@/lib/cloud/connections/health-types";

/** Pause/resume automatic refresh for one connection and set its own interval. */
export function RefreshScheduleControls({
  connectionId,
  canManage,
}: {
  connectionId: string;
  canManage: boolean;
}) {
  const [schedule, setSchedule] = useState<ConnectionSchedule | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { schedule: next } = await cloud.getConnectionSchedule(connectionId);
      setSchedule(next);
    } catch {
      /* handled by the page-level error surface */
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  async function patch(next: { paused?: boolean; intervalMs?: number }, message: string) {
    setSaving(true);
    try {
      const { schedule: updated } = await cloud.setConnectionSchedule(connectionId, next);
      setSchedule(updated);
      toast.success(message);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!schedule) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
      <Timer className="h-3.5 w-3.5 text-muted-foreground" />
      <Badge variant="outline" className={schedule.paused ? "" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"}>
        {schedule.paused ? "Auto refresh paused" : "Auto refresh on"}
      </Badge>
      <Select
        value={String(schedule.intervalMs)}
        onValueChange={(v) => void patch({ intervalMs: Number(v) }, "Refresh interval updated.")}
        disabled={!canManage || saving}
      >
        <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {REFRESH_INTERVAL_CHOICES.map((choice) => (
            <SelectItem key={choice.value} value={String(choice.value)}>Every {choice.label}</SelectItem>
          ))}
          {REFRESH_INTERVAL_CHOICES.every((c) => c.value !== schedule.intervalMs) ? (
            <SelectItem value={String(schedule.intervalMs)}>
              Every {Math.round(schedule.intervalMs / 1000)}s
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={!canManage || saving}
        onClick={() =>
          void patch(
            { paused: !schedule.paused },
            schedule.paused ? "Automatic refresh resumed." : "Automatic refresh paused.",
          )
        }
      >
        {schedule.paused ? <Play className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}
        {schedule.paused ? "Resume" : "Pause"}
      </Button>
      <span className="text-muted-foreground">
        Last {schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleTimeString() : "never"}
        {" · "}
        Next {schedule.paused ? "—" : schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleTimeString() : "—"}
        {schedule.lastOutcome ? ` · last run ${schedule.lastOutcome}` : ""}
      </span>
    </div>
  );
}
