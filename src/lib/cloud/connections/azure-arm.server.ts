/**
 * Per-connection Azure Resource Manager client.
 *
 * One instance = one configured Azure subscription, authenticated with that
 * connection's own service principal. There is no global Azure credential:
 * every call carries the tenant, client and subscription of its connection.
 *
 * Everything here is server-side. Tokens and secrets never leave the process.
 */

import type {
  AzureResourceGroup,
  AzureVirtualMachine,
  CloudConnectionStatus,
} from "./types";

const ARM = "https://management.azure.com";
const LOGIN = "https://login.microsoftonline.com";
const SCOPE = "https://management.azure.com/.default";
const API_RESOURCES = "2021-04-01";
const API_COMPUTE = "2024-07-01";
const API_SUBSCRIPTION = "2022-12-01";
const API_AUTH = "2022-04-01";

export type AzureFailureKind =
  | "AUTHENTICATION_ERROR"
  | "PERMISSION_ERROR"
  | "SUBSCRIPTION_ERROR"
  | "RESOURCE_GROUP_NOT_FOUND"
  | "UNAVAILABLE"
  | "REQUEST_FAILED";

export class AzureConnectionError extends Error {
  constructor(
    readonly kind: AzureFailureKind,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }

  /** Map to the connection status shown on the admin card. */
  get status(): CloudConnectionStatus {
    switch (this.kind) {
      case "AUTHENTICATION_ERROR":
        return "AUTHENTICATION_ERROR";
      case "PERMISSION_ERROR":
        return "PERMISSION_ERROR";
      case "SUBSCRIPTION_ERROR":
      case "RESOURCE_GROUP_NOT_FOUND":
        return "SUBSCRIPTION_ERROR";
      default:
        return "UNAVAILABLE";
    }
  }
}

export interface AzureCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
}

interface CachedToken {
  value: string;
  expiresAtMs: number;
}

/** Tokens are cached per tenant+client so parallel calls reuse one login. */
const tokenCache = new Map<string, CachedToken>();

function cacheKey(c: AzureCredentials) {
  return `${c.tenantId}:${c.clientId}`;
}

export function forgetToken(c: AzureCredentials) {
  tokenCache.delete(cacheKey(c));
}

interface ArmListResponse<T> {
  value?: T[];
  nextLink?: string;
}

export class AzureArmClient {
  constructor(private readonly credentials: AzureCredentials) {}

  get subscriptionId() {
    return this.credentials.subscriptionId;
  }

  /** OAuth2 client-credentials login against the connection's own tenant. */
  async token(): Promise<string> {
    const key = cacheKey(this.credentials);
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached.value;

    let res: Response;
    try {
      res = await fetch(`${LOGIN}/${encodeURIComponent(this.credentials.tenantId)}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          scope: SCOPE,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      console.error("Azure login unreachable:", error);
      throw new AzureConnectionError("UNAVAILABLE", "Microsoft Entra ID could not be reached.");
    }
    if (!res.ok) {
      const body = await res.text();
      // AADSTS codes identify which field is wrong without leaking the secret.
      const code = /AADSTS\d+/.exec(body)?.[0] ?? `HTTP ${res.status}`;
      console.error(`Azure login failed [${res.status}] ${code}`);
      const detail = /AADSTS90002/.test(body)
        ? "Tenant ID was not found in Microsoft Entra ID."
        : /AADSTS700016/.test(body)
          ? "Client ID was not found in this tenant."
          : /AADSTS7000215|AADSTS7000222/.test(body)
            ? "Client secret is invalid or expired."
            : `Microsoft Entra ID rejected the credentials (${code}).`;
      throw new AzureConnectionError("AUTHENTICATION_ERROR", detail, code);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    tokenCache.set(key, { value: json.access_token, expiresAtMs: Date.now() + json.expires_in * 1000 });
    return json.access_token;
  }

  /** Raw ARM call against an absolute resource path (already URL-encoded). */
  async request<T>(
    path: string,
    init: { method?: string; apiVersion: string; body?: unknown; query?: Record<string, string> } ,
  ): Promise<T | null> {
    const token = await this.token();
    const url = new URL(`${ARM}${path}`);
    url.searchParams.set("api-version", init.apiVersion);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      console.error(`Azure ARM ${path} unreachable:`, error);
      throw new AzureConnectionError("UNAVAILABLE", "Azure Resource Manager could not be reached.");
    }

    if (res.status === 401) {
      tokenCache.delete(cacheKey(this.credentials));
      throw new AzureConnectionError("AUTHENTICATION_ERROR", "Azure rejected the connection credentials.");
    }
    if (res.status === 403) {
      const body = await res.text();
      console.error(`Azure ARM ${path} forbidden: ${body.slice(0, 500)}`);
      throw new AzureConnectionError(
        "PERMISSION_ERROR",
        "The service principal does not have permission for this operation.",
      );
    }
    if (res.status === 404) {
      const body = await res.text();
      if (/SubscriptionNotFound/i.test(body)) {
        throw new AzureConnectionError("SUBSCRIPTION_ERROR", "Subscription was not found for this service principal.");
      }
      if (/ResourceGroupNotFound/i.test(body)) {
        throw new AzureConnectionError("RESOURCE_GROUP_NOT_FOUND", "Resource group was not found in this subscription.");
      }
      return null;
    }
    if (!res.ok) {
      const body = await res.text();
      console.error(`Azure ARM ${init.method ?? "GET"} ${path} failed [${res.status}]: ${body.slice(0, 500)}`);
      throw new AzureConnectionError("REQUEST_FAILED", `Azure returned an error (HTTP ${res.status}).`);
    }
    if (res.status === 202 || res.status === 204) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  /** Follow ARM paging so large subscriptions are fully enumerated. */
  async list<T>(path: string, apiVersion: string, query?: Record<string, string>): Promise<T[]> {
    const first = await this.request<ArmListResponse<T>>(path, { apiVersion, ...(query ? { query } : {}) });
    const items = [...(first?.value ?? [])];
    let next = first?.nextLink;
    let guard = 0;
    while (next && guard++ < 50) {
      const token = await this.token();
      const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) break;
      const page = (await res.json()) as ArmListResponse<T>;
      items.push(...(page.value ?? []));
      next = page.nextLink;
    }
    return items;
  }

  /** Subscription display name — also proves the subscription is reachable. */
  async getSubscription(): Promise<{ displayName: string; state: string; tenantId: string | null }> {
    const sub = await this.request<{ displayName?: string; state?: string; tenantId?: string }>(
      `/subscriptions/${this.subscriptionId}`,
      { apiVersion: API_SUBSCRIPTION },
    );
    if (!sub) throw new AzureConnectionError("SUBSCRIPTION_ERROR", "Subscription was not found or is not accessible.");
    return {
      displayName: sub.displayName ?? this.subscriptionId,
      state: sub.state ?? "Unknown",
      tenantId: sub.tenantId ?? null,
    };
  }

  async listResourceGroups(): Promise<AzureResourceGroup[]> {
    const groups = await this.list<{ name: string; location: string; properties?: { provisioningState?: string } }>(
      `/subscriptions/${this.subscriptionId}/resourcegroups`,
      API_RESOURCES,
    );
    return groups.map((g) => ({
      name: g.name,
      location: g.location,
      provisioningState: g.properties?.provisioningState ?? null,
    }));
  }

  async getResourceGroup(name: string): Promise<AzureResourceGroup | null> {
    const group = await this.request<{ name: string; location: string; properties?: { provisioningState?: string } }>(
      `/subscriptions/${this.subscriptionId}/resourcegroups/${encodeURIComponent(name)}`,
      { apiVersion: API_RESOURCES },
    );
    if (!group) return null;
    return { name: group.name, location: group.location, provisioningState: group.properties?.provisioningState ?? null };
  }

  async listRegions(): Promise<string[]> {
    const locations = await this.list<{ name: string }>(`/subscriptions/${this.subscriptionId}/locations`, API_SUBSCRIPTION);
    return locations.map((l) => l.name).sort();
  }

  /**
   * Every VM in the subscription (optionally one resource group) with its real
   * power state from Azure's instanceView expansion — one request per page.
   */
  async listVirtualMachines(resourceGroup?: string | null): Promise<AzureVirtualMachine[]> {
    const path = resourceGroup
      ? `/subscriptions/${this.subscriptionId}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Compute/virtualMachines`
      : `/subscriptions/${this.subscriptionId}/providers/Microsoft.Compute/virtualMachines`;

    interface ArmVm {
      id: string;
      name: string;
      location: string;
      properties?: {
        provisioningState?: string;
        hardwareProfile?: { vmSize?: string };
        storageProfile?: { osDisk?: { osType?: string } };
        instanceView?: { statuses?: Array<{ code: string; displayStatus?: string }> };
      };
    }

    const vms = await this.list<ArmVm>(path, API_COMPUTE, { $expand: "instanceView" });
    return vms.map((vm) => {
      const statuses = vm.properties?.instanceView?.statuses ?? [];
      const power = statuses.find((s) => s.code.startsWith("PowerState/"));
      return {
        id: vm.id,
        name: vm.name,
        resourceGroup: resourceGroupFromId(vm.id),
        location: vm.location,
        vmSize: vm.properties?.hardwareProfile?.vmSize ?? "—",
        osType: vm.properties?.storageProfile?.osDisk?.osType ?? "—",
        powerState: power?.displayStatus ?? power?.code.replace("PowerState/", "") ?? "Unknown",
        provisioningState: vm.properties?.provisioningState ?? "Unknown",
      };
    });
  }

  async getVirtualMachine(resourceGroup: string, name: string): Promise<AzureVirtualMachine | null> {
    const vms = await this.listVirtualMachines(resourceGroup);
    return vms.find((vm) => vm.name === name) ?? null;
  }

  private vmPath(resourceGroup: string, name: string) {
    return (
      `/subscriptions/${this.subscriptionId}/resourceGroups/${encodeURIComponent(resourceGroup)}` +
      `/providers/Microsoft.Compute/virtualMachines/${encodeURIComponent(name)}`
    );
  }

  async startVirtualMachine(resourceGroup: string, name: string): Promise<void> {
    await this.request(`${this.vmPath(resourceGroup, name)}/start`, { method: "POST", apiVersion: API_COMPUTE });
  }

  /** Deallocate rather than stop, so compute billing ends immediately. */
  async deallocateVirtualMachine(resourceGroup: string, name: string): Promise<void> {
    await this.request(`${this.vmPath(resourceGroup, name)}/deallocate`, { method: "POST", apiVersion: API_COMPUTE });
  }

  async getInstanceView(
    resourceGroup: string,
    name: string,
  ): Promise<{ powerState: string; provisioningState: string; agentReady: boolean }> {
    const view = await this.request<{
      statuses?: Array<{ code: string; displayStatus?: string }>;
      vmAgent?: { statuses?: Array<{ code: string; displayStatus?: string }> };
    }>(`${this.vmPath(resourceGroup, name)}/instanceView`, { apiVersion: API_COMPUTE });
    const statuses = view?.statuses ?? [];
    const power = statuses.find((s) => s.code.startsWith("PowerState/"));
    const provisioning = statuses.find((s) => s.code.startsWith("ProvisioningState/"));
    const agent = (view?.vmAgent?.statuses ?? []).find((s) => s.code.startsWith("ProvisioningState/"));
    return {
      powerState: power?.displayStatus ?? power?.code.replace("PowerState/", "") ?? "Unknown",
      provisioningState: provisioning?.code.split("/")[1] ?? "Unknown",
      agentReady: Boolean(agent && /succeeded/i.test(agent.code)),
    };
  }

  /**
   * Ask Azure which RBAC actions this principal holds at the given scope.
   * Used to verify least-privilege access without requesting Owner.
   */
  async effectiveActions(scope: string): Promise<{ actions: string[]; notActions: string[] } | null> {
    const permissions = await this.list<{ actions?: string[]; notActions?: string[] }>(
      `${scope}/providers/Microsoft.Authorization/permissions`,
      API_AUTH,
    );
    if (permissions.length === 0) return null;
    return {
      actions: permissions.flatMap((p) => p.actions ?? []),
      notActions: permissions.flatMap((p) => p.notActions ?? []),
    };
  }
}

export function resourceGroupFromId(resourceId: string): string {
  return /resourceGroups\/([^/]+)/i.exec(resourceId)?.[1] ?? "—";
}

/** Wildcard-aware RBAC match: "Microsoft.Compute/*" covers VM start. */
export function actionAllowed(action: string, actions: string[], notActions: string[]): boolean {
  const matches = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i").test(action);
  return actions.some(matches) && !notActions.some(matches);
}

/* ------------------------------------------------ Azure Compute Gallery ---- */

const API_GALLERY = "2023-07-03";

interface ArmGallery {
  id: string;
  name: string;
  location: string;
  properties?: { description?: string };
}

interface ArmImageDefinition {
  id: string;
  name: string;
  location: string;
  properties?: {
    description?: string;
    osType?: string;
    osState?: string;
    architecture?: string;
    hyperVGeneration?: string;
    identifier?: { publisher?: string; offer?: string; sku?: string };
  };
}

interface ArmImageVersion {
  id: string;
  name: string;
  location: string;
  properties?: {
    provisioningState?: string;
    publishingProfile?: {
      publishedDate?: string;
      excludeFromLatest?: boolean;
      replicaCount?: number;
      targetRegions?: Array<{ name: string }>;
    };
    replicationStatus?: { aggregatedState?: string; summary?: Array<{ region: string; state: string }> };
  };
}

export type { ArmGallery, ArmImageDefinition, ArmImageVersion };

/**
 * Gallery reads only need reader-level RBAC on the gallery scope — Owner is
 * never required. All calls are server-side and scoped to one connection.
 */
export function galleryScope(subscriptionId: string, resourceGroup: string) {
  return `/subscriptions/${subscriptionId}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Compute/galleries`;
}

export async function listComputeGalleries(client: AzureArmClient, resourceGroup: string) {
  return client.list<ArmGallery>(galleryScope(client.subscriptionId, resourceGroup), API_GALLERY);
}

export async function listImageDefinitions(client: AzureArmClient, resourceGroup: string, gallery: string) {
  return client.list<ArmImageDefinition>(
    `${galleryScope(client.subscriptionId, resourceGroup)}/${encodeURIComponent(gallery)}/images`,
    API_GALLERY,
  );
}

export async function listImageVersions(
  client: AzureArmClient,
  resourceGroup: string,
  gallery: string,
  definition: string,
) {
  return client.list<ArmImageVersion>(
    `${galleryScope(client.subscriptionId, resourceGroup)}/${encodeURIComponent(gallery)}/images/${encodeURIComponent(definition)}/versions`,
    API_GALLERY,
  );
}

export async function getImageVersion(
  client: AzureArmClient,
  resourceGroup: string,
  gallery: string,
  definition: string,
  version: string,
) {
  return client.request<ArmImageVersion>(
    `${galleryScope(client.subscriptionId, resourceGroup)}/${encodeURIComponent(gallery)}/images/${encodeURIComponent(definition)}/versions/${encodeURIComponent(version)}`,
    { apiVersion: API_GALLERY },
  );
}
