/**
 * Server-side registry of configured cloud connections, their cached Azure
 * inventory and the workspace bindings.
 *
 * Records hold `secretReference` only — the client secret lives in the vault
 * (see secret-vault.server.ts). Nothing in this module is importable from the
 * browser bundle.
 *
 * Storage note: records live in the server process. Enabling a database swaps
 * this map for a table without changing any caller.
 */

import { deleteConnectionSecret, putConnectionSecret, resolveSecret, secretReferenceFor } from "./secret-vault.server";
import { AzureArmClient, type AzureCredentials } from "./azure-arm.server";
import type {
  AzureConnectionInput,
  AzureInventory,
  CloudConnection,
  CloudConnectionStatus,
  WorkspaceCloudLink,
} from "./types";

interface StoredConnection extends CloudConnection {
  /** Never serialised to a client; used to build an ARM client. */
  readonly _kind: "azure";
}

const connections = new Map<string, StoredConnection>();
const inventories = new Map<string, AzureInventory>();
const workspaceLinks = new Map<string, WorkspaceCloudLink>();

function newId() {
  return `conn-${crypto.randomUUID().slice(0, 8)}`;
}

export function listConnections(): CloudConnection[] {
  return [...connections.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getConnection(id: string): CloudConnection | null {
  return connections.get(id) ?? null;
}

export interface CreateConnectionOptions extends AzureConnectionInput {
  createdBy: string;
  status: CloudConnectionStatus;
  statusDetail?: string | null;
  subscriptionName?: string | null;
  tenantName?: string | null;
  resourceGroupCount?: number;
  vmCount?: number;
  verified?: boolean;
}

export async function createConnection(options: CreateConnectionOptions): Promise<CloudConnection> {
  const id = newId();
  // Secret goes straight to the vault; only the reference is stored.
  const secretReference = await putConnectionSecret(id, options.clientSecret);
  const now = new Date().toISOString();
  const record: StoredConnection = {
    _kind: "azure",
    id,
    name: options.name,
    provider: "azure",
    tenantId: options.tenantId,
    tenantName: options.tenantName ?? null,
    subscriptionId: options.subscriptionId,
    subscriptionName: options.subscriptionName ?? null,
    clientId: options.clientId,
    secretReference,
    authenticationType: "service-principal",
    status: options.status,
    statusDetail: options.statusDetail ?? null,
    description: options.description ?? "",
    defaultResourceGroup: options.defaultResourceGroup?.trim() || null,
    defaultRegion: options.defaultRegion?.trim() || null,
    createdBy: options.createdBy,
    createdAt: now,
    lastVerifiedAt: options.verified ? now : null,
    lastSyncAt: null,
    resourceGroupCount: options.resourceGroupCount ?? 0,
    vmCount: options.vmCount ?? 0,
  };
  connections.set(id, record);
  return record;
}

export interface UpdateConnectionOptions {
  name?: string;
  description?: string;
  defaultResourceGroup?: string | null;
  defaultRegion?: string | null;
  tenantId?: string;
  subscriptionId?: string;
  clientId?: string;
  /** Optional rotation: when present the vault entry is overwritten. */
  clientSecret?: string;
}

export async function updateConnection(id: string, patch: UpdateConnectionOptions): Promise<CloudConnection | null> {
  const record = connections.get(id);
  if (!record) return null;
  if (patch.clientSecret) {
    const { writeConnectionSecret } = await import("./secret-vault.server");
    const write = await writeConnectionSecret(id, patch.clientSecret);
    const { recordSecurityEvent } = await import("@/lib/db/security-audit.server");
    await recordSecurityEvent({
      action: "CLOUD_SECRET_ROTATED",
      targetType: "cloud_connection",
      targetId: id,
      target: record.name,
      detail: `Credential rotated in ${write.storedIn === "azure-key-vault" ? "Key Vault" : "the local encrypted store"}`,
      metadata: { storedIn: write.storedIn, version: write.version, rotatedAt: write.rotatedAt },
    });
  }
  const next: StoredConnection = {
    ...record,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.defaultResourceGroup !== undefined ? { defaultResourceGroup: patch.defaultResourceGroup || null } : {}),
    ...(patch.defaultRegion !== undefined ? { defaultRegion: patch.defaultRegion || null } : {}),
    ...(patch.tenantId ? { tenantId: patch.tenantId } : {}),
    ...(patch.subscriptionId ? { subscriptionId: patch.subscriptionId } : {}),
    ...(patch.clientId ? { clientId: patch.clientId } : {}),
    secretReference: secretReferenceFor(id),
  };
  connections.set(id, next);
  return next;
}

export function markConnectionStatus(
  id: string,
  status: CloudConnectionStatus,
  detail: string | null,
  extras: Partial<Pick<CloudConnection, "subscriptionName" | "tenantName" | "resourceGroupCount" | "vmCount" | "lastSyncAt">> = {},
): CloudConnection | null {
  const record = connections.get(id);
  if (!record) return null;
  const next: StoredConnection = {
    ...record,
    ...extras,
    status,
    statusDetail: detail,
    lastVerifiedAt: new Date().toISOString(),
  };
  connections.set(id, next);
  return next;
}

export async function deleteConnection(id: string): Promise<boolean> {
  if (!connections.has(id)) return false;
  connections.delete(id);
  inventories.delete(id);
  for (const [workspaceId, link] of workspaceLinks) {
    if (link.cloudConnectionId === id) workspaceLinks.delete(workspaceId);
  }
  await deleteConnectionSecret(id);
  return true;
}

/** Resolve the credentials for a connection and build an ARM client. */
export async function armClientFor(id: string): Promise<AzureArmClient | null> {
  const record = connections.get(id);
  if (!record) return null;
  const clientSecret = await resolveSecret(record.secretReference);
  if (!clientSecret) return null;
  const credentials: AzureCredentials = {
    tenantId: record.tenantId,
    clientId: record.clientId,
    clientSecret,
    subscriptionId: record.subscriptionId,
  };
  return new AzureArmClient(credentials);
}

/* ------------------------------------------------------------ inventory ---- */

export function getInventory(id: string): AzureInventory | null {
  return inventories.get(id) ?? null;
}

export function putInventory(inventory: AzureInventory) {
  inventories.set(inventory.connectionId, inventory);
  const record = connections.get(inventory.connectionId);
  if (record) {
    connections.set(inventory.connectionId, {
      ...record,
      lastSyncAt: inventory.syncedAt,
      resourceGroupCount: inventory.resourceGroups.length,
      vmCount: inventory.virtualMachines.length,
      subscriptionName: inventory.subscriptionName ?? record.subscriptionName,
    });
  }
}

/* ------------------------------------------------------- workspace links --- */

export function listWorkspaceLinks(): WorkspaceCloudLink[] {
  return [...workspaceLinks.values()];
}

export function getWorkspaceLink(workspaceId: string): WorkspaceCloudLink | null {
  return workspaceLinks.get(workspaceId) ?? null;
}

export function setWorkspaceLink(link: Omit<WorkspaceCloudLink, "linkedAt">): WorkspaceCloudLink {
  const record: WorkspaceCloudLink = { ...link, linkedAt: new Date().toISOString() };
  workspaceLinks.set(link.workspaceId, record);
  return record;
}

export function removeWorkspaceLink(workspaceId: string): boolean {
  return workspaceLinks.delete(workspaceId);
}

/**
 * A workspace only ever reaches the subscription it is explicitly bound to.
 * No binding means no cloud access — never a fallback to another connection.
 */
export async function connectionForWorkspace(
  workspaceId: string,
): Promise<{ connection: CloudConnection; link: WorkspaceCloudLink } | null> {
  const link = workspaceLinks.get(workspaceId);
  if (!link || link.status !== "active") return null;
  const connection = connections.get(link.cloudConnectionId);
  if (!connection) return null;
  return { connection, link };
}
