import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { regions, type AccessType, type Workspace } from "@/lib/mock-data";
import { SESSION_URL_BASE, WORKSPACE_URL_BASE, slugify, useCatalog, workspaceSlugFor } from "@/lib/store";
import { useAuth } from "@/lib/auth";

export function WorkspaceFormDialog({ workspace, trigger }: { workspace?: Workspace; trigger: ReactNode }) {
  const { templates, createWorkspace, updateWorkspace } = useCatalog();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [org, setOrg] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [region, setRegion] = useState(regions[0]!);
  const [accessType, setAccessType] = useState<AccessType>("WORKSPACE_URL");
  const [enabled, setEnabled] = useState(true);
  const [publicLanding, setPublicLanding] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(workspace?.name ?? "");
    setDescription(workspace?.description ?? "");
    setOrg(workspace?.org ?? "");
    setSlug(workspace?.slug ?? "");
    setSlugTouched(Boolean(workspace));
    setTemplateId(workspace?.templateId ?? templates[0]?.id ?? "");
    setRegion(workspace?.region ?? regions[0]!);
    setAccessType(workspace?.accessType ?? "WORKSPACE_URL");
    setEnabled(workspace?.enabled ?? true);
    setPublicLanding(workspace?.publicLanding ?? false);
  }, [open, workspace, templates]);

  const effectiveSlug = slugTouched ? slugify(slug) : workspaceSlugFor(org, name);

  const submit = () => {
    if (!name.trim() || !effectiveSlug || !templateId) {
      toast.error("Name, workspace URL and template are required.");
      return;
    }
    if (workspace) {
      updateWorkspace(workspace.id, {
        name, description, org, slug: effectiveSlug, templateId, region, accessType, enabled, publicLanding,
        status: enabled ? (workspace.status === "archived" ? "published" : workspace.status) : "archived",
      });
      toast.success("Workspace updated");
    } else {
      createWorkspace({
        name, description, org, slug: effectiveSlug, templateId, region, accessType, enabled, publicLanding,
        status: enabled ? "published" : "draft",
        createdBy: user?.email ?? "admin@skilltracklabs.com",
      });
      toast.success("Workspace created");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{workspace ? "Edit workspace" : "Create workspace"}</DialogTitle>
          <DialogDescription>
            A workspace bundles a VM template, published labs and the users who can reach them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ws-name">Workspace name</Label>
              <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Azure AI Training - ABC Corp" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-org">Organization</Label>
              <Input id="ws-org" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="ABC Corp" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-desc">Description</Label>
            <Textarea id="ws-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this workspace delivers to learners." />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-slug">Workspace URL slug</Label>
            <div className="flex items-center gap-2">
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{WORKSPACE_URL_BASE}/</span>
              <Input id="ws-slug" value={slugTouched ? slug : effectiveSlug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} placeholder="abc-training" />
            </div>
            <p className="text-xs text-muted-foreground">Resolves to {WORKSPACE_URL_BASE}/{effectiveSlug || "your-slug"}</p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
            <div>
              <Label htmlFor="ws-public">Public landing page</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Visitors without an account see the workspace branding and public lab catalogue. Sign-in is still required to open a lab or VM.
              </p>
            </div>
            <Switch id="ws-public" checked={publicLanding} onCheckedChange={setPublicLanding} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}{t.enabled ? "" : " (disabled)"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Access model</Label>
            <RadioGroup value={accessType} onValueChange={(v) => setAccessType(v as AccessType)} className="gap-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <RadioGroupItem value="WORKSPACE_URL" className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">Workspace URL</span>
                  <span className="block text-xs text-muted-foreground">{WORKSPACE_URL_BASE}/{effectiveSlug || "your-slug"} — learners sign in and see every published lab.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <RadioGroupItem value="USER_SESSION_URL" className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">User session URL</span>
                  <span className="block text-xs text-muted-foreground">{SESSION_URL_BASE}/&lt;session-id&gt; — each learner gets a private link, authentication still required.</span>
                </span>
              </label>
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Workspace enabled</p>
              <p className="text-xs text-muted-foreground">Disabled workspaces reject all learner access.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>{workspace ? "Save changes" : "Create workspace"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
