import { rememberPrivateIp, forgetPrivateIp, privateIpFor } from "../private-endpoints.server";
import type { CloudProvider, CreateVmSpec, VmInstanceView } from "./provider.server";
import type { VmRecord, VmStatus } from "../types";
import { azureConfig, type AzureConfig } from "@/lib/infra/runtime.server";
import { AzureError } from "@/lib/cloud/azure-errors";

/**
 * Real Azure provider. Talks to Azure Resource Manager over its REST API so it
 * runs inside the Worker runtime without any Node-only SDK.
 *
 * Authentication is server-side only:
 *   production  -> Azure Managed Identity (no secret to store or rotate)
 *   dev/staging -> service principal (tenant + client id + client secret)
 * No Azure credential, private IP or resource ID is ever returned to a browser.
 *
 * Template mapping: SkillTrack template -> Azure image reference -> VM size ->
 * region -> VNet/subnet NIC -> resource group -> Azure VM.
 */

const ARM = "https://management.azure.com";
const SCOPE = "https://management.azure.com/.default";
const RESOURCE = "https://management.azure.com/";
const IMDS = "http://169.254.169.254/metadata/identity/oauth2/token";
const API_COMPUTE = "2024-07-01";
const API_NETWORK = "2023-11-01";

interface Token {
  value: string;
  expiresAtMs: number;
}

interface LiveVm {
  record: VmRecord;
  /** Azure resource name (unique within the resource group). */
  azureName: string;
}

let tokenCache: Token | null = null;
let liveVms: Map<string, LiveVm> | null = null;
function store() {
  if (!liveVms) liveVms = new Map<string, LiveVm>();
  return liveVms;
}

/** Parse "publisher:offer:sku:version" into an Azure image reference. */
export function toImageReference(image: string) {
  const [publisher, offer, sku, version] = image.split(":");
  if (!publisher || !offer || !sku) {
    throw new AzureError("AZURE_REQUEST_FAILED", "Template image must be publisher:offer:sku:version");
  }
  return { publisher, offer, sku, version: version || "latest" };
}

/** Managed identity token from App Service / Container Apps or IMDS. */
async function managedIdentityToken(cfg: AzureConfig): Promise<Token> {
  const endpoint = process.env["IDENTITY_ENDPOINT"];
  const header = process.env["IDENTITY_HEADER"];
  const url = new URL(endpoint ?? IMDS);
  url.searchParams.set("api-version", endpoint ? "2019-08-01" : "2018-02-01");
  url.searchParams.set("resource", RESOURCE);
  // A user-assigned identity is selected by its client ID.
  if (cfg.clientId) url.searchParams.set("client_id", cfg.clientId);
  const res = await fetch(url.toString(), {
    headers: endpoint && header ? { "X-IDENTITY-HEADER": header } : { Metadata: "true" },
  });
  if (!res.ok) {
    console.error(`Azure managed identity token failed [${res.status}]: ${await res.text()}`);
    throw new AzureError("AZURE_AUTH_FAILED", "managed identity token request rejected");
  }
  const json = (await res.json()) as { access_token: string; expires_in?: string | number };
  const seconds = Number(json.expires_in ?? 3600);
  return { value: json.access_token, expiresAtMs: Date.now() + (Number.isFinite(seconds) ? seconds : 3600) * 1000 };
}

/** Service-principal (client credentials) token for dev and staging. */
async function servicePrincipalToken(cfg: AzureConfig): Promise<Token> {
  if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) {
    throw new AzureError("AZURE_NOT_CONFIGURED", "service principal fields missing");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: SCOPE,
  });
  const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    // Log server-side detail; the caller only ever sees a generic failure.
    console.error(`Azure token request failed [${res.status}]: ${await res.text()}`);
    throw new AzureError("AZURE_AUTH_FAILED", "service principal rejected");
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { value: json.access_token, expiresAtMs: Date.now() + json.expires_in * 1000 };
}

async function accessToken(cfg: AzureConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAtMs > Date.now() + 60_000) return tokenCache.value;
  tokenCache = cfg.authMode === "managed-identity" ? await managedIdentityToken(cfg) : await servicePrincipalToken(cfg);
  return tokenCache.value;
}

async function arm<T>(
  cfg: AzureConfig,
  path: string,
  init: { method?: string; body?: unknown; apiVersion: string },
): Promise<T | null> {
  const token = await accessToken(cfg);
  const url = `${ARM}/subscriptions/${cfg.subscriptionId}/resourceGroups/${cfg.resourceGroup}${path}?api-version=${init.apiVersion}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error) {
    console.error(`Azure ARM ${init.method ?? "GET"} ${path} unreachable:`, error);
    throw new AzureError("AZURE_UNREACHABLE", "network failure calling Azure Resource Manager");
  }
  if (res.status === 404) {
    const text = await res.text();
    if (/ResourceGroupNotFound/i.test(text)) {
      console.error(`Azure resource group ${cfg.resourceGroup} not found`);
      throw new AzureError("AZURE_RESOURCE_GROUP_NOT_FOUND", text);
    }
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    tokenCache = null;
    console.error(`Azure ARM ${path} unauthorised [${res.status}]: ${await res.text()}`);
    throw new AzureError("AZURE_AUTH_FAILED", "Azure rejected the platform identity");
  }
  if (!res.ok) {
    const text = await res.text();
    console.error(`Azure ARM ${init.method ?? "GET"} ${path} failed [${res.status}]: ${text}`);
    void import("@/lib/observability/metrics.server")
      .then(({ recordMetric, METRIC }) =>
        recordMetric(METRIC.azureApiFailure, 1, {
          outcome: "failure",
          metadata: { provider: "Azure", status: res.status, operation: init.method ?? "GET" },
        }),
      )
      .catch(() => null);
    if (/QuotaExceeded|OperationNotAllowed|AllocationFailed|SkuNotAvailable/i.test(text)) {
      throw new AzureError("AZURE_QUOTA_EXCEEDED", text);
    }
    throw new AzureError("AZURE_REQUEST_FAILED", text);
  }
  if (res.status === 202 || res.status === 204) return null;
  return (await res.json()) as T;
}

/** Azure power/provisioning state -> SkillTrack lifecycle status. */
export function mapAzureStatus(
  powerState: string | undefined,
  provisioningState: string | undefined,
  ready: boolean,
): VmStatus {
  if (provisioningState === "failed" || provisioningState === "Failed") return "ERROR";
  switch (powerState) {
    case "PowerState/running":
      return ready ? "READY" : "RUNNING";
    case "PowerState/starting":
      return "STARTING";
    case "PowerState/stopping":
    case "PowerState/deallocating":
      return "STOPPING";
    case "PowerState/stopped":
    case "PowerState/deallocated":
      return "STOPPED";
    default:
      return provisioningState === "creating" || provisioningState === "updating" ? "BOOTING" : "STOPPED";
  }
}

interface AzureInstanceView {
  statuses?: Array<{ code: string; displayStatus?: string; level?: string; message?: string }>;
  vmAgent?: { statuses?: Array<{ code: string; displayStatus?: string }>; vmAgentVersion?: string };
}

export class AzureLiveProvider implements CloudProvider {
  readonly name = "Azure" as const;

  private cfg(): AzureConfig {
    const cfg = azureConfig();
    if (!cfg) throw new AzureError("AZURE_NOT_CONFIGURED");
    return cfg;
  }

  private entry(vmId: string): LiveVm {
    const entry = store().get(vmId);
    if (!entry) throw new AzureError("AZURE_VM_NOT_FOUND", vmId);
    return entry;
  }

  /** Template -> NIC in the private VNet -> Azure VM (created stopped). */
  async createVM(spec: CreateVmSpec): Promise<VmRecord> {
    const cfg = this.cfg();
    const azureName = `${spec.name}-${Math.random().toString(16).slice(2, 6)}`.toLowerCase();
    const nicName = `${azureName}-nic`;

    if (!cfg.vnetName || !cfg.subnetName) throw new AzureError("AZURE_NETWORK_NOT_CONFIGURED");
    const subnetId =
      `/subscriptions/${cfg.subscriptionId}/resourceGroups/${cfg.resourceGroup}` +
      `/providers/Microsoft.Network/virtualNetworks/${cfg.vnetName}/subnets/${cfg.subnetName}`;

    // Private NIC only: lab machines never receive a public IP address.
    await arm(cfg, `/providers/Microsoft.Network/networkInterfaces/${nicName}`, {
      method: "PUT",
      apiVersion: API_NETWORK,
      body: {
        location: spec.region,
        properties: {
          ipConfigurations: [
            {
              name: "ipconfig1",
              properties: { subnet: { id: subnetId }, privateIPAllocationMethod: "Dynamic" },
            },
          ],
        },
      },
    });

    await arm(cfg, `/providers/Microsoft.Compute/virtualMachines/${azureName}`, {
      method: "PUT",
      apiVersion: API_COMPUTE,
      body: {
        location: spec.region,
        tags: {
          skilltrackWorkspace: spec.workspaceId,
          skilltrackLab: spec.labId,
          skilltrackUser: spec.userId,
          skilltrackTemplate: spec.templateId,
        },
        properties: {
          hardwareProfile: { vmSize: spec.size },
          storageProfile: {
            imageReference: toImageReference(spec.image),
            osDisk: { createOption: "FromImage", deleteOption: "Delete" },
          },
          osProfile: {
            computerName: azureName.slice(0, 15),
            adminUsername: process.env["LAB_VM_USERNAME"] ?? "labadmin",
            adminPassword: process.env["LAB_VM_PASSWORD"] ?? "",
          },
          networkProfile: {
            networkInterfaces: [
              {
                id:
                  `/subscriptions/${cfg.subscriptionId}/resourceGroups/${cfg.resourceGroup}` +
                  `/providers/Microsoft.Network/networkInterfaces/${nicName}`,
                properties: { primary: true, deleteOption: "Delete" },
              },
            ],
          },
        },
      },
    });

    const record: VmRecord = {
      id: azureName,
      name: spec.name,
      provider: "Azure",
      region: spec.region,
      size: spec.size,
      image: spec.image,
      status: "STOPPED",
      templateId: spec.templateId,
      workspaceId: spec.workspaceId,
      workspaceName: spec.workspaceName,
      labId: spec.labId,
      labName: spec.labName,
      userId: spec.userId,
      userName: spec.userName,
      sessionId: spec.sessionId,
      startedAt: null,
      expiresAt: null,
      readiness: { checked: false, ready: false, detail: "Not started" },
      message: "Provisioned in Azure Compute, currently deallocated.",
    };
    store().set(record.id, { record, azureName });
    return record;
  }

  async adopt(record: VmRecord): Promise<VmRecord> {
    store().set(record.id, { record: { ...record }, azureName: record.id });
    return record;
  }

  async startVM(vmId: string, durationMinutes = 60): Promise<VmRecord> {
    const cfg = this.cfg();
    const entry = this.entry(vmId);
    // Duplicate start requests are harmless: a running machine is returned as-is.
    const current = await this.instanceView(entry.azureName);
    if (current.powerState === "PowerState/running" || current.powerState === "PowerState/starting") {
      entry.record = { ...entry.record, status: "STARTING", error: null };
      return entry.record;
    }
    try {
      await arm(cfg, `/providers/Microsoft.Compute/virtualMachines/${entry.azureName}/start`, {
        method: "POST",
        apiVersion: API_COMPUTE,
      });
    } catch (error) {
      if (error instanceof AzureError && error.code === "AZURE_REQUEST_FAILED") {
        throw new AzureError("AZURE_START_FAILED", error.detail);
      }
      throw error;
    }
    const now = Date.now();
    entry.record = {
      ...entry.record,
      status: "STARTING",
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + durationMinutes * 60_000).toISOString(),
      message: "Azure accepted the start request; allocating compute.",
      error: null,
    };
    return entry.record;
  }

  /** Deallocate, so the customer stops paying for compute immediately. */
  async stopVM(vmId: string): Promise<VmRecord> {
    const cfg = this.cfg();
    const entry = this.entry(vmId);
    try {
      await arm(cfg, `/providers/Microsoft.Compute/virtualMachines/${entry.azureName}/deallocate`, {
        method: "POST",
        apiVersion: API_COMPUTE,
      });
    } catch (error) {
      if (error instanceof AzureError && error.code === "AZURE_REQUEST_FAILED") {
        throw new AzureError("AZURE_STOP_FAILED", error.detail);
      }
      throw error;
    }
    forgetPrivateIp(vmId);
    entry.record = {
      ...entry.record,
      status: "STOPPING",
      readiness: { checked: false, ready: false, detail: "Deallocating" },
      message: "Azure accepted the deallocate request.",
    };
    // Confirm with Azure rather than assuming the machine stopped.
    const settled = await this.waitForStopped(entry, 60_000);
    return settled;
  }

  /** Poll Azure until the machine reports stopped/deallocated, or give up. */
  private async waitForStopped(entry: LiveVm, timeoutMs: number): Promise<VmRecord> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const view = await this.instanceView(entry.azureName);
      if (view.powerState === "PowerState/stopped" || view.powerState === "PowerState/deallocated") {
        entry.record = {
          ...entry.record,
          status: "STOPPED",
          startedAt: null,
          expiresAt: null,
          readiness: { checked: false, ready: false, detail: "Deallocated" },
          message: "Deallocated in Azure Compute.",
        };
        return entry.record;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    // Azure is still working; the record stays STOPPING and the poller follows up.
    return entry.record;
  }

  /** Raw runtime view of the machine, normalised — never returned to a browser. */
  private async instanceView(azureName: string): Promise<{
    powerState: string | undefined;
    provisioningState: string | undefined;
    agentReady: boolean;
    agentDetail: string;
    displayStatus: string | undefined;
  }> {
    const cfg = this.cfg();
    const view = await arm<AzureInstanceView>(
      cfg,
      `/providers/Microsoft.Compute/virtualMachines/${azureName}/instanceView`,
      { apiVersion: API_COMPUTE },
    );
    const statuses = view?.statuses ?? [];
    const codes = statuses.map((s) => s.code);
    const powerState = codes.find((c) => c.startsWith("PowerState/"));
    const provisioningState = codes.find((c) => c.startsWith("ProvisioningState/"))?.split("/")[1]?.toLowerCase();
    const agent = (view?.vmAgent?.statuses ?? []).find((s) => s.code.startsWith("ProvisioningState/"));
    const agentReady = Boolean(agent && /succeeded/i.test(agent.code));
    return {
      powerState,
      provisioningState,
      agentReady,
      agentDetail: agent?.displayStatus ?? "Guest agent has not reported yet",
      displayStatus: statuses.find((s) => s.code.startsWith("PowerState/"))?.displayStatus,
    };
  }

  /** Sanitised instance view for the orchestrator and the admin console. */
  async getVMInstanceView(vmId: string): Promise<VmInstanceView> {
    const entry = this.entry(vmId);
    const view = await this.instanceView(entry.azureName);
    return {
      vmId,
      powerState: view.powerState ?? null,
      provisioningState: view.provisioningState ?? null,
      agentReady: view.agentReady,
      detail: view.agentDetail,
      status: mapAzureStatus(view.powerState, view.provisioningState, false),
      observedAt: new Date().toISOString(),
    };
  }

  async getVM(vmId: string): Promise<VmRecord | null> {
    const entry = store().get(vmId);
    if (!entry) return null;
    const view = await this.instanceView(entry.azureName);

    let ready = false;
    let detail = "Waiting for the guest agent";
    if (view.powerState === "PowerState/running") {
      // Readiness = provisioning succeeded + guest agent ready + reachable NIC.
      const ip = await this.privateIp(entry.azureName);
      rememberPrivateIp(vmId, ip);
      ready = view.provisioningState === "succeeded" && view.agentReady && Boolean(ip);
      detail = ready ? "RDP reachable inside the private VNet" : view.agentDetail;
    }

    const status = mapAzureStatus(view.powerState, view.provisioningState, ready);
    entry.record = {
      ...entry.record,
      status,
      readiness: { checked: view.powerState === "PowerState/running", ready, detail },
      message:
        status === "READY"
          ? "VM is ready for the learner to connect."
          : status === "ERROR"
            ? "The machine reported a failed state and cannot be used."
            : `Machine is ${view.powerState?.replace("PowerState/", "") ?? "initialising"}.`,
    };
    return entry.record;
  }

  private async privateIp(azureName: string): Promise<string | null> {
    const cfg = this.cfg();
    const nic = await arm<{ properties?: { ipConfigurations?: Array<{ properties?: { privateIPAddress?: string } }> } }>(
      cfg,
      `/providers/Microsoft.Network/networkInterfaces/${azureName}-nic`,
      { apiVersion: API_NETWORK },
    );
    return nic?.properties?.ipConfigurations?.[0]?.properties?.privateIPAddress ?? null;
  }

  async getVMStatus(vmId: string): Promise<VmStatus> {
    const vm = await this.getVM(vmId);
    if (!vm) throw new AzureError("AZURE_VM_NOT_FOUND", vmId);
    return vm.status;
  }

  async checkVMReadiness(vmId: string) {
    const vm = await this.getVM(vmId);
    if (!vm) throw new AzureError("AZURE_VM_NOT_FOUND", vmId);
    return { ready: vm.readiness.ready && Boolean(privateIpFor(vmId)), detail: vm.readiness.detail };
  }

  async deleteVM(vmId: string) {
    const cfg = this.cfg();
    const entry = store().get(vmId);
    if (!entry) return { deleted: false };
    await arm(cfg, `/providers/Microsoft.Compute/virtualMachines/${entry.azureName}`, {
      method: "DELETE",
      apiVersion: API_COMPUTE,
    });
    forgetPrivateIp(vmId);
    store().delete(vmId);
    return { deleted: true };
  }
}
