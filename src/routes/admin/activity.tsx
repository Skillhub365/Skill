import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { RealtimeStatusBadge } from "@/components/realtime/RealtimeStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CATEGORY_TONE, EVENT_CATEGORIES, type EventCategory } from "@/lib/activity";
import { useCatalog } from "@/lib/store";

export const Route = createFileRoute("/admin/activity")({
  head: () => ({
    meta: [
      { title: "Activity — SkillTrack Labs Admin" },
      { name: "description", content: "Chronological audit trail of workspace, lab, user, VM and session events." },
      { property: "og:title", content: "Activity — SkillTrack Labs Admin" },
      { property: "og:description", content: "See who changed what across the lab platform." },
    ],
  }),
  component: ActivityPage,
});

function ActivityPage() {
  const { events, workspaces, realtime } = useCatalog();
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (category !== "all" && e.category !== category) return false;
      if (!q) return true;
      return [e.actor, e.target, e.detail, e.type].join(" ").toLowerCase().includes(q);
    });
  }, [events, category, query]);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Audit trail across workspaces, labs, users, VMs and sessions."
        action={<RealtimeStatusBadge status={realtime.status} lastUpdatedAt={realtime.lastUpdatedAt} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search events…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={category === "all" ? "default" : "outline"} onClick={() => setCategory("all")}>All</Button>
          {EVENT_CATEGORIES.map((c) => (
            <Button key={c} size="sm" variant={category === c ? "default" : "outline"} className="capitalize" onClick={() => setCategory(c)}>
              {c}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <ol className="divide-y divide-border">
            {filtered.map((e) => {
              const ws = e.workspaceId ? workspaces.find((w) => w.id === e.workspaceId) : undefined;
              return (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={`font-mono text-[11px] font-normal ${CATEGORY_TONE[e.category]}`}>
                        {e.type}
                      </Badge>
                      <p className="text-sm font-medium">{e.target}</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{e.detail}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {e.actor}
                      {ws ? ` · ${ws.name}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                </li>
              );
            })}
            {filtered.length === 0 ? (
              <li className="p-10 text-center text-sm text-muted-foreground">No events match those filters.</li>
            ) : null}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
