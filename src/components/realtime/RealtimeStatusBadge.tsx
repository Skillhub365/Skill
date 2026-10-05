import { Loader2, RadioTower, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RealtimeStatus } from "@/lib/realtime/useRealtimeTable";

interface Props {
  status: RealtimeStatus;
  lastUpdatedAt?: Date | null;
  className?: string;
}

const COPY: Record<RealtimeStatus, { label: string; hint: string }> = {
  live: { label: "Live via Cloud", hint: "Streaming database changes" },
  connecting: { label: "Connecting…", hint: "Opening the realtime channel" },
  reconnecting: { label: "Reconnecting", hint: "Realtime dropped, retrying" },
  fallback: { label: "Fallback polling", hint: "Realtime unavailable, polling the API" },
};

/** Small indicator showing whether the screen is realtime-connected. */
export function RealtimeStatusBadge({ status, lastUpdatedAt, className }: Props) {
  const copy = COPY[status];
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <Badge
        variant={status === "live" ? "default" : status === "fallback" ? "secondary" : "outline"}
        className="gap-1 font-normal"
        title={copy.hint}
      >
        {status === "live" ? (
          <RadioTower className="size-3" />
        ) : status === "fallback" ? (
          <WifiOff className="size-3" />
        ) : (
          <Loader2 className="size-3 animate-spin" />
        )}
        {copy.label}
      </Badge>
      {lastUpdatedAt ? <span>Updated {lastUpdatedAt.toLocaleTimeString()}</span> : null}
    </span>
  );
}
