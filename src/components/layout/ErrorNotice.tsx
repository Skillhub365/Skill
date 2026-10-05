import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeError, friendlyFrom, type FriendlyError } from "@/lib/errors";
import type { SecurityErrorCode } from "@/lib/security/types";
import { cn } from "@/lib/utils";

/** Calm, non-technical failure surface used everywhere in the learner flow. */
export function ErrorNotice({
  code,
  error,
  onRetry,
  actionLabel,
  className,
}: {
  code?: SecurityErrorCode | undefined;
  error?: unknown;
  onRetry?: (() => void) | undefined;
  actionLabel?: string | undefined;
  className?: string | undefined;
}) {
  const friendly: FriendlyError = code ? describeError(code) : friendlyFrom(error);
  return (
    <div className={cn("rounded-xl border border-destructive/30 bg-destructive/5 p-5", className)}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{friendly.title}</p>
          <p className="text-sm text-muted-foreground">{friendly.message}</p>
          {onRetry && (
            <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
              {actionLabel ?? friendly.action ?? "Try again"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}