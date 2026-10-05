import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cloudProviders, operatingSystems, regions, vmSizes, type Template } from "@/lib/mock-data";
import { useCatalog } from "@/lib/store";

type Provider = Template["cloudProvider"];

export function TemplateFormDialog({ template, trigger }: { template?: Template; trigger: ReactNode }) {
  const { createTemplate, updateTemplate } = useCatalog();
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cloudProvider, setCloudProvider] = useState<Provider>("Azure");
  const [os, setOs] = useState(operatingSystems[0]!);
  const [vmSize, setVmSize] = useState(vmSizes[1]!);
  const [image, setImage] = useState("");
  const [region, setRegion] = useState(regions[0]!);
  const [software, setSoftware] = useState("");
  const [configuration, setConfiguration] = useState<{ key: string; value: string }[]>([]);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setCloudProvider(template?.cloudProvider ?? "Azure");
    setOs(template?.os ?? operatingSystems[0]!);
    setVmSize(template?.vmSize ?? vmSizes[1]!);
    setImage(template?.image ?? "");
    setRegion(template?.region ?? regions[0]!);
    setSoftware((template?.software ?? []).join(", "));
    setConfiguration(template?.configuration ?? [{ key: "diskSizeGb", value: "128" }]);
    setEnabled(template?.enabled ?? true);
  }, [open, template]);

  const submit = () => {
    if (!name.trim() || !image.trim()) {
      toast.error("Template name and image reference are required.");
      return;
    }
    const payload = {
      name, description, cloudProvider, os, vmSize, image, region, enabled,
      configuration: configuration.filter((c) => c.key.trim()),
      software: software.split(",").map((s) => s.trim()).filter(Boolean),
    };
    if (template) {
      updateTemplate(template.id, payload);
      toast.success("Template updated");
    } else {
      createTemplate(payload);
      toast.success("Template created");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{template ? "Edit template" : "Create template"}</DialogTitle>
          <DialogDescription>
            Templates are configuration objects. They map to cloud VM images and sizes when provisioning is enabled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Template name</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Azure AI Workstation" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea id="tpl-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Cloud provider</Label>
              <Select value={cloudProvider} onValueChange={(v) => setCloudProvider(v as Provider)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cloudProviders.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
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
            <div className="space-y-2">
              <Label>Operating system</Label>
              <Select value={os} onValueChange={setOs}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {operatingSystems.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>VM size</Label>
              <Select value={vmSize} onValueChange={setVmSize}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {vmSizes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-image">Image reference</Label>
            <Input id="tpl-image" value={image} onChange={(e) => setImage(e.target.value)} placeholder="Canonical:ubuntu-24_04-lts:server:latest" className="font-mono text-xs" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-sw">Preinstalled software (comma separated)</Label>
            <Input id="tpl-sw" value={software} onChange={(e) => setSoftware(e.target.value)} placeholder="VS Code, Docker, Azure CLI" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Configuration</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfiguration((c) => [...c, { key: "", value: "" }])}>
                <Plus className="size-3.5" /> Add key
              </Button>
            </div>
            <div className="space-y-2">
              {configuration.map((entry, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={entry.key} placeholder="key" onChange={(e) => setConfiguration((c) => c.map((x, ix) => ix === i ? { ...x, key: e.target.value } : x))} />
                  <Input value={entry.value} placeholder="value" onChange={(e) => setConfiguration((c) => c.map((x, ix) => ix === i ? { ...x, value: e.target.value } : x))} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setConfiguration((c) => c.filter((_, ix) => ix !== i))}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Template enabled</p>
              <p className="text-xs text-muted-foreground">Disabled templates cannot be assigned to new workspaces.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>{template ? "Save changes" : "Create template"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
