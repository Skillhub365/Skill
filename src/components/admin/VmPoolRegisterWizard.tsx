import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { friendlyFrom } from "@/lib/errors";
import { useCatalog } from "@/lib/store";
import {
  discoverAzureVms, fetchPoolConnections, fetchPoolResourceGroups, registerPoolVm,
  type PoolTemplateOption,
} from "@/lib/vm/pool/client";
import { REGISTER_STEP_LABEL, type DiscoveredVm, type PoolVm } from "@/lib/vm/pool/types";
import type { GalleryConnectionOption } from "@/lib/cloud/gallery/types";
import type { AzureResourceGroup } from "@/lib/cloud/connections/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PoolTemplateOption[];
  onRegistered: (vm: PoolVm) => void;
}

/** Connection -> resource group -> Azure VM -> template -> review. */
export function VmPoolRegisterWizard({ open, onOpenChange, templates, onRegistered }: Props) {
  const { workspaces } = useCatalog();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [connections, setConnections] = useState<GalleryConnectionOption[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [groups, setGroups] = useState<AzureResourceGroup[]>([]);
  const [resourceGroup, setResourceGroup] = useState("");
  const [vms, setVms] = useState<DiscoveredVm[]>([]);
  const [azureVmName, setAzureVmName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string>("any");
  const [displayName, setDisplayName] = useState("");

  const template = templates.find((t) => t.id === templateId) ?? null;
  const selectedVm = vms.find((v) => v.name === azureVmName) ?? null;

  const warnings = useMemo(() => {
    if (!selectedVm || !template) return [];
    const list: { field: string; expected: string; actual: string }[] = [];
    if (template.region && template.region.toLowerCase() !== selectedVm.location.toLowerCase())
      list.push({ field: "Region", expected: template.region, actual: selectedVm.location });
    if (template.vmSize && template.vmSize.toLowerCase() !== selectedVm.vmSize.toLowerCase())
      list.push({ field: "VM size", expected: template.vmSize, actual: selectedVm.vmSize });
    if (template.osType && template.osType.toLowerCase() !== selectedVm.osType.toLowerCase())
      list.push({ field: "Operating system", expected: template.osType, actual: selectedVm.osType });
    return list;
  }, [selectedVm, template]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError(null);
    setBusy(true);
    void fetchPoolConnections()
      .then((r) => setConnections(r.connections))
      .catch((e) => setError(friendlyFrom(e).message))
      .finally(() => setBusy(false));
  }, [open]);

  const loadGroups = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setGroups((await fetchPoolResourceGroups(id)).resourceGroups);
      setStep(1);
    } catch (e) {
      setError(friendlyFrom(e).message);
    } finally {
      setBusy(false);
    }
  };

  const loadVms = async (rg: string) => {
    setBusy(true);
    setError(null);
    try {
      setVms((await discoverAzureVms(connectionId, rg)).vms);
      setStep(2);
    } catch (e) {
      setError(friendlyFrom(e).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { vm } = await registerPoolVm({
        cloudConnectionId: connectionId,
        resourceGroup,
        azureVmName,
        templateId,
        workspaceId: workspaceId === "any" ? null : workspaceId,
        displayName: displayName.trim() || undefined,
      });
      onRegistered(vm);
      onOpenChange(false);
    } catch (e) {
      setError(friendlyFrom(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Register an Azure virtual machine</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {REGISTER_STEP_LABEL.length} — {REGISTER_STEP_LABEL[step]}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 pb-2">
          {REGISTER_STEP_LABEL.map((label, i) => (
            <Badge key={label} variant={i === step ? "default" : i < step ? "secondary" : "outline"}>
              {i < step ? <Check className="mr-1 h-3 w-3" /> : null}
              {label}
            </Badge>
          ))}
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        ) : null}

        <div className="min-h-[220px] space-y-3">
          {busy ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Talking to Azure…
            </p>
          ) : null}

          {step === 0 && !busy ? (
            <div className="space-y-2">
              {connections.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add an Azure cloud connection first.</p>
              ) : null}
              {connections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setConnectionId(c.id);
                    void loadGroups(c.id);
                  }}
                  className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-accent"
                >
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">{c.subscriptionName ?? "Azure subscription"}</span>
                  </span>
                  <Badge variant="outline">{c.status}</Badge>
                </button>
              ))}
            </div>
          ) : null}

          {step === 1 && !busy ? (
            <div className="space-y-2">
              {groups.map((g) => (
                <button
                  key={g.name}
                  type="button"
                  onClick={() => {
                    setResourceGroup(g.name);
                    void loadVms(g.name);
                  }}
                  className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-accent"
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-muted-foreground">{g.location}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === 2 && !busy ? (
            <div className="space-y-2">
              {vms.length === 0 ? (
                <p className="text-sm text-muted-foreground">No virtual machines were found in this resource group.</p>
              ) : null}
              {vms.map((vm) => (
                <button
                  key={vm.id}
                  type="button"
                  disabled={vm.registered}
                  onClick={() => {
                    setAzureVmName(vm.name);
                    setStep(3);
                  }}
                  className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span>
                      <span className="font-medium">{vm.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {vm.vmSize} · {vm.osType} · {vm.location}
                      </span>
                    </span>
                  </span>
                  <Badge variant={vm.registered ? "secondary" : "outline"}>
                    {vm.registered ? "Registered" : vm.powerState}
                  </Badge>
                </button>
              ))}
            </div>
          ) : null}

          {step === 3 && !busy ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>SkillTrack image template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Dedicate to workspace (optional)</Label>
                <Select value={workspaceId} onValueChange={setWorkspaceId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any workspace</SelectItem>
                    {workspaces.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Display name (optional)</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={azureVmName} />
              </div>
            </div>
          ) : null}

          {step === 4 && !busy ? (
            <div className="space-y-2 text-sm">
              <Row label="Azure VM" value={azureVmName} />
              <Row label="Resource group" value={resourceGroup} />
              <Row label="Template" value={template?.name ?? "—"} />
              <Row label="Workspace" value={workspaceId === "any" ? "Any workspace" : workspaces.find((w) => w.id === workspaceId)?.name ?? "—"} />
              {warnings.length ? (
                <div className="rounded-md border border-warning/40 bg-muted/40 p-3">
                  <p className="mb-1 font-medium">Template mismatch</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {warnings.map((w) => (
                      <li key={w.field}>{w.field}: template expects {w.expected}, machine reports {w.actual}.</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">The machine matches the template configuration.</p>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          {step > 0 ? (
            <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={busy}>Back</Button>
          ) : null}
          {step === 3 ? (
            <Button onClick={() => setStep(4)} disabled={!templateId || busy}>Review</Button>
          ) : null}
          {step === 4 ? (
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Register VM
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
