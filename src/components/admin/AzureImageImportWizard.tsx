import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { friendlyFrom } from "@/lib/errors";
import { vmSizes } from "@/lib/mock-data";
import {
  fetchComputeGalleries, fetchGalleryConnections, fetchImageDefinitions, fetchImageVersions, importImageTemplate,
} from "@/lib/cloud/gallery/client";
import type {
  ComputeGallery, GalleryConnectionOption, ImageDefinition, ImageTemplate, ImageVersion,
} from "@/lib/cloud/gallery/types";
import { IMPORT_STEP_LABEL } from "@/lib/cloud/gallery/types";
import type { AzureResourceGroup } from "@/lib/cloud/connections/types";
import { fetchResourceGroups } from "@/lib/cloud/gallery/client";

/**
 * Eight-step import wizard. Each Azure level is fetched live from the backend
 * as the previous selection is made — nothing is guessed client-side.
 */
export function AzureImageImportWizard({
  trigger,
  onImported,
}: {
  trigger: ReactNode;
  onImported: (template: ImageTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [connections, setConnections] = useState<GalleryConnectionOption[]>([]);
  const [resourceGroups, setResourceGroups] = useState<AzureResourceGroup[]>([]);
  const [galleries, setGalleries] = useState<ComputeGallery[]>([]);
  const [definitions, setDefinitions] = useState<ImageDefinition[]>([]);
  const [versions, setVersions] = useState<ImageVersion[]>([]);

  const [connectionId, setConnectionId] = useState("");
  const [resourceGroup, setResourceGroup] = useState("");
  const [galleryName, setGalleryName] = useState("");
  const [definitionName, setDefinitionName] = useState("");
  const [versionPolicy, setVersionPolicy] = useState<"pinned" | "latest">("latest");
  const [version, setVersion] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [vmSize, setVmSize] = useState(vmSizes[1] ?? "Standard_D4s_v5");
  const [region, setRegion] = useState("");
  const [defaultDuration, setDefaultDuration] = useState(120);
  const [maxDuration, setMaxDuration] = useState(240);
  const [autoShutdown, setAutoShutdown] = useState(true);

  const connection = connections.find((c) => c.id === connectionId) ?? null;
  const gallery = galleries.find((g) => g.name === galleryName) ?? null;
  const definition = definitions.find((d) => d.name === definitionName) ?? null;
  const resolvedVersion = versionPolicy === "latest" ? (versions.at(-1)?.name ?? "latest") : version;

  const guarded = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyFrom(e).message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep(0);
    setError(null);
    setConnectionId(""); setResourceGroup(""); setGalleryName(""); setDefinitionName("");
    setVersion(""); setVersionPolicy("latest");
    setName(""); setDescription(""); setRegion(""); setAutoShutdown(true);
    setDefaultDuration(120); setMaxDuration(240);
  };

  useEffect(() => {
    if (!open) return;
    reset();
    void guarded(async () => setConnections((await fetchGalleryConnections()).connections));
  }, [open]);

  const chooseConnection = (id: string) => {
    setConnectionId(id);
    setResourceGroup(""); setGalleryName(""); setDefinitionName(""); setVersion("");
    setResourceGroups([]); setGalleries([]); setDefinitions([]); setVersions([]);
    void guarded(async () => setResourceGroups((await fetchResourceGroups(id)).resourceGroups));
  };

  const chooseResourceGroup = (rg: string) => {
    setResourceGroup(rg);
    setGalleryName(""); setDefinitionName(""); setVersion("");
    setGalleries([]); setDefinitions([]); setVersions([]);
    void guarded(async () => setGalleries((await fetchComputeGalleries(connectionId, rg)).galleries));
  };

  const chooseGallery = (g: string) => {
    setGalleryName(g);
    setDefinitionName(""); setVersion("");
    setDefinitions([]); setVersions([]);
    void guarded(async () =>
      setDefinitions((await fetchImageDefinitions(connectionId, resourceGroup, g)).imageDefinitions),
    );
  };

  const chooseDefinition = (d: string) => {
    setDefinitionName(d);
    setVersion("");
    setVersions([]);
    void guarded(async () => {
      const list = (await fetchImageVersions(connectionId, resourceGroup, galleryName, d)).imageVersions;
      setVersions(list);
      const found = definitions.find((x) => x.name === d);
      if (found && !region) setRegion(found.location);
      if (!name) setName(`${found?.name ?? d} template`);
    });
  };

  const canAdvance = () => {
    switch (step) {
      case 0: return Boolean(connectionId);
      case 1: return Boolean(resourceGroup);
      case 2: return Boolean(galleryName);
      case 3: return Boolean(definitionName);
      case 4: return versionPolicy === "latest" || Boolean(version);
      case 5: return Boolean(name.trim() && vmSize && region && defaultDuration > 0 && maxDuration >= defaultDuration);
      default: return true;
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { template } = await importImageTemplate({
        name, description, cloudConnectionId: connectionId, resourceGroupName: resourceGroup,
        galleryName, imageDefinitionName: definitionName,
        imageVersion: versionPolicy === "latest" ? "" : version,
        versionPolicy, region, vmSize,
        defaultSessionDuration: defaultDuration, maximumSessionDuration: maxDuration,
        autoShutdownEnabled: autoShutdown, status: "active",
      });
      onImported(template);
      toast.success(`${template.name} imported from Azure`);
      setOpen(false);
    } catch (e) {
      setError(friendlyFrom(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Azure image</DialogTitle>
          <DialogDescription>
            SkillTrack stores a secure reference to your Azure Compute Gallery image. The image is never copied.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap gap-x-3 gap-y-1 border-y border-border py-3 text-xs">
          {IMPORT_STEP_LABEL.map((label, index) => (
            <li key={label} className={`flex items-center gap-1.5 ${index === step ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              <span className={`grid size-4 place-items-center rounded-full text-[10px] ${index < step ? "bg-primary text-primary-foreground" : "border border-border"}`}>
                {index < step ? <Check className="size-2.5" /> : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        {error ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
          </p>
        ) : null}

        <div className="min-h-56 space-y-3 py-2">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Querying Azure…
            </p>
          ) : null}

          {step === 0 ? (
            <PickList
              empty="No Azure connections are configured. Add one under Cloud Connections first."
              items={connections.map((c) => ({
                id: c.id,
                title: c.name,
                subtitle: `${c.subscriptionName ?? c.subscriptionId} · tenant ${c.tenantId.slice(0, 8)}…`,
                badge: c.mock ? "Development sample" : c.status,
              }))}
              selected={connectionId}
              onSelect={chooseConnection}
            />
          ) : null}

          {step === 1 ? (
            <PickList
              empty="No resource groups are visible to this service principal."
              items={resourceGroups.map((rg) => ({ id: rg.name, title: rg.name, subtitle: rg.location, badge: rg.provisioningState ?? undefined }))}
              selected={resourceGroup}
              onSelect={chooseResourceGroup}
            />
          ) : null}

          {step === 2 ? (
            <PickList
              empty="No Azure Compute Galleries exist in this resource group."
              items={galleries.map((g) => ({ id: g.name, title: g.name, subtitle: g.description ?? g.location }))}
              selected={galleryName}
              onSelect={chooseGallery}
            />
          ) : null}

          {step === 3 ? (
            <PickList
              empty="This gallery has no image definitions."
              items={definitions.map((d) => ({
                id: d.name,
                title: d.name,
                subtitle: `${d.publisher} / ${d.offer} / ${d.sku}`,
                badge: `${d.osType} · ${d.osState} · ${d.architecture}`,
              }))}
              selected={definitionName}
              onSelect={chooseDefinition}
            />
          ) : null}

          {step === 4 ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setVersionPolicy("latest")}
                className={`w-full rounded-lg border p-3 text-left text-sm ${versionPolicy === "latest" ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <span className="font-medium">Use latest version</span>
                <p className="text-xs text-muted-foreground">
                  Always provisions the newest published version at lab start time.
                </p>
              </button>
              <PickList
                empty="This image definition has no published versions."
                items={versions.map((v) => ({
                  id: v.name,
                  title: `Version ${v.name}`,
                  subtitle: `${v.publishingProfile.publishedDate?.slice(0, 10) ?? "—"} · ${v.regions.join(", ") || v.location}`,
                  badge: v.replicationStatus,
                }))}
                selected={versionPolicy === "pinned" ? version : ""}
                onSelect={(v) => { setVersionPolicy("pinned"); setVersion(v); }}
              />
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="img-name">Template name</Label>
                <Input id="img-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="img-desc">Description</Label>
                <Textarea id="img-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>VM size</Label>
                  <Select value={vmSize} onValueChange={setVmSize}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{vmSizes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="img-region">Region</Label>
                  <Input id="img-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="eastus" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="img-dur">Default session duration (minutes)</Label>
                  <Input id="img-dur" type="number" min={15} value={defaultDuration} onChange={(e) => setDefaultDuration(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="img-max">Maximum duration (minutes)</Label>
                  <Input id="img-max" type="number" min={15} value={maxDuration} onChange={(e) => setMaxDuration(Number(e.target.value))} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Auto shutdown</p>
                  <p className="text-xs text-muted-foreground">Deallocate the VM when the session ends or expires.</p>
                </div>
                <Switch checked={autoShutdown} onCheckedChange={setAutoShutdown} />
              </div>
              <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                Operating system {definition?.osType} ({definition?.osState}) is inherited from the Azure image definition.
              </p>
            </div>
          ) : null}

          {step === 6 ? (
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <Summary label="Template name" value={name} />
              <Summary label="Azure connection" value={connection?.name ?? "—"} />
              <Summary label="Subscription" value={connection?.subscriptionName ?? connection?.subscriptionId ?? "—"} />
              <Summary label="Resource group" value={resourceGroup} />
              <Summary label="Compute gallery" value={galleryName} />
              <Summary label="Image definition" value={definitionName} />
              <Summary label="Image version" value={versionPolicy === "latest" ? `Latest (${resolvedVersion})` : version} />
              <Summary label="Operating system" value={`${definition?.osType ?? "—"} · ${definition?.osState ?? "—"}`} />
              <Summary label="Region" value={region} />
              <Summary label="VM size" value={vmSize} />
              <Summary label="Session duration" value={`${defaultDuration} min (max ${maxDuration} min)`} />
              <Summary label="Auto shutdown" value={autoShutdown ? "Enabled" : "Disabled"} />
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Image reference</dt>
                <dd className="mt-1 break-all font-mono text-[11px]">{gallery?.id ?? ""}/images/{definitionName}</dd>
              </div>
            </dl>
          ) : null}
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
            <ChevronLeft className="size-4" /> Back
          </Button>
          <div className="flex items-center gap-2">
            {step < 6 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance() || loading}>
                Next <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Import template
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}

function PickList({
  items, selected, onSelect, empty,
}: {
  items: { id: string; title: string; subtitle?: string | undefined; badge?: string | undefined }[];
  selected: string;
  onSelect: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={`flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left ${selected === item.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
        >
          <span>
            <span className="block text-sm font-medium">{item.title}</span>
            {item.subtitle ? <span className="block text-xs text-muted-foreground">{item.subtitle}</span> : null}
          </span>
          {item.badge ? <Badge variant="secondary" className="shrink-0 font-normal">{item.badge}</Badge> : null}
        </button>
      ))}
    </div>
  );
}
