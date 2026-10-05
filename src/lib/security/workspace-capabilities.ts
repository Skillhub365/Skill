/**
 * Per-workspace capability grants.
 *
 * The role matrix in `types.ts` decides what a role *may* do platform-wide;
 * a grant narrows that further to "this user, in this workspace". Only the
 * cloud and VM capabilities are delegable — nothing here can grant a learner
 * something their role does not already permit at the platform level.
 */

export type WorkspaceCapability =
  | "cloud:read"
  | "cloud:manage"
  | "vm:manage"
  | "vm:connect:own"
  | "session:manage"
  | "audit:read";

export interface WorkspaceCapabilityMeta {
  id: WorkspaceCapability;
  label: string;
  description: string;
  group: "cloud" | "vm" | "audit";
  /** Sensitive grants are highlighted in the admin UI. */
  privileged?: boolean;
}

export const WORKSPACE_CAPABILITIES: WorkspaceCapabilityMeta[] = [
  {
    id: "cloud:read",
    label: "View cloud resources",
    description: "See the connection, resource group and VM inventory mapped to this workspace.",
    group: "cloud",
  },
  {
    id: "cloud:manage",
    label: "Manage cloud connection",
    description: "Test the connection and refresh Azure resources for this workspace.",
    group: "cloud",
    privileged: true,
  },
  {
    id: "vm:manage",
    label: "Start / stop virtual machines",
    description: "Power VMs in the mapped resource group on and off.",
    group: "vm",
    privileged: true,
  },
  {
    id: "vm:connect:own",
    label: "Connect to own VM",
    description: "Open a remote desktop to virtual machines from their own sessions.",
    group: "vm",
  },
  {
    id: "session:manage",
    label: "Manage sessions",
    description: "Extend or terminate any lab session inside this workspace.",
    group: "vm",
    privileged: true,
  },
  {
    id: "audit:read",
    label: "Read audit trail",
    description: "Read the cloud and VM audit log scoped to this workspace.",
    group: "audit",
  },
];

export const WORKSPACE_CAPABILITY_LABEL: Record<WorkspaceCapability, string> = Object.fromEntries(
  WORKSPACE_CAPABILITIES.map((c) => [c.id, c.label]),
) as Record<WorkspaceCapability, string>;

export interface WorkspaceCapabilityGrant {
  id: string;
  workspaceId: string;
  userId: string;
  capabilities: WorkspaceCapability[];
  grantedBy: string;
  grantedAt: string;
}

/** Ready-made bundles so common roles can be applied in one click. */
export const CAPABILITY_PRESETS: { id: string; label: string; capabilities: WorkspaceCapability[] }[] = [
  { id: "learner", label: "Learner", capabilities: ["vm:connect:own"] },
  { id: "operator", label: "Lab operator", capabilities: ["cloud:read", "vm:manage", "vm:connect:own", "session:manage"] },
  { id: "auditor", label: "Auditor", capabilities: ["cloud:read", "audit:read"] },
  {
    id: "cloud-admin",
    label: "Workspace cloud admin",
    capabilities: ["cloud:read", "cloud:manage", "vm:manage", "vm:connect:own", "session:manage", "audit:read"],
  },
];
