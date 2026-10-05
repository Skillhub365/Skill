import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, RefreshCw, ShieldAlert, Wand2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ApiError } from "@/lib/errors";
import * as provisioning from "@/lib/cloud/provisioning/client";
import {
  PROVISION_STEP_LABEL,
  validateCidr,
  validateLabPassword,
  validateLabUsername,
  validateName,
  type InfrastructureState,
  type LabRole,
  type ProvisionStep,
} from "@/lib/cloud/provisioning/types";

const ALL_ROLES: LabRole[] = ["Contributor", "Virtual Machine Contributor", "Network Contributor"];

const STEP_TONE: Record<ProvisionStep["state"], string> = {
  ok: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  created: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  skipped: "bg-muted text-muted-foreground border-border",
  manual: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
};

const STEP_LABEL: Record<ProvisionStep["state"], string> = {
  ok: "Already present",
  created: "Created",
  skipped: "Skipped",
  manual: "Action needed",
  failed: "Failed",
};

function StepIcon({ state }: { state: ProvisionStep["state"] }) {
  if (state === "failed") return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />;
  if (state === "manual") return <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />;
  if (state === "skipped") return <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
  return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />;
}

interface Props {
  connectionId: string;
  defaultResourceGroup: string | null;
  defaultRegion: string | null;
  canManage: boolean;
}

/**
 * Super Admin console for creating the Azure lab footprint: resource group,
 * virtual network and subnet, service-principal RBAC and the Windows
 * administrator used by every lab image. All work happens server-side.
 */
export function AzureInfrastructurePanel({ connectionId, defaultResourceGroup, defaultRegion, canManage }: Props) {
  const [state, setState] = useState<InfrastructureState | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ProvisionStep[] | null>(null);

  const [resourceGroup, setResourceGroup] = useState(defaultResourceGroup ?? "rg-skilltrack-labs");
  const [region, setRegion] = useState(defaultRegion ?? "eastus");
  const [vnetName, setVnetName] = useState("vnet-skilltrack-labs");
  const [subnetName, setSubnetName] = useState("snet-labs");
  const [addressSpace, setAddressSpace] = useState("10.30.0.0/16");
  const [subnetPrefix, setSubnetPrefix] = useState("10.30.1.0/24");
  const [roles, setRoles] = useState<LabRole[]>(["Contributor"]);
  const [labUsername, setLabUsername] = useState("");
  const [labPassword, setLabPassword] = useState("");

  const inspect = useCallback(async () => {
    setLoading(true);
    try {
      const { state: next } = await provisioning.fetchInfrastructure({
        connectionId,
        resourceGroup,
        vnetName,
        subnetName,
      });
      setState(next);
      if (next.region && !defaultRegion) setRegion(next.region);
    } catch (error) {
      toast.error(error instanceof ApiError ? (error.message) : "Azure could not be reached.");
      setState(null);
    } finally {
      setLoading(false);
    }
    // Re-inspecting on every keystroke would hammer Azure; this runs on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
    void inspect();
  }, [inspect]);

  const validation = useMemo(() => {
    const problems = [
      validateName("Resource group", resourceGroup.trim()),
      validateName("Virtual network", vnetName.trim()),
      validateName("Subnet", subnetName.trim()),
      validateCidr(addressSpace.trim()),
      validateCidr(subnetPrefix.trim()),
      labUsername ? validateLabUsername(labUsername.trim()) : null,
      labPassword ? validateLabPassword(labPassword) : null,
      Boolean(labUsername) !== Boolean(labPassword) ? "Provide both a lab administrator username and password." : null,
      region.trim() ? null : "Choose a region.",
    ].filter(Boolean) as string[];
    return problems;
  }, [resourceGroup, vnetName, subnetName, addressSpace, subnetPrefix, labUsername, labPassword, region]);

  async function provision() {
    if (validation.length) {
      toast.error(validation[0] as string);
      return;
    }
    setRunning(true);
    setSteps(null);
    try {
      const result = await provisioning.applyInfrastructure({
        connectionId,
        resourceGroup: resourceGroup.trim(),
        region: region.trim(),
        vnetName: vnetName.trim(),
        subnetName: subnetName.trim(),
        addressSpace: addressSpace.trim(),
        subnetPrefix: subnetPrefix.trim(),
        roles,
        ...(labUsername && labPassword ? { labUsername: labUsername.trim(), labPassword } : {}),
      });
      setSteps(result.steps);
      setState(result.state);
      // The password is never echoed back and never kept in browser state.
      setLabPassword("");
      const needsAction = result.steps.some((s) => s.state === "manual");
      if (!result.ok) toast.error("Provisioning stopped — review the steps below.");
      else if (needsAction) toast.warning("Infrastructure ready, but one step needs a subscription owner.");
      else toast.success("Azure lab infrastructure is ready.");
    } catch (error) {
      toast.error(error instanceof ApiError ? (error.message) : "Provisioning failed.");
    } finally {
      setRunning(false);
    }
  }

  function toggleRole(role: LabRole, on: boolean) {
    setRoles((prev) => (on ? [...new Set([...prev, role])] : prev.filter((r) => r !== role)));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Lab infrastructure</h3>
          <p className="text-xs text-muted-foreground">
            Creates the resource group, private network, RBAC and image administrator this platform needs. Re-running is
            safe: anything that already exists is left untouched.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void inspect()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 size-3 animate-spin" /> : <RefreshCw className="mr-2 size-3" />}
          Re-check Azure
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile
          label="Resource group"
          ok={Boolean(state?.resourceGroupExists)}
          detail={state?.resourceGroupExists ? `${state.resourceGroup} · ${state.region}` : "Not created yet"}
        />
        <StatusTile
          label="Network"
          ok={Boolean(state?.subnetExists)}
          detail={
            state?.subnetExists
              ? `${state.vnetName}/${state.subnetName} · ${state.subnetPrefix ?? ""}`
              : state?.vnetExists
                ? "Virtual network exists, subnet missing"
                : "Not created yet"
          }
        />
        <StatusTile
          label="Service principal role"
          ok={Boolean(state?.canManageVms && state?.canManageNetwork)}
          detail={
            !state?.rolesReadable
              ? "Cannot read RBAC — grant Application.Read.All or check manually"
              : state.roles.length
                ? state.roles.map((r) => r.role).join(", ")
                : "No roles on this resource group"
          }
        />
        <StatusTile
          label="Lab administrator"
          ok={Boolean(state?.labCredentialsConfigured)}
          detail={state?.labCredentialsConfigured ? `${state.labUsername} · stored in vault` : "Not configured"}
        />
      </div>

      <Separator />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="infra-rg">Resource group</Label>
          <Input
            id="infra-rg"
            value={resourceGroup}
            onChange={(e) => setResourceGroup(e.target.value)}
            disabled={!canManage}
            placeholder="rg-skilltrack-labs"
          />
          {state?.resourceGroups.length ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {state.resourceGroups.slice(0, 8).map((g) => (
                <button
                  key={g.name}
                  type="button"
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    setResourceGroup(g.name);
                    setRegion(g.location);
                  }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="infra-region">Region</Label>
          {state?.regions.length ? (
            <Select value={region} onValueChange={setRegion} disabled={!canManage}>
              <SelectTrigger id="infra-region">
                <SelectValue placeholder="Choose a region" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {state.regions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input id="infra-region" value={region} onChange={(e) => setRegion(e.target.value)} disabled={!canManage} />
          )}
          <p className="text-[11px] text-muted-foreground">
            An existing resource group keeps its own region; this applies when the group is created.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="infra-vnet">Virtual network</Label>
          <Input id="infra-vnet" value={vnetName} onChange={(e) => setVnetName(e.target.value)} disabled={!canManage} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="infra-subnet">Subnet</Label>
          <Input id="infra-subnet" value={subnetName} onChange={(e) => setSubnetName(e.target.value)} disabled={!canManage} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="infra-space">Address space</Label>
          <Input id="infra-space" value={addressSpace} onChange={(e) => setAddressSpace(e.target.value)} disabled={!canManage} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="infra-prefix">Subnet prefix</Label>
          <Input id="infra-prefix" value={subnetPrefix} onChange={(e) => setSubnetPrefix(e.target.value)} disabled={!canManage} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Roles to grant the service principal</Label>
        <div className="flex flex-wrap gap-4">
          {ALL_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={roles.includes(role)}
                onCheckedChange={(v) => toggleRole(role, v === true)}
                disabled={!canManage}
              />
              {role}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Granting RBAC requires Owner or User Access Administrator. If this app registration only has Contributor, the
          platform reports the exact command for a subscription owner to run instead of failing silently.
        </p>
      </div>

      <Separator />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="infra-user">Lab VM administrator</Label>
          <Input
            id="infra-user"
            value={labUsername}
            onChange={(e) => setLabUsername(e.target.value)}
            disabled={!canManage}
            autoComplete="off"
            placeholder="labadmin"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="infra-pass">Administrator password</Label>
          <Input
            id="infra-pass"
            type="password"
            value={labPassword}
            onChange={(e) => setLabPassword(e.target.value)}
            disabled={!canManage}
            autoComplete="new-password"
            placeholder="Leave blank to keep the current one"
          />
          <p className="text-[11px] text-muted-foreground">
            Stored in the secret vault and used server-side for RDP brokering. It is never returned to a browser.
          </p>
        </div>
      </div>

      {validation.length > 0 && canManage ? (
        <p className="flex items-center gap-2 text-xs text-amber-700">
          <AlertTriangle className="size-3.5" />
          {validation[0]}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={() => void provision()} disabled={!canManage || running || validation.length > 0}>
          {running ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Wand2 className="mr-2 size-4" />}
          Provision in Azure
        </Button>
      </div>

      {steps?.length ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <h4 className="text-sm font-medium">Provisioning result</h4>
          {steps.map((step) => (
            <div key={step.id} className="flex gap-2">
              <StepIcon state={step.state} />
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{PROVISION_STEP_LABEL[step.id]}</span>
                  <Badge variant="outline" className={STEP_TONE[step.state]}>
                    {STEP_LABEL[step.state]}
                  </Badge>
                  {step.errorCode ? (
                    <span className="font-mono text-[11px] text-muted-foreground">{step.errorCode}</span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
                {step.remediation ? (
                  <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px] text-muted-foreground">
                    {step.remediation}
                  </pre>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusTile({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {ok ? (
          <CheckCircle2 className="size-4 text-emerald-600" />
        ) : (
          <AlertTriangle className="size-4 text-amber-600" />
        )}
      </div>
      <p className="mt-1 truncate text-sm" title={detail}>
        {detail}
      </p>
    </div>
  );
}
