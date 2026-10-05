import { AzureProvider } from "./providers/azure.server";
import { AzureLiveProvider } from "./providers/azure-live.server";
import { assertLiveInfrastructure, infraModes } from "@/lib/infra/runtime.server";
import type { CloudProvider, CreateVmSpec } from "./providers/provider.server";
import type { CloudProviderName, VmRecord, VmStatus } from "./types";
import { ensurePoolLoaded, isPoolVmId } from "./pool/registry.server";
import { availableCapacity, availableCount, poolHasTemplate, poolServesTemplate } from "./pool/allocator.server";
import { poolProvider } from "./pool/provider.server";

let providers: Map<CloudProviderName, CloudProvider> | null = null;

/**
 * The provider implementation is chosen at runtime from the deployment
 * environment: development uses the mock, staging/production use real Azure
 * once its service principal is configured. Nothing above this layer — API
 * routes, hooks, UI — changes when the implementation is swapped.
 */
function registry() {
  if (!providers) {
    providers = new Map<CloudProviderName, CloudProvider>();
    // A live environment must not silently fall back to the mock provider:
    // assertLiveInfrastructure throws (and audits) when Azure is incomplete.
    assertLiveInfrastructure("vm");
    providers.set("Azure", infraModes().vm === "azure" ? new AzureLiveProvider() : new AzureProvider());
    // AWSProvider / GCPProvider register here behind the same contract.
  }
  return providers;
}

export function getProvider(name: CloudProviderName = "Azure"): CloudProvider {
  const provider = registry().get(name);
  if (!provider) throw new Error(`Cloud provider ${name} is not implemented yet`);
  return provider;
}

/**
 * Pre-created pool machines are driven by the PoolProvider: allocation is
 * atomic and every lifecycle call goes to the Azure subscription that owns the
 * machine. Any other VM keeps using the environment provider.
 */
function providerFor(vmId: string, name: CloudProviderName = "Azure"): CloudProvider {
  return isPoolVmId(vmId) ? poolProvider() : getProvider(name);
}

/** True when this template is served from the registered Azure VM pool. */
export function templateServedByPool(templateId: string): boolean {
  return poolHasTemplate(templateId);
}

/**
 * VM orchestrator: the single server-side entry point the app uses to control
 * lab machines. It never leaks provider credentials to the browser.
 */
export const orchestrator = {
  /** Free capacity for a template in the pre-created VM pool (durable read). */
  async poolCapacity(templateId: string, workspaceId?: string | null) {
    await ensurePoolLoaded();
    return {
      pooled: await poolServesTemplate(templateId),
      available: await availableCapacity(templateId, workspaceId ?? null),
      cached: availableCount(templateId),
    };
  },
  async createVM(spec: CreateVmSpec, provider: CloudProviderName = "Azure"): Promise<VmRecord> {
    await ensurePoolLoaded();
    if (await poolServesTemplate(spec.templateId)) return poolProvider().createVM(spec);
    return getProvider(provider).createVM(spec);
  },
  async startVM(vmId: string, opts?: { provider?: CloudProviderName; durationMinutes?: number; adopt?: VmRecord }) {
    if (isPoolVmId(vmId)) await ensurePoolLoaded();
    const provider = providerFor(vmId, opts?.provider ?? "Azure") as CloudProvider & {
      startVM(id: string, minutes?: number): Promise<VmRecord>;
    };
    if (opts?.adopt && !(await provider.getVM(vmId))) await provider.adopt(opts.adopt);
    return provider.startVM(vmId, opts?.durationMinutes ?? 60);
  },
  async stopVM(vmId: string, provider: CloudProviderName = "Azure"): Promise<VmRecord> {
    if (isPoolVmId(vmId)) await ensurePoolLoaded();
    return providerFor(vmId, provider).stopVM(vmId);
  },
  async getVMStatus(vmId: string, provider: CloudProviderName = "Azure"): Promise<VmStatus> {
    return providerFor(vmId, provider).getVMStatus(vmId);
  },
  async getVM(vmId: string, provider: CloudProviderName = "Azure"): Promise<VmRecord | null> {
    return providerFor(vmId, provider).getVM(vmId);
  },
  async checkVMReadiness(vmId: string, provider: CloudProviderName = "Azure") {
    return providerFor(vmId, provider).checkVMReadiness(vmId);
  },
  /** Provider runtime view (Azure instance view), already normalised. */
  async getVMInstanceView(vmId: string, provider: CloudProviderName = "Azure") {
    return providerFor(vmId, provider).getVMInstanceView(vmId);
  },
  async deleteVM(vmId: string, provider: CloudProviderName = "Azure") {
    return providerFor(vmId, provider).deleteVM(vmId);
  },
  /** Extend a machine's lease so it is not reclaimed before the new expiry. */
  async extendVM(vmId: string, expiresAt: string, provider: CloudProviderName = "Azure"): Promise<VmRecord | null> {
    const current = await providerFor(vmId, provider).getVM(vmId);
    if (!current) return null;
    return providerFor(vmId, provider).adopt({ ...current, expiresAt });
  },
  /** Rebuild provider state for a VM the worker no longer remembers. */
  async adopt(record: VmRecord): Promise<VmRecord> {
    return providerFor(record.id, record.provider).adopt(record);
  },
};