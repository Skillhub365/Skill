import { Clock, Loader2, Square, TimerReset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTimer, TIMER_TIER_CLASS, type TimerTier } from "@/lib/session/types";

export function SessionTimer({
  remainingMs,
  tier,
  extendable,
  busy,
  onExtend,
  onStop,
  compact = false,
}: {
  remainingMs: number;
  tier: TimerTier;
  extendable: number;
  busy: boolean;
  onExtend: () => void;
  onStop: () => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-sm font-semibold tabular-nums ${TIMER_TIER_CLASS[tier]}`}
        aria-live="polite"
        aria-label="Time remaining in this session"
      >
        <Clock className="size-3.5 opacity-70" /> {formatTimer(remainingMs)}
      </span>
      <Button variant="outline" size="sm" onClick={onExtend} disabled={busy || extendable <= 0}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <TimerReset className="size-3.5" />}
        {compact ? "Extend" : "Extend session"}
      </Button>
      <Button variant="destructive" size="sm" onClick={onStop} disabled={busy}>
        <Square className="size-3.5" /> Stop Lab
      </Button>
    </div>
  );
}
