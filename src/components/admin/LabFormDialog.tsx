import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCatalog, type LabInput } from "@/lib/store";
import type { Lab, LabStatus } from "@/lib/mock-data";
import {
  LAB_MODE_LABEL,
  PERSISTENCE_POLICY_HINT,
  PERSISTENCE_POLICY_LABEL,
  PERSISTENT_DEFAULTS,
  formatHours,
  type LabMode,
  type PersistencePolicy,
} from "@/lib/labs/persistence";

const levels: Lab["level"][] = ["Beginner", "Intermediate", "Advanced"];
const statuses: LabStatus[] = ["draft", "published", "unpublished"];
const modes: LabMode[] = ["session_based", "persistent"];
const policies: PersistencePolicy[] = ["keep_disk", "keep_vm", "snapshot_restore"];

export function LabFormDialog({
  lab, workspaceId, trigger,
}: { lab?: Lab; workspaceId?: string; trigger: ReactNode }) {
  const { workspaces, templates, createLab, updateLab } = useCatalog();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LabInput>(() => ({
    title: lab?.title ?? "",
    description: lab?.description ?? "",
    objectives: lab?.objectives ?? [],
    workspaceId: lab?.workspaceId ?? workspaceId ?? workspaces[0]?.id ?? "",
    templateId: lab?.templateId ?? templates[0]?.id ?? "",
    durationMinutes: lab?.durationMinutes ?? 60,
    level: lab?.level ?? "Beginner",
    status: lab?.status ?? "draft",
    tags: lab?.tags ?? [],
    labMode: lab?.labMode ?? "session_based",
    defaultAccessDays: lab?.defaultAccessDays ?? PERSISTENT_DEFAULTS.accessDays,
    defaultAllowedMinutes: lab?.defaultAllowedMinutes ?? PERSISTENT_DEFAULTS.allowedMinutes,
    idleShutdownMinutes: lab?.idleShutdownMinutes ?? PERSISTENT_DEFAULTS.idleShutdownMinutes,
    persistencePolicy: lab?.persistencePolicy ?? PERSISTENT_DEFAULTS.persistencePolicy,
    resetOnAccessEnd: lab?.resetOnAccessEnd ?? PERSISTENT_DEFAULTS.resetOnAccessEnd,
  }));
  const [objectivesText, setObjectivesText] = useState((lab?.objectives ?? []).join("\n"));
  const [tagsText, setTagsText] = useState((lab?.tags ?? []).join(", "));

  const set = <K extends keyof LabInput>(key: K, value: LabInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    if (!form.title.trim()) { toast.error("Lab name is required"); return; }
    if (!form.workspaceId) { toast.error("Select a workspace"); return; }
    const payload: LabInput = {
      ...form,
      objectives: objectivesText.split("\n").map((o) => o.trim()).filter(Boolean),
      tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (lab) {
      updateLab(lab.id, payload);
      toast.success("Lab updated");
    } else {
      createLab(payload);
      toast.success("Lab created");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lab ? "Edit lab" : "Create lab"}</DialogTitle>
          <DialogDescription>Labs belong to a workspace and run on a template environment.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lab-name">Lab name</Label>
            <Input id="lab-name" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Deploy an Azure OpenAI Chat App" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lab-desc">Description</Label>
            <Textarea id="lab-desc" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lab-obj">Learning objectives</Label>
            <Textarea id="lab-obj" rows={3} value={objectivesText} onChange={(e) => setObjectivesText(e.target.value)} placeholder="One objective per line" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Workspace</Label>
              <Select value={form.workspaceId} onValueChange={(v) => set("workspaceId", v)}>
                <SelectTrigger><SelectValue placeholder="Select workspace" /></SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={form.templateId} onValueChange={(v) => set("templateId", v)}>
                <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lab-duration">Duration (minutes)</Label>
              <Input id="lab-duration" type="number" min={15} step={15} value={form.durationMinutes}
                onChange={(e) => set("durationMinutes", Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-2">
              <Label>Level</Label>
              <Select value={form.level} onValueChange={(v) => set("level", v as Lab["level"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{levels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as LabStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lab-tags">Tags</Label>
              <Input id="lab-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Azure, AI" />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-2">
              <Label>Lab type</Label>
              <Select value={form.labMode ?? "session_based"} onValueChange={(v) => set("labMode", v as LabMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modes.map((m) => <SelectItem key={m} value={m}>{LAB_MODE_LABEL[m]}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.labMode === "persistent"
                  ? "Learners keep one machine across several days and spend a total hour allowance."
                  : "Each launch gets a fresh, disposable machine that ends when the timer runs out."}
              </p>
            </div>

            {form.labMode === "persistent" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="lab-days">Default access window (days)</Label>
                  <Input id="lab-days" type="number" min={1} max={365} value={form.defaultAccessDays ?? 10}
                    onChange={(e) => set("defaultAccessDays", Number(e.target.value) || 1)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lab-hours">Default hours per learner</Label>
                  <Input id="lab-hours" type="number" min={1} max={1000}
                    value={Math.round((form.defaultAllowedMinutes ?? 1200) / 60)}
                    onChange={(e) => set("defaultAllowedMinutes", (Number(e.target.value) || 1) * 60)} />
                  <p className="text-xs text-muted-foreground">{formatHours(form.defaultAllowedMinutes ?? 1200)} total</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lab-idle">Idle shutdown (minutes)</Label>
                  <Input id="lab-idle" type="number" min={5} max={480} value={form.idleShutdownMinutes ?? 30}
                    onChange={(e) => set("idleShutdownMinutes", Number(e.target.value) || 30)} />
                  <p className="text-xs text-muted-foreground">Stops the machine when the learner walks away, so hours are not wasted.</p>
                </div>
                <div className="space-y-2">
                  <Label>State between sessions</Label>
                  <Select
                    value={form.persistencePolicy ?? "keep_disk"}
                    onValueChange={(v) => set("persistencePolicy", v as PersistencePolicy)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {policies.map((p) => <SelectItem key={p} value={p}>{PERSISTENCE_POLICY_LABEL[p]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{PERSISTENCE_POLICY_HINT[form.persistencePolicy ?? "keep_disk"]}</p>
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.resetOnAccessEnd ?? true}
                    onChange={(e) => set("resetOnAccessEnd", e.target.checked)}
                  />
                  Return the machine to the shared pool when the access window ends or the hours run out.
                </label>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>{lab ? "Save changes" : "Create lab"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
