import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/AppShell";
import { TemplateFormDialog } from "@/components/admin/TemplateFormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCatalog } from "@/lib/store";

export const Route = createFileRoute("/admin/templates")({
  head: () => ({
    meta: [
      { title: "Lab Templates — SkillTrack Labs Admin" },
      { name: "description", content: "Reusable VM templates defining cloud provider, OS, machine size, image and region." },
      { property: "og:title", content: "Lab Templates — SkillTrack Labs Admin" },
      { property: "og:description", content: "Standardise lab environments with reusable VM templates." },
    ],
  }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const { templates, workspaces, toggleTemplate } = useCatalog();
  const [q, setQ] = useState("");
  const filtered = templates.filter((t) =>
    [t.name, t.os, t.vmSize, t.cloudProvider, t.region].join(" ").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Templates"
        description="Environment blueprints reused across workspaces. Each template maps to a cloud image and VM size."
        action={
          <TemplateFormDialog
            trigger={
              <Button>
                <Plus className="size-4" /> New template
              </Button>
            }
          />
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" className="pl-9" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((t) => {
          const used = workspaces.filter((w) => w.templateId === t.id).length;
          return (
            <Card key={t.id} className="transition-shadow hover:shadow-[var(--shadow-card)]">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">{t.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                  </div>
                  <Badge variant={t.enabled ? "default" : "secondary"}>{t.enabled ? "Enabled" : "Disabled"}</Badge>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="text-muted-foreground">Cloud</dt><dd className="font-medium">{t.cloudProvider}</dd></div>
                  <div><dt className="text-muted-foreground">Region</dt><dd className="font-medium">{t.region}</dd></div>
                  <div><dt className="text-muted-foreground">Operating system</dt><dd className="font-medium">{t.os}</dd></div>
                  <div><dt className="text-muted-foreground">VM size</dt><dd className="font-medium">{t.vmSize}</dd></div>
                </dl>

                <p className="mt-3 truncate font-mono text-[11px] text-muted-foreground">{t.image}</p>

                {t.software.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.software.map((s) => <Badge key={s} variant="secondary" className="font-normal">{s}</Badge>)}
                  </div>
                ) : null}

                <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                  <span className="text-xs text-muted-foreground">Used by {used} workspace{used === 1 ? "" : "s"}</span>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={t.enabled}
                      onCheckedChange={() => { toggleTemplate(t.id); toast.success(`${t.name} ${t.enabled ? "disabled" : "enabled"}`); }}
                      aria-label="Toggle template"
                    />
                    <TemplateFormDialog
                      template={t}
                      trigger={<Button variant="outline" size="sm"><Pencil className="size-3.5" /> Edit</Button>}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2">
            No templates match "{q}".
          </p>
        ) : null}
      </div>
    </>
  );
}
