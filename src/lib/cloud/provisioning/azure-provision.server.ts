/**
 * Super Admin infrastructure provisioning against a real Azure subscription.
 *
 * Creates (idempotently) the lab footprint the platform needs:
 *   resource group -> virtual network + subnet -> RBAC for the service
 *   principal -> lab image administrator credentials.
 *
 * Everything runs server-side through the connection's own ARM client. The
 * browser never holds a token, an object id or a credential.
 *
 * Role assignment needs Owner or User Access Administrator on the scope. A
 * service principal that only has Contributor CANNOT grant itself roles; that
 * step then reports `manual` with the exact `az` command to run, instead of
 * failing the whole run.
 */

import { AzureArmClient, AzureConnectionError } from "@/lib/cloud/connections/azure-arm.server";
import { armClientFor, getConnection, updateConnection } from "@/lib/cloud/connections/registry.server";
import { normalizeErrorCode } from "@/lib/cloud/audit/audit-log.server";
import { hydrateLabCredentials, saveLabCredentials } from "./lab-credentials.server";
import {
  LAB_ROLE_IDS,
  type InfrastructureState,
  type LabRole,
  type ProvisionRequest,
  type ProvisionResult,
  type ProvisionStep,
  type RoleAssignmentView,
} from "./types";

const API_RESOURCES = "2021-04-01";
const API_NETWORK = "2023-11-01";
const API_AUTH = "2022-04-01";
const GRAPH = "https://graph.microsoft.com/v1.0";

export class ProvisioningError extends Error {}

/** Roles that imply the platform can create and power lab machines. */
const VM_ROLES = new Set(["Owner", "Contributor", "Virtual Machine Contributor"]);
const NETWORK_ROLES = new Set(["Owner", "Contributor", "Network Contributor"]);

async function arm(connectionId: string): Promise<AzureArmClient> {
  const client = await armClientFor(connectionId);
  if (!client) throw new ProvisioningError("Cloud connection was not found or its credential is unavailable.");
  return client;
}

/* ------------------------------------------------------------ identity ---- */

/**
 * Object id of the connection's service principal. Read from Microsoft Graph,
 * which needs the `Application.Read.All` (or `Directory.Read.All`) app role. If
 * Graph refuses, role work degrades to a manual step rather than failing.
 */
async function servicePrincipalObjectId(connectionId: string): Promise<string | null> {
  const connection = getConnection(connectionId);
  if (!connection) return null;
  const { resolveSecret } = await import("@/lib/cloud/connections/secret-vault.server");
  const secret = await resolveSecret(connection.secretReference);
  if (!secret) return null;

  let token: string;
  try {
    const res = await fetch(`https://login.microsoftonline.com/${connection.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: connection.clientId,
        client_secret: secret,
        scope: "https://graph.microsoft.com/.default",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    token = ((await res.json()) as { access_token: string }).access_token;
  } catch {
    return null;
  }

  try {
    const res = await fetch(
      `${GRAPH}/servicePrincipals?$filter=appId eq '${connection.clientId}'&$select=id`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { value?: Array<{ id: string }> };
    return json.value?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- reads ---- */

interface ArmRoleAssignment {
  properties?: { roleDefinitionId?: string; principalId?: string; scope?: string };
}

async function roleDefinitionName(client: AzureArmClient, roleDefinitionId: string): Promise<string> {
  const known = Object.entries(LAB_ROLE_IDS).find(([, id]) => roleDefinitionId.endsWith(id));
  if (known) return known[0];
  if (roleDefinitionId.endsWith("8e3af657-a8ff-443c-a75c-2fe8c4bcb635")) return "Owner";
  if (roleDefinitionId.endsWith("acdd72a7-3385-48ef-bd42-f606fba81ae7")) return "Reader";
  try {
    const def = await client.request<{ properties?: { roleName?: string } }>(
      roleDefinitionId.startsWith("/") ? roleDefinitionId : `/${roleDefinitionId}`,
      { apiVersion: API_AUTH },
    );
    return def?.properties?.roleName ?? "Unknown role";
  } catch {
    return "Unknown role";
  }
}

async function readRoles(
  client: AzureArmClient,
  resourceGroup: string,
  principalId: string | null,
): Promise<{ roles: RoleAssignmentView[]; readable: boolean }> {
  if (!principalId) return { roles: [], readable: false };
  try {
    const assignments = await client.list<ArmRoleAssignment>(
      `/subscriptions/${client.subscriptionId}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Authorization/roleAssignments`,
      API_AUTH,
      { $filter: `atScope() and assignedTo('${principalId}')` },
    );
    const roles: RoleAssignmentView[] = [];
    for (const a of assignments) {
      const id = a.properties?.roleDefinitionId;
      if (!id) continue;
      roles.push({ role: await roleDefinitionName(client, id), scope: a.properties?.scope ?? "" });
    }
    return { roles, readable: true };
  } catch {
    // 403 here means the principal cannot read RBAC — not that it has no roles.
    return { roles: [], readable: false };
  }
}

interface ArmVnet {
  name: string;
  location: string;
  properties?: {
    addressSpace?: { addressPrefixes?: string[] };
    subnets?: Array<{ name: string; properties?: { addressPrefix?: string } }>;
  };
}

/** Everything the console needs to render current Azure reality. */
export async function inspectInfrastructure(
  connectionId: string,
  probe: { resourceGroup?: string | null; vnetName?: string | null; subnetName?: string | null } = {},
): Promise<InfrastructureState> {
  const connection = getConnection(connectionId);
  const client = await arm(connectionId);

  const resourceGroup = (probe.resourceGroup ?? connection?.defaultResourceGroup ?? "").trim() || null;
  const vnetName = (probe.vnetName ?? "").trim() || null;
  const subnetName = (probe.subnetName ?? "").trim() || null;

  const [groups, regions] = await Promise.all([
    client.listResourceGroups().catch(() => []),
    client.listRegions().catch(() => []),
  ]);

  let group = null as { name: string; location: string } | null;
  if (resourceGroup) {
    const found = groups.find((g) => g.name.toLowerCase() === resourceGroup.toLowerCase());
    group = found ? { name: found.name, location: found.location } : null;
  }

  let vnetExists = false;
  let subnetExists = false;
  let subnetPrefix: string | null = null;
  if (group && vnetName) {
    const vnet = await client
      .request<ArmVnet>(
        `/subscriptions/${client.subscriptionId}/resourceGroups/${encodeURIComponent(group.name)}/providers/Microsoft.Network/virtualNetworks/${encodeURIComponent(vnetName)}`,
        { apiVersion: API_NETWORK },
      )
      .catch(() => null);
    vnetExists = Boolean(vnet);
    const subnet = vnet?.properties?.subnets?.find((s) => s.name.toLowerCase() === (subnetName ?? "").toLowerCase());
    subnetExists = Boolean(subnet);
    subnetPrefix = subnet?.properties?.addressPrefix ?? null;
  }

  const objectId = group ? await servicePrincipalObjectId(connectionId) : null;
  const { roles, readable } = group ? await readRoles(client, group.name, objectId) : { roles: [], readable: false };
  const credentials = await hydrateLabCredentials();

  return {
    connectionId,
    subscriptionName: connection?.subscriptionName ?? null,
    resourceGroup,
    resourceGroupExists: Boolean(group),
    region: group?.location ?? connection?.defaultRegion ?? null,
    vnetName,
    vnetExists,
    subnetName,
    subnetExists,
    subnetPrefix,
    roles,
    rolesReadable: readable,
    canManageVms: roles.some((r) => VM_ROLES.has(r.role)),
    canManageNetwork: roles.some((r) => NETWORK_ROLES.has(r.role)),
    labCredentialsConfigured: credentials.configured,
    labUsername: credentials.username,
    regions,
    resourceGroups: groups.map((g) => ({ name: g.name, location: g.location })),
  };
}

/* ---------------------------------------------------------------- write --- */

function failure(id: ProvisionStep["id"], error: unknown, remediation?: string): ProvisionStep {
  const detail =
    error instanceof AzureConnectionError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Azure rejected the request.";
  return {
    id,
    state: "failed",
    detail,
    errorCode: normalizeErrorCode(error),
    remediation: remediation ?? null,
  };
}

/**
 * Create the lab footprint. Idempotent: existing resources are reported as
 * `ok`, newly created ones as `created`. The run stops at the first hard
 * failure so a half-built network is never reported as ready.
 */
export async function provisionInfrastructure(request: ProvisionRequest): Promise<ProvisionResult> {
  const client = await arm(request.connectionId);
  const steps: ProvisionStep[] = [];
  const rg = request.resourceGroup.trim();
  const region = request.region.trim();
  const vnetName = request.vnetName.trim();
  const subnetName = request.subnetName.trim();
  const addressSpace = (request.addressSpace ?? "10.30.0.0/16").trim();
  const subnetPrefix = (request.subnetPrefix ?? "10.30.1.0/24").trim();
  const scope = `/subscriptions/${client.subscriptionId}/resourceGroups/${rg}`;

  /* 1. Resource group ----------------------------------------------------- */
  try {
    const existing = await client.getResourceGroup(rg).catch(() => null);
    if (existing) {
      steps.push({
        id: "resource-group",
        state: "ok",
        detail: `${existing.name} already exists in ${existing.location}.`,
      });
    } else {
      await client.request(`/subscriptions/${client.subscriptionId}/resourcegroups/${encodeURIComponent(rg)}`, {
        method: "PUT",
        apiVersion: API_RESOURCES,
        body: { location: region, tags: { managedBy: "skilltrack-labs", purpose: "lab-vms" } },
      });
      steps.push({ id: "resource-group", state: "created", detail: `Created ${rg} in ${region}.` });
    }
  } catch (error) {
    steps.push(
      failure("resource-group", error, `az group create --name ${rg} --location ${region}`),
    );
    return { ok: false, steps, state: await safeState(request) };
  }

  /* 2. Virtual network and subnet ----------------------------------------- */
  try {
    const path = `${scope}/providers/Microsoft.Network/virtualNetworks/${encodeURIComponent(vnetName)}`;
    const existing = await client.request<ArmVnet>(path, { apiVersion: API_NETWORK }).catch(() => null);
    const subnets = existing?.properties?.subnets ?? [];
    const hasSubnet = subnets.some((s) => s.name.toLowerCase() === subnetName.toLowerCase());

    if (existing && hasSubnet) {
      steps.push({ id: "network", state: "ok", detail: `${vnetName}/${subnetName} already exists.` });
    } else {
      // Merge rather than replace: an existing VNet keeps its other subnets.
      const nextSubnets = [
        ...subnets.map((s) => ({ name: s.name, properties: { addressPrefix: s.properties?.addressPrefix } })),
        { name: subnetName, properties: { addressPrefix: subnetPrefix, privateEndpointNetworkPolicies: "Disabled" } },
      ];
      await client.request(path, {
        method: "PUT",
        apiVersion: API_NETWORK,
        body: {
          location: existing?.location ?? region,
          tags: { managedBy: "skilltrack-labs" },
          properties: {
            addressSpace: {
              addressPrefixes: existing?.properties?.addressSpace?.addressPrefixes ?? [addressSpace],
            },
            subnets: nextSubnets,
          },
        },
      });
      steps.push({
        id: "network",
        state: "created",
        detail: existing
          ? `Added subnet ${subnetName} (${subnetPrefix}) to ${vnetName}.`
          : `Created ${vnetName} (${addressSpace}) with subnet ${subnetName} (${subnetPrefix}).`,
      });
    }
  } catch (error) {
    steps.push(
      failure(
        "network",
        error,
        `az network vnet create -g ${rg} -n ${vnetName} --address-prefix ${addressSpace} --subnet-name ${subnetName} --subnet-prefix ${subnetPrefix}`,
      ),
    );
    return { ok: false, steps, state: await safeState(request) };
  }

  /* 3. RBAC ---------------------------------------------------------------- */
  const wanted: LabRole[] = request.roles?.length ? request.roles : ["Contributor"];
  const objectId = await servicePrincipalObjectId(request.connectionId);
  if (!objectId) {
    steps.push({
      id: "role-assignment",
      state: "manual",
      detail:
        "The service principal cannot read its own object id from Microsoft Entra ID, so the platform cannot grant roles. Assign them once with the command below, or grant the app the Application.Read.All permission.",
      remediation: wanted
        .map(
          (role) =>
            `az role assignment create --assignee <app-id> --role "${role}" --scope ${scope}`,
        )
        .join("\n"),
    });
  } else {
    const current = await readRoles(client, rg, objectId);
    const missing = wanted.filter((role) => !current.roles.some((r) => r.role === role || r.role === "Owner"));
    if (!missing.length) {
      steps.push({
        id: "role-assignment",
        state: "ok",
        detail: `Already holds ${current.roles.map((r) => r.role).join(", ")} on ${rg}.`,
      });
    } else {
      const granted: string[] = [];
      let denied: unknown = null;
      for (const role of missing) {
        try {
          await client.request(
            `${scope}/providers/Microsoft.Authorization/roleAssignments/${crypto.randomUUID()}`,
            {
              method: "PUT",
              apiVersion: API_AUTH,
              body: {
                properties: {
                  roleDefinitionId: `/subscriptions/${client.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${LAB_ROLE_IDS[role]}`,
                  principalId: objectId,
                  principalType: "ServicePrincipal",
                },
              },
            },
          );
          granted.push(role);
        } catch (error) {
          denied = error;
          break;
        }
      }
      if (denied) {
        steps.push({
          id: "role-assignment",
          state: "manual",
          detail:
            "Azure refused the role assignment. Granting RBAC requires Owner or User Access Administrator on the scope — a Contributor cannot widen its own access. Run the command below as a subscription owner.",
          errorCode: normalizeErrorCode(denied),
          remediation: missing
            .filter((r) => !granted.includes(r))
            .map((role) => `az role assignment create --assignee <app-id> --role "${role}" --scope ${scope}`)
            .join("\n"),
        });
      } else {
        steps.push({
          id: "role-assignment",
          state: "created",
          detail: `Granted ${granted.join(", ")} on ${rg}. Azure may take up to five minutes to propagate.`,
        });
      }
    }
  }

  /* 4. Lab administrator credentials --------------------------------------- */
  if (request.labUsername && request.labPassword) {
    try {
      const { storedIn } = await saveLabCredentials(request.labUsername.trim(), request.labPassword);
      steps.push({
        id: "lab-credentials",
        state: "created",
        detail: `Administrator "${request.labUsername.trim()}" stored in ${
          storedIn === "azure-key-vault" ? "Azure Key Vault" : "the encrypted local store"
        }.`,
      });
    } catch (error) {
      steps.push(failure("lab-credentials", error));
    }
  } else {
    const current = await hydrateLabCredentials();
    steps.push({
      id: "lab-credentials",
      state: current.configured ? "ok" : "skipped",
      detail: current.configured
        ? `Administrator "${current.username}" is configured.`
        : "No lab administrator configured yet — RDP connections will fail until one is saved.",
    });
  }

  /* Persist as the connection default so launches pick it up automatically. */
  if (request.setAsDefault !== false) {
    await updateConnection(request.connectionId, { defaultResourceGroup: rg, defaultRegion: region }).catch(() => null);
  }

  const state = await safeState({ ...request, resourceGroup: rg, vnetName, subnetName });
  const ok = !steps.some((s) => s.state === "failed");
  return { ok, steps, state };
}

async function safeState(request: ProvisionRequest): Promise<InfrastructureState> {
  try {
    return await inspectInfrastructure(request.connectionId, {
      resourceGroup: request.resourceGroup,
      vnetName: request.vnetName,
      subnetName: request.subnetName,
    });
  } catch {
    return {
      connectionId: request.connectionId,
      subscriptionName: null,
      resourceGroup: request.resourceGroup,
      resourceGroupExists: false,
      region: request.region,
      vnetName: request.vnetName,
      vnetExists: false,
      subnetName: request.subnetName,
      subnetExists: false,
      subnetPrefix: null,
      roles: [],
      rolesReadable: false,
      canManageVms: false,
      canManageNetwork: false,
      labCredentialsConfigured: false,
      labUsername: null,
      regions: [],
      resourceGroups: [],
    };
  }
}
