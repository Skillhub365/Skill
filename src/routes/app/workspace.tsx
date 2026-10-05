import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/lib/store";
import { useLearnerView } from "@/lib/learner";

export const Route = createFileRoute("/app/workspace")({
  head: () => ({
    meta: [
      { title: "My Workspace — SkillTrack Labs" },
      { name: "description", content: "Details of the workspace assigned to you: template, labs and environment." },
      { property: "og:title", content: "My Workspace — SkillTrack Labs" },
      { property: "og:description", content: "See what your training workspace includes." },
    ],
  }),
  component: MyWorkspace,
});

function MyWorkspace() {
  const { user } = useAuth();
  const { templates } = useCatalog();
  const { workspace, myLabs: wsLabs } = useLearnerView(user);
  const ws = workspace!;
  const tpl = templates.find((t) => t.id === ws.templateId);

  return (
    <>
      <PageHeader title={ws.name} description={`Delivered by ${ws.org} · ${ws.region}`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Labs assigned to you</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {wsLabs.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-4">
                <div>
                  <p className="text-sm font-semibold">{l.title}</p>
                  <p className="text-xs text-muted-foreground">{l.durationMinutes} min · {l.level}</p>
                </div>
                <Badge variant="secondary">{l.progress ?? 0}%</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Environment</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Template</p><p className="font-medium">{ws.template}</p></div>
            <div><p className="text-xs text-muted-foreground">Operating system</p><p className="font-medium">{tpl?.os ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Machine size</p><p className="font-medium">{tpl?.vmSize ?? "—"}</p></div>
            <div>
              <p className="text-xs text-muted-foreground">Preinstalled</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(tpl?.software ?? []).map((s) => <Badge key={s} variant="outline" className="font-normal">{s}</Badge>)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
