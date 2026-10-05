/**
 * Client-safe model for Super Admin infrastructure provisioning.
 *
 * The browser describes *what* the lab footprint should look like; the server
 * creates it in Azure. No credential, object id or Azure token is ever part of
 * this model.
 */

export type ProvisionStepId =
  | "resource-group"
  | "network"
  | "role-assignment"
  | "lab-credentials";

export const PROVISION_STEP_LABEL: Record<ProvisionStepId, string> = {
  "resource-group": "Resource group",
  network: "Virtual network and subnet",
  "role-assignment": "Service principal role",
  "lab-credentials": "Lab VM administrator",
};

export type ProvisionStepState = "ok" | "created" | "skipped" | "failed" | "manual";

export interface ProvisionStep {
  id: ProvisionStepId;
  state: ProvisionStepState;
  detail: string;
  /** Stable code for failures, e.g. AZURE_PERMISSION_DENIED. */
  errorCode?: string | null;
  /** Azure CLI the operator can run when the platform is not allowed to. */
  remediation?: string | null;
}

/** Roles the platform can grant to its own service principal. */
export type LabRole = "Contributor" | "Virtual Machine Contributor" | "Network Contributor";

export const LAB_ROLE_IDS: Record<LabRole, string> = {
  Contributor: "b24988ac-6180-42a0-ab88-20f7382dd24c",
  "Virtual Machine Contributor": "9980e02c-c2be-4d73-94e8-173b1dc7cf3c",
  "Network Contributor": "4d97b98b-1d4f-4787-a291-c67834d212e7",
};

export interface ProvisionRequest {
  connectionId: string;
  resourceGroup: string;
  region: string;
  vnetName: string;
  subnetName: string;
  /** CIDR blocks; defaulted server-side when omitted. */
  addressSpace?: string;
  subnetPrefix?: string;
  /** Roles to grant the connection's service principal on the resource group. */
  roles?: LabRole[];
  /** Windows administrator baked into the lab image. Never returned. */
  labUsername?: string;
  labPassword?: string;
  /** Persist these values as the connection's defaults after a successful run. */
  setAsDefault?: boolean;
}

export interface RoleAssignmentView {
  role: string;
  scope: string;
}

/** Read-only view of what exists in Azure right now. */
export interface InfrastructureState {
  connectionId: string;
  subscriptionName: string | null;
  resourceGroup: string | null;
  resourceGroupExists: boolean;
  region: string | null;
  vnetName: string | null;
  vnetExists: boolean;
  subnetName: string | null;
  subnetExists: boolean;
  subnetPrefix: string | null;
  /** Roles the service principal already holds at or above the group scope. */
  roles: RoleAssignmentView[];
  canManageVms: boolean;
  canManageNetwork: boolean;
  /** True when the platform could read role assignments at all. */
  rolesReadable: boolean;
  labCredentialsConfigured: boolean;
  labUsername: string | null;
  regions: string[];
  resourceGroups: Array<{ name: string; location: string }>;
}

export interface ProvisionResult {
  ok: boolean;
  steps: ProvisionStep[];
  state: InfrastructureState;
}

/** Azure requires 12-123 chars with three of four character classes. */
export function validateLabPassword(password: string): string | null {
  if (password.length < 12 || password.length > 123) return "Password must be 12-123 characters.";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) return "Use at least three of: lowercase, uppercase, digits, symbols.";
  return null;
}

const FORBIDDEN_USERNAMES = new Set([
  "administrator", "admin", "user", "user1", "test", "guest", "root", "console", "1", "actuser", "adm", "admin1", "admin2", "aspnet", "backup", "owner", "server", "sql", "support", "sys", "test1", "test2", "test3", "user2", "user3", "video",
]);

export function validateLabUsername(username: string): string | null {
  if (!/^[A-Za-z][A-Za-z0-9._-]{1,19}$/.test(username)) {
    return "1-20 characters, starting with a letter.";
  }
  if (FORBIDDEN_USERNAMES.has(username.toLowerCase())) return "Azure reserves this username.";
  return null;
}

export function validateName(kind: string, value: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,78}[A-Za-z0-9_]$/.test(value)) {
    return `${kind} must be 2-80 characters of letters, digits, dot, dash or underscore.`;
  }
  return null;
}

export function validateCidr(value: string): string | null {
  return /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(value) ? null : "Enter a CIDR block such as 10.20.0.0/16.";
}
