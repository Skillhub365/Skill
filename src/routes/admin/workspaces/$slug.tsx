import { useEffect, useRef } from "react";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/AppShell";
import { WorkspaceAccessPanel } from "@/components/admin/WorkspaceAccessPanel";
import { WorkspaceFormDialog } from "@/components/admin/WorkspaceFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabFormDialog } from "@/components/admin/LabFormDialog";
import { WorkspaceUsersPanel } from "@/components/admin/WorkspaceUsersPanel";
import { WorkspaceCloudResources } from "@/components/admin/WorkspaceCloudResources";
import { WorkspaceRbacPanel } from "@/components/admin/WorkspaceRbacPanel";
import { Plus } from "lucide-react";
import { useCatalog } from "@/lib/store";

export const Route = createFileRoute("/admin/workspaces/$slug")({
  head: () => ({
    meta: [
      { title: "Workspace details — SkillTrack Labs Admin" },
      { name: "description", content: "Workspace details: access model, template, labs, users, VM environments and sessions." },
      { property: "og:title", content: "Workspace details — SkillTrack Labs Admin" },
      { property: "og:description", content: "Configure a workspace and publish its labs to learners." },
    ],
  }),
  component: WorkspaceDetail,
});

function WorkspaceDetail() {
  const { slug } = Route.useParams();
  const { workspaces, templates, labs, sessions, vms, workspaceUsers, labAssignments, toggleWorkspace, publishWorkspace, setLabStatus } = useCatalog();
  const lastId = useRef<string | null>(null);
  const navigate = useNavigate();
  const bySlug = workspaces.find((w) => w.slug === slug);
  // The slug can be regenerated while this page is open — follow the workspace by id.
  const renamed = !bySlug && lastId.current ? workspaces.find((w) => w.id === lastId.current) : undefined;
  const ws = bySlug ?? renamed;
  useEffect(() => {
    if (ws) lastId.current = ws.id;
    if (!bySlug && renamed) {
      void navigate({ to: "/admin/workspaces/$slug", params: { slug: renamed.slug }, replace: true });
    }
  }, [ws, bySlug, renamed, navigate]);
  if (!ws) throw notFound();

  const template = templates.find((t) => t.id === ws.templateId);
  const wsLabs = labs.filter((l) => l.workspaceId === ws.id);
  const wsUsers = workspaceUsers.filter((u) => u.workspaceId === ws.id);
  const wsVms = vms.filter((v) => v.workspaceName === ws.name);
  const wsSessions = sessions.filter((s) => s.workspace === ws.name);

  return (
    <>
      <PageHeader
        title={ws.name}
        description={ws.description || ws.org}
        action={
          <div className="flex items-center gap-2">
            <Badge variant={ws.enabled ? "default" : "secondary"}>{ws.enabled ? "Enabled" : "Disabled"}</Badge>
            <Switch
              checked={ws.enabled}
              onCheckedChange={() => { toggleWorkspace(ws.id); toast.success(`Workspace ${ws.enabled ? "disabled" : "enabled"}`); }}
              aria-label="Toggle workspace"
            />
            <WorkspaceFormDialog
              workspace={ws}
              trigger={<Button variant="outline"><Pencil className="size-4" /> Edit</Button>}
            />
            <Button
              onClick={() => {
                publishWorkspace(ws.id, ws.status !== "published");
                toast.success(ws.status === "published" ? "Workspace unpublished" : "Workspace published");
              }}
            >
              {ws.status === "published" ? "Unpublish" : "Publish"}
            </Button>
          </div>
        }
      />

      <WorkflowStrip
        status={ws.status}
        configured={Boolean(ws.templateId)}
        userCount={wsUsers.length}
        labCount={wsLabs.filter((l) => l.status === "published").length}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <WorkspaceAccessPanel workspace={ws} />

        <Card>
          <CardHeader><CardTitle className="text-base">Template</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {template ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{template.name}</p>
                  <Badge variant={template.enabled ? "default" : "secondary"}>{template.enabled ? "Enabled" : "Disabled"}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="text-muted-foreground">Cloud</dt><dd className="font-medium">{template.cloudProvider}</dd></div>
                  <div><dt className="text-muted-foreground">Region</dt><dd className="font-medium">{ws.region}</dd></div>
                  <div><dt className="text-muted-foreground">OS</dt><dd className="font-medium">{template.os}</dd></div>
                  <div><dt className="text-muted-foreground">VM size</dt><dd className="font-medium">{template.vmSize}</dd></div>
                </dl>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{template.image}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No template assigned.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { k: "Published labs", v: String(wsLabs.filter((l) => l.status === "published").length) },
          { k: "Users", v: String(wsUsers.length) },
          { k: "Active sessions", v: String(wsSessions.filter((s) => s.status === "active").length) },
          { k: "Created", v: `${ws.createdAt} · ${ws.createdBy}` },
        ].map((i) => (
          <Card key={i.k}>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{i.k}</p>
              <p className="mt-1 text-sm font-semibold">{i.v}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="labs" className="mt-8">
        <TabsList>
          <TabsTrigger value="labs">Published labs</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="vms">VM environments</TabsTrigger>
          <TabsTrigger value="azure">Azure resources</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>

        <TabsContent value="labs" className="mt-4">
          <div className="mb-4 flex justify-end">
            <LabFormDialog workspaceId={ws.id} trigger={<Button><Plus className="size-4" /> New lab</Button>} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {wsLabs.length === 0 ? <EmptyState label="No labs yet — create the first lab for this workspace" /> : null}
            {wsLabs.map((l) => (
              <Card key={l.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold">{l.title}</h3>
                    <Badge variant={l.status === "published" ? "default" : "secondary"} className="capitalize">{l.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{l.description}</p>
                  {l.objectives.length ? (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {l.objectives.map((o) => <li key={o}>· {o}</li>)}
                    </ul>
                  ) : null}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {l.durationMinutes} min · {l.level} · {labAssignments.filter((a) => a.labId === l.id).length} assigned
                  </p>
                  <div className="mt-4 flex gap-2">
                    <LabFormDialog lab={l} trigger={<Button variant="outline" size="sm" className="flex-1">Edit</Button>} />
                    <Button
                      size="sm"
                      variant={l.status === "published" ? "secondary" : "default"}
                      className="flex-1"
                      onClick={() => {
                        setLabStatus(l.id, l.status === "published" ? "unpublished" : "published");
                        toast.success(l.status === "published" ? "Lab unpublished" : "Lab published");
                      }}
                    >
                      {l.status === "published" ? "Unpublish" : "Publish"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <WorkspaceUsersPanel workspaceId={ws.id} />
        </TabsContent>

        <TabsContent value="permissions" className="mt-4">
          <WorkspaceRbacPanel workspaceId={ws.id} />
        </TabsContent>

        <TabsContent value="vms" className="mt-4 grid gap-3 md:grid-cols-2">
          {wsVms.length === 0 ? <EmptyState label="No VM environments" /> : null}
          {wsVms.map((v) => (
            <Card key={v.id}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{v.name}</p>
                  <Badge variant="secondary" className="capitalize">{v.status}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{v.size} · {v.region}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="azure" className="mt-4">
          <WorkspaceCloudResources workspaceId={ws.id} />
        </TabsContent>

        <TabsContent value="sessions" className="mt-4 space-y-3">
          {wsSessions.length === 0 ? <EmptyState label="No sessions recorded" /> : null}
          {wsSessions.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-semibold">{s.labTitle}</p>
                  <p className="text-xs text-muted-foreground">{s.user} · started {s.startedAt} · /session/{s.id}</p>
                </div>
                <Badge variant={s.status === "active" ? "default" : "secondary"} className="capitalize">{s.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </>
  );
}

function WorkflowStrip({ status, configured, userCount, labCount }: { status: string; configured: boolean; userCount: number; labCount: number }) {
  const steps = [
    { label: "Draft", done: true },
    { label: "Configure", done: configured },
    { label: "Create labs", done: labCount > 0 },
    { label: "Assign users", done: userCount > 0 },
    { label: "Published", done: status === "published" },
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2">
          <span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-semibold ${s.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {i + 1}
          </span>
          <span className={`text-xs font-medium ${s.done ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
          {i < steps.length - 1 ? <span className="mx-1 hidden h-px w-8 bg-border sm:block" /> : null}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{label}</p>;
}
