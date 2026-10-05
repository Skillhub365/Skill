import { RequireAuth } from "@/components/layout/RequireAuth";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Eye, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { AzureImageImportWizard } from "@/components/admin/AzureImageImportWizard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyFrom } from "@/lib/errors";
import { useCatalog } from "@/lib/store";
import {
  cloneImageTemplate, deleteImageTemplate, fetchImageTemplates, patchImageTemplate,
} from "@/lib/cloud/gallery/client";
import type { ImageTemplate } from "@/lib/cloud/gallery/types";

export const Route = createFileRoute("/admin/cloud/image-templates")({
  head: () => ({
    meta: [
      { title: "Image Templates — SkillTrack Labs Admin" },
      { name: "description", content: "Import Azure Compute Gallery images as reusable SkillTrack VM templates." },
      { property: "og:title", content: "Image Templates — SkillTrack Labs Admin" },
      { property: "og:description", content: "Manage Azure gallery image references used to provision lab VMs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireAuth role="superadmin">
      <ImageTemplatesPage />
    </RequireAuth>
  ),
});

function ImageTemplatesPage() {
  const { workspaces } = useCatalog();
  const [templates, setTemplates] = useState<ImageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState<ImageTemplate | null>(null);
  const [editing, setEditing] = useState<ImageTemplate | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setTemplates((await fetchImageTemplates()).templates);
      setError(null);
    } catch (e) {
      setError(friendlyFrom(e).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(
    () =>
      templates.filter((t) =>
        [t.name, t.galleryName, t.imageDefinitionName, t.osType, t.region, t.vmSize, t.cloudConnectionName]
          .join(" ")
          .toLowerCase()
          .includes(q.toLowerCase()),
      ),
    [templates, q],
  );

  const replace = (template: ImageTemplate) =>
    setTemplates((list) => (list.some((t) => t.id === template.id) ? list.map((t) => (t.id === template.id ? template : t)) : [template, ...list]));

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(friendlyFrom(e).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Image Templates"
        description="Azure Compute Gallery images imported as SkillTrack VM templates. SkillTrack stores references only — images stay in your subscription."
        action={
          <AzureImageImportWizard
            onImported={replace}
            trigger={<Button><Plus className="size-4" /> Import Azure Image</Button>}
          />
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search image templates" className="pl-9" />
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Gallery / definition</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>VM size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading templates…
                    </TableCell>
                  </TableRow>
                ) : null}
                {!loading && filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                      No image templates yet. Use “Import Azure Image” to reference a Compute Gallery image.
                    </TableCell>
                  </TableRow>
                ) : null}
                {filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">Azure</p>
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>{t.cloudConnectionName}</p>
                      <p className="text-muted-foreground">{t.subscriptionName ?? t.subscriptionId}</p>
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>{t.galleryName}</p>
                      <p className="text-muted-foreground">{t.imageDefinitionName}</p>
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.versionPolicy === "latest" ? <Badge variant="secondary">Latest</Badge> : t.imageVersion}
                    </TableCell>
                    <TableCell className="text-xs">{t.osType}</TableCell>
                    <TableCell className="text-xs">{t.region}</TableCell>
                    <TableCell className="text-xs">{t.vmSize}</TableCell>
                    <TableCell>
                      <Badge variant={t.status === "active" ? "default" : "secondary"}>
                        {t.status === "active" ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.createdAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" aria-label="View" onClick={() => setViewing(t)}>
                          <Eye className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(t)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" aria-label="Clone"
                          onClick={() => act(async () => {
                            const { template } = await cloneImageTemplate(t.id, `${t.name} (copy)`);
                            replace(template);
                            toast.success("Template cloned");
                          })}
                        >
                          <Copy className="size-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" aria-label="Delete"
                          onClick={() => act(async () => {
                            await deleteImageTemplate(t.id);
                            setTemplates((list) => list.filter((x) => x.id !== t.id));
                            toast.success("Template deleted");
                          })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
            <DialogDescription>{viewing?.description || "Azure Compute Gallery image reference."}</DialogDescription>
          </DialogHeader>
          {viewing ? (
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <Detail label="Connection" value={viewing.cloudConnectionName} />
              <Detail label="Subscription" value={viewing.subscriptionName ?? viewing.subscriptionId} />
              <Detail label="Resource group" value={viewing.resourceGroupName} />
              <Detail label="Gallery" value={viewing.galleryName} />
              <Detail label="Image definition" value={viewing.imageDefinitionName} />
              <Detail label="Version" value={viewing.versionPolicy === "latest" ? `Latest (${viewing.imageVersion})` : viewing.imageVersion} />
              <Detail label="OS" value={`${viewing.osType} · ${viewing.osState} · ${viewing.architecture}`} />
              <Detail label="Region" value={viewing.region} />
              <Detail label="VM size" value={viewing.vmSize} />
              <Detail label="Session duration" value={`${viewing.defaultSessionDuration} min (max ${viewing.maximumSessionDuration})`} />
              <Detail label="Auto shutdown" value={viewing.autoShutdownEnabled ? "Enabled" : "Disabled"} />
              <Detail label="Last updated" value={viewing.updatedAt.slice(0, 16).replace("T", " ")} />
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Image version resource ID</dt>
                <dd className="mt-1 break-all font-mono text-[11px]">{viewing.imageVersionResourceId}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Assigned workspaces</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {viewing.workspaceIds.length === 0 ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    viewing.workspaceIds.map((id) => (
                      <Badge key={id} variant="secondary">{workspaces.find((w) => w.id === id)?.name ?? id}</Badge>
                    ))
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>

      {editing ? (
        <EditDialog
          template={editing}
          workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
          onClose={() => setEditing(null)}
          onSaved={(t) => { replace(t); setEditing(null); }}
        />
      ) : null}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}

function EditDialog({
  template, workspaces, onClose, onSaved,
}: {
  template: ImageTemplate;
  workspaces: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (t: ImageTemplate) => void;
}) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [vmSize, setVmSize] = useState(template.vmSize);
  const [region, setRegion] = useState(template.region);
  const [enabled, setEnabled] = useState(template.status === "active");
  const [workspaceId, setWorkspaceId] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { template: saved } = await patchImageTemplate(template.id, {
        name, description, vmSize, region, status: enabled ? "active" : "disabled",
        ...(workspaceId ? { assignWorkspaceId: workspaceId } : {}),
      });
      toast.success("Template updated");
      onSaved(saved);
    } catch (e) {
      toast.error(friendlyFrom(e).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit image template</DialogTitle>
          <DialogDescription>Azure image references are fixed after import. Clone to point at another image.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-desc">Description</Label>
            <Input id="edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-size">VM size</Label>
              <Input id="edit-size" value={vmSize} onChange={(e) => setVmSize(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-region">Region</Label>
              <Input id="edit-region" value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Assign to workspace</Label>
            <Select value={workspaceId} onValueChange={setWorkspaceId}>
              <SelectTrigger><SelectValue placeholder="Select a workspace" /></SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Template enabled</p>
              <p className="text-xs text-muted-foreground">Disabled templates cannot be assigned to new labs.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
