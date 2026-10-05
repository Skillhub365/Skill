import type { ComponentType } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }> | undefined;
}) {
  return (
    <Card className="border-border shadow-none transition-shadow hover:shadow-[var(--shadow-card)]">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Icon className="size-5" />
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function StatusDot({ tone }: { tone: "running" | "idle" | "error" }) {
  const cls =
    tone === "running" ? "bg-success" : tone === "idle" ? "bg-muted-foreground" : "bg-destructive";
  return <span className={`inline-block size-2 rounded-full ${cls}`} />;
}
