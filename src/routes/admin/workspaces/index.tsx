import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Globe, KeyRound, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/AppShell";
import { WorkspaceFormDialog } from "@/components/admin/WorkspaceFormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCatalog } from "@/lib/store";

export const Route = createFileRoute("/admin/workspaces/")({
  head: () => ({
    meta: [
      { title: "Workspaces — SkillTrack Labs Admin" },
      { name: "description", content: "Create and manage customer workspaces that deliver cloud labs to learners." },
      { property: "og:title", content: "Workspaces — SkillTrack Labs Admin" },
      { property: "og:description", content: "Every workspace bundles a template, labs, users, VMs and sessions." },
    ],
  }),
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const { workspaces, toggleWorkspace } = useCatalog();
  const [q, setQ] = useState("");
  const filtered = workspaces.filter((w) =>
    [w.name, w.org, w.slug, w.template].join(" ").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="A workspace is the container through which you deliver cloud labs to a customer."
        action={
          <WorkspaceFormDialog
            trigger={
              <Button>
                <Plus className="size-4" /> New workspace
              </Button>
            }
          />
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search workspaces" className="pl-9" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((w) => (
          <Card key={w.id} className="transition-shadow hover:shadow-[var(--shadow-card)]">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{w.name}</h2>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{w.org}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={w.enabled ? "default" : "secondary"}>{w.enabled ? "Enabled" : "Disabled"}</Badge>
                  <Badge variant="secondary" className="capitalize">{w.status}</Badge>
                </div>
              </div>

              <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{w.description}</p>

              <div className="mt-3 flex items-center gap-2 text-xs">
                {w.accessType === "WORKSPACE_URL" ? <Globe className="size-3.5 text-primary" /> : <KeyRound className="size-3.5 text-primary" />}
                <code className="truncate font-mono text-[11px] text-muted-foreground">
                  {w.accessType === "WORKSPACE_URL" ? `/workspace/${w.slug}` : "/session/<session-id>"}
                </code>
              </div>

              <dl className="mt-4 grid grid-cols-4 gap-3 text-xs">
                <div><dt className="text-muted-foreground">Labs</dt><dd className="font-medium">{w.labs}</dd></div>
                <div><dt className="text-muted-foreground">Users</dt><dd className="font-medium">{w.users}</dd></div>
                <div><dt className="text-muted-foreground">Sessions</dt><dd className="font-medium">{w.activeSessions}</dd></div>
                <div><dt className="text-muted-foreground">Region</dt><dd className="font-medium">{w.region}</dd></div>
              </dl>

              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={w.enabled}
                    onCheckedChange={() => { toggleWorkspace(w.id); toast.success(`${w.name} ${w.enabled ? "disabled" : "enabled"}`); }}
                    aria-label="Toggle workspace"
                  />
                  <span className="text-xs text-muted-foreground">{w.template}</span>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin/workspaces/$slug" params={{ slug: w.slug }}>Open <ArrowRight className="size-3.5" /></Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2">
            No workspaces match "{q}".
          </p>
        ) : null}
      </div>
    </>
  );
}
