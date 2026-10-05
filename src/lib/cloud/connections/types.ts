/**
 * Client-safe cloud connection model.
 *
 * A CloudConnection is one configured cloud subscription (today: one Azure
 * subscription reached through a service principal). The platform supports any
 * number of them; nothing here assumes a single global credential.
 *
 * The client secret NEVER appears in this model. The database/registry stores
 * only a `secretReference` such as
 *   keyvault://skilltrack/azure/conn-123-secret
 * and the value is resolved server-side when a call to Azure is made.
 */

export type CloudProviderId = "azure" | "aws" | "gcp";

export type CloudConnectionStatus =
  | "CONNECTED"
  | "AUTHENTICATION_ERROR"
  | "PERMISSION_ERROR"
  | "SUBSCRIPTION_ERROR"
  | "UNAVAILABLE"
  | "DISCONNECTED";

export const CONNECTION_STATUS_LABEL: Record<CloudConnectionStatus, string> = {
  CONNECTED: "Connected",
  AUTHENTICATION_ERROR: "Authentication error",
  PERMISSION_ERROR: "Insufficient permissions",
  SUBSCRIPTION_ERROR: "Invalid subscription",
  UNAVAILABLE: "Azure unavailable",
  DISCONNECTED: "Disconnected",
};

export type AuthenticationType = "service-principal" | "managed-identity";

/** Safe projection returned by the API. No secret, ever. */
export interface CloudConnection {
  id: string;
  name: string;
  provider: CloudProviderId;
  tenantId: string;
  tenantName: string | null;
  subscriptionId: string;
  subscriptionName: string | null;
  clientId: string;
  /** Pointer into the secret store — not the secret itself. */
  secretReference: string;
  authenticationType: AuthenticationType;
  status: CloudConnectionStatus;
  statusDetail: string | null;
  description: string;
  defaultResourceGroup: string | null;
  defaultRegion: string | null;
  createdBy: string;
  createdAt: string;
  lastVerifiedAt: string | null;
  lastSyncAt: string | null;
  resourceGroupCount: number;
  vmCount: number;
}

/** Steps reported live while a connection is validated against Azure. */
export type ValidationStepId =
  | "authenticate"
  | "connect"
  | "subscription"
  | "resource-groups"
  | "permissions";

export const VALIDATION_STEP_LABEL: Record<ValidationStepId, string> = {
  authenticate: "Authenticating",
  connect: "Connecting to Azure",
  subscription: "Validating subscription",
  "resource-groups": "Loading resource groups",
  permissions: "Checking permissions",
};

export interface ValidationStep {
  id: ValidationStepId;
  state: "ok" | "failed" | "skipped";
  detail: string;
  durationMs: number;
}

export interface ValidationResult {
  ok: boolean;
  status: CloudConnectionStatus;
  message: string;
  steps: ValidationStep[];
  subscriptionName: string | null;
  tenantId: string | null;
  resourceGroups: string[];
  /** RBAC actions the principal is allowed to perform, as reported by Azure. */
  permissions: { action: string; label: string; allowed: boolean }[];
  verifiedAt: string;
}

/** Real Azure inventory, cached server-side after a refresh. */
export interface AzureResourceGroup {
  name: string;
  location: string;
  provisioningState: string | null;
}

export interface AzureVirtualMachine {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  vmSize: string;
  osType: string;
  powerState: string;
  provisioningState: string;
}

export interface AzureInventory {
  connectionId: string;
  subscriptionId: string;
  subscriptionName: string | null;
  resourceGroups: AzureResourceGroup[];
  virtualMachines: AzureVirtualMachine[];
  regions: string[];
  vmSizes: string[];
  syncedAt: string;
}

/** Explicit workspace -> subscription binding. No implicit access. */
export interface WorkspaceCloudLink {
  workspaceId: string;
  cloudConnectionId: string;
  resourceGroup: string;
  defaultRegion: string;
  status: "active" | "suspended";
  linkedAt: string;
}

export const REQUIRED_AZURE_ACTIONS: { action: string; label: string }[] = [
  { action: "Microsoft.Resources/subscriptions/resourceGroups/read", label: "Read resource groups" },
  { action: "Microsoft.Compute/virtualMachines/read", label: "Read virtual machines" },
  { action: "Microsoft.Compute/virtualMachines/start/action", label: "Start virtual machines" },
  { action: "Microsoft.Compute/virtualMachines/deallocate/action", label: "Stop / deallocate virtual machines" },
  { action: "Microsoft.Compute/virtualMachines/instanceView/read", label: "Read VM runtime status" },
];

/** Draft credentials submitted from the admin form. Server-side types only. */
export interface AzureConnectionInput {
  name: string;
  tenantId: string;
  subscriptionId: string;
  clientId: string;
  clientSecret: string;
  defaultResourceGroup?: string;
  defaultRegion?: string;
  description?: string;
}

export function maskId(value: string | null | undefined) {
  if (!value) return "—";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 8)}••••••••••••${value.slice(-4)}`;
}
