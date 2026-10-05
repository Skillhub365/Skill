/**
 * Multi-connection cloud controller.
 *
 *   SkillTrack -> CloudController -> CloudConnection -> Provider ->
 *   credentials -> Azure Resource Manager -> the correct subscription
 *
 * Every operation is addressed by `connectionId`; the controller resolves that
 * connection's own credentials from the vault. There is no global cloud
 * credential and no implicit fallback between subscriptions.
 *
 * Provider-independent by design: AzureProvider is implemented today, AWS and
 * GCP slot in behind the same interface.
 */

import {
  armClientFor,
  getConnection,
  getInventory,
  markConnectionStatus,
  putInventory,
  connectionForWorkspace,
} from "./registry.server";
import { AzureConnectionError } from "./azure-arm.server";
import { validateAzureCredentials } from "./validate.server";
import { resolveSecret } from "./secret-vault.server";
import type { AzureInventory, AzureVirtualMachine, CloudConnection, ValidationResult } from "./types";

export class CloudConnectionMissing extends Error {}

export interface CloudResourceProvider {
  readonly provider: "azure" | "aws" | "gcp";
  verify(connection: CloudConnection): Promise<ValidationResult>;
  inventory(connection: CloudConnection): Promise<AzureInventory>;
  startVM(connection: CloudConnection, resourceGroup: string, vmName: string): Promise<AzureVirtualMachine | null>;
  stopVM(connection: CloudConnection, resourceGroup: string, vmName: string): Promise<AzureVirtualMachine | null>;
  vmStatus(connection: CloudConnection, resourceGroup: string, vmName: string): Promise<AzureVirtualMachine | null>;
}

/** Real Azure implementation — every method performs live ARM calls. */
const azureProvider: CloudResourceProvider = {
  provider: "azure",

  async verify(connection) {
    const clientSecret = await resolveSecret(connection.secretReference);
    if (!clientSecret) {
      return {
        ok: false,
        status: "AUTHENTICATION_ERROR",
        message: "The stored client secret could not be read from the secret store.",
        steps: [],
        subscriptionName: connection.subscriptionName,
        tenantId: connection.tenantId,
        resourceGroups: [],
        permissions: [],
        verifiedAt: new Date().toISOString(),
      };
    }
    return validateAzureCredentials(
      {
        tenantId: connection.tenantId,
        clientId: connection.clientId,
        clientSecret,
        subscriptionId: connection.subscriptionId,
      },
      { resourceGroup: connection.defaultResourceGroup },
    );
  },

  async inventory(connection) {
    const client = await requireClient(connection.id);
    const [subscription, resourceGroups, virtualMachines] = await Promise.all([
      client.getSubscription().catch(() => null),
      client.listResourceGroups(),
      client.listVirtualMachines(connection.defaultResourceGroup),
    ]);
    return {
      connectionId: connection.id,
      subscriptionId: connection.subscriptionId,
      subscriptionName: subscription?.displayName ?? connection.subscriptionName,
      resourceGroups,
      virtualMachines,
      regions: [...new Set(resourceGroups.map((g) => g.location))].sort(),
      vmSizes: [...new Set(virtualMachines.map((vm) => vm.vmSize))].sort(),
      syncedAt: new Date().toISOString(),
    };
  },

  async startVM(connection, resourceGroup, vmName) {
    const client = await requireClient(connection.id);
    await client.startVirtualMachine(resourceGroup, vmName);
    return client.getVirtualMachine(resourceGroup, vmName);
  },

  async stopVM(connection, resourceGroup, vmName) {
    const client = await requireClient(connection.id);
    await client.deallocateVirtualMachine(resourceGroup, vmName);
    return client.getVirtualMachine(resourceGroup, vmName);
  },

  async vmStatus(connection, resourceGroup, vmName) {
    const client = await requireClient(connection.id);
    const view = await client.getInstanceView(resourceGroup, vmName);
    const vm = await client.getVirtualMachine(resourceGroup, vmName);
    return vm ? { ...vm, powerState: view.powerState, provisioningState: view.provisioningState } : null;
  },
};

const providers: Record<CloudConnection["provider"], CloudResourceProvider> = {
  azure: azureProvider,
  // AWSProvider / GCPProvider implement the same interface when added.
  aws: azureProvider,
  gcp: azureProvider,
};

async function requireClient(connectionId: string) {
  const client = await armClientFor(connectionId);
  if (!client) throw new CloudConnectionMissing("Connection credentials are unavailable.");
  return client;
}

function require(connectionId: string): CloudConnection {
  const connection = getConnection(connectionId);
  if (!connection) throw new CloudConnectionMissing(`Unknown cloud connection ${connectionId}`);
  return connection;
}

export const multiCloudController = {
  providerFor(connection: CloudConnection): CloudResourceProvider {
    return providers[connection.provider];
  },

  /** Re-run the live Azure validation and persist the resulting status. */
  async testConnection(connectionId: string): Promise<{ connection: CloudConnection; result: ValidationResult }> {
    const connection = require(connectionId);
    const result = await this.providerFor(connection).verify(connection);
    const updated =
      markConnectionStatus(connectionId, result.status, result.ok ? null : result.message, {
        subscriptionName: result.subscriptionName ?? connection.subscriptionName,
        resourceGroupCount: result.resourceGroups.length || connection.resourceGroupCount,
      }) ?? connection;
    return { connection: updated, result };
  },

  /** Pull live resource groups, VMs, regions and sizes into the cache. */
  async refreshResources(connectionId: string): Promise<{ connection: CloudConnection; inventory: AzureInventory }> {
    const connection = require(connectionId);
    try {
      const inventory = await this.providerFor(connection).inventory(connection);
      putInventory(inventory);
      const updated =
        markConnectionStatus(connectionId, "CONNECTED", null, {
          subscriptionName: inventory.subscriptionName,
          resourceGroupCount: inventory.resourceGroups.length,
          vmCount: inventory.virtualMachines.length,
          lastSyncAt: inventory.syncedAt,
        }) ?? connection;
      return { connection: updated, inventory };
    } catch (error) {
      const failure = error instanceof AzureConnectionError ? error : null;
      markConnectionStatus(
        connectionId,
        failure?.status ?? "UNAVAILABLE",
        failure?.message ?? "Azure could not be reached.",
      );
      throw error;
    }
  },

  cachedResources(connectionId: string): AzureInventory | null {
    return getInventory(connectionId);
  },

  async startVM(connectionId: string, resourceGroup: string, vmName: string) {
    const connection = require(connectionId);
    return this.providerFor(connection).startVM(connection, resourceGroup, vmName);
  },

  async stopVM(connectionId: string, resourceGroup: string, vmName: string) {
    const connection = require(connectionId);
    return this.providerFor(connection).stopVM(connection, resourceGroup, vmName);
  },

  async vmStatus(connectionId: string, resourceGroup: string, vmName: string) {
    const connection = require(connectionId);
    return this.providerFor(connection).vmStatus(connection, resourceGroup, vmName);
  },

  /**
   * Workspace-scoped resolution. A workspace reaches exactly the subscription
   * and resource group it is bound to — never every configured subscription.
   */
  async forWorkspace(workspaceId: string) {
    const bound = await connectionForWorkspace(workspaceId);
    if (!bound) return null;
    return {
      connection: bound.connection,
      resourceGroup: bound.link.resourceGroup || bound.connection.defaultResourceGroup || "",
      region: bound.link.defaultRegion || bound.connection.defaultRegion || "",
      provider: this.providerFor(bound.connection),
    };
  },
};
