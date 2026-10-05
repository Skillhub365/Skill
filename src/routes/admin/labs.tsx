import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/AppShell";
import { LabFormDialog } from "@/components/admin/LabFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCatalog } from "@/lib/store";

export const Route = createFileRoute("/admin/labs")({
  head: () => ({
    meta: [
      { title: "Labs — SkillTrack Labs Admin" },
      { name: "description", content: "Author, publish and version hands-on cloud labs for each workspace." },
      { property: "og:title", content: "Labs — SkillTrack Labs Admin" },
      { property: "og:description", content: "Manage lab content, duration, objectives and publish status." },
    ],
  }),
  component: LabsPage,
});

function LabsPage() {
  const { labs, workspaces, templates, setLabStatus } = useCatalog();
  const [query, setQuery] = useState("");
  const filtered = labs.filter((l) => `${l.title} ${l.description}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Labs"
        description="Hands-on content published into workspaces."
        action={<LabFormDialog trigger={<Button><Plus className="size-4" /> New lab</Button>} />}
      />
      <Input className="mb-4 max-w-sm" placeholder="Search labs…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((l) => {
          const ws = workspaces.find((w) => w.id === l.workspaceId);
          const tpl = templates.find((t) => t.id === l.templateId);
          const published = l.status === "published";
          return (
            <Card key={l.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold">{l.title}</h2>
                  <Badge variant={published ? "default" : "secondary"} className="capitalize">{l.status}</Badge>
                </div>
                <p className="mt-2 flex-1 text-xs text-muted-foreground">{l.description}</p>
                {l.objectives.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {l.objectives.slice(0, 3).map((o) => <li key={o}>· {o}</li>)}
                  </ul>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">{ws?.name ?? "Unassigned workspace"} · {tpl?.name ?? "No template"}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="font-normal">{l.durationMinutes} min</Badge>
                  <Badge variant="outline" className="font-normal">{l.level}</Badge>
                  <Badge variant="outline" className="font-normal">{l.vmSize}</Badge>
                  {l.publishedAt ? <Badge variant="outline" className="font-normal">Published {l.publishedAt}</Badge> : null}
                </div>
                <div className="mt-4 flex gap-2">
                  <LabFormDialog lab={l} trigger={<Button variant="outline" size="sm" className="flex-1"><Pencil className="size-4" /> Edit</Button>} />
                  <Button
                    size="sm"
                    variant={published ? "secondary" : "default"}
                    className="flex-1"
                    onClick={() => {
                      setLabStatus(l.id, published ? "unpublished" : "published");
                      toast.success(published ? "Lab unpublished" : "Lab published");
                    }}
                  >
                    {published ? "Unpublish" : "Publish"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
