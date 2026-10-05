export type Role = "superadmin" | "admin" | "user";

export type AccessType = "WORKSPACE_URL" | "USER_SESSION_URL";

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description: string;
  org: string;
  template: string;
  templateId: string;
  accessType: AccessType;
  /** When true, unauthenticated visitors see a branded landing page + public catalogue. */
  publicLanding: boolean;
  enabled: boolean;
  createdBy: string;
  status: "published" | "draft" | "archived";
  labs: number;
  users: number;
  activeSessions: number;
  region: string;
  createdAt: string;
}

export type LabStatus = "draft" | "published" | "unpublished";

export interface Lab {
  id: string;
  title: string;
  description: string;
  objectives: string[];
  workspaceId: string;
  workspaceSlug: string;
  templateId: string;
  durationMinutes: number;
  duration: number; // alias kept for existing views
  level: "Beginner" | "Intermediate" | "Advanced";
  status: LabStatus;
  publishedAt: string | null;
  tags: string[];
  vmSize: string;
  progress?: number;
  /** Session-based (default) or persistent multi-day lab. */
  labMode: import("./labs/persistence").LabMode;
  maxExtensions: number;
  defaultAccessDays: number;
  defaultAllowedMinutes: number;
  idleShutdownMinutes: number;
  persistencePolicy: import("./labs/persistence").PersistencePolicy;
  resetOnAccessEnd: boolean;
}

export interface WorkspaceUser {
  id: string;
  workspaceId: string;
  userId: string;
  role: Role;
  status: "active" | "invited" | "suspended";
}

export interface LabAssignment {
  id: string;
  userId: string;
  labId: string;
  workspaceId: string;
  status: "assigned" | "in_progress" | "completed" | "revoked";
  /** Persistent-lab grant. Empty defaults for session-based labs. */
  access: import("./labs/persistence").AssignmentAccess;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  cloudProvider: "Azure" | "AWS" | "GCP";
  os: string;
  vmSize: string;
  image: string;
  region: string;
  configuration: { key: string; value: string }[];
  enabled: boolean;
  software: string[];
  usedBy: number;
}

export interface WorkspaceTemplate {
  workspaceId: string;
  templateId: string;
}

export const cloudProviders = ["Azure", "AWS", "GCP"] as const;
export const operatingSystems = [
  "Windows Server 2022",
  "Windows 11 Enterprise",
  "Ubuntu 24.04 LTS",
  "Ubuntu 22.04 LTS",
  "Red Hat Enterprise Linux 9",
];
export const vmSizes = [
  "Standard_B2ms",
  "Standard_D2s_v5",
  "Standard_D4s_v5",
  "Standard_D8s_v5",
  "Standard_E4s_v5",
];
export const regions = ["East US", "West Europe", "UK South", "Central India", "Southeast Asia"];

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  workspace: string;
  status: "active" | "invited" | "suspended";
  lastActive: string;
}

export interface VirtualMachine {
  id: string;
  name: string;
  workspace: string;
  size: string;
  region: string;
  status: "running" | "stopped" | "provisioning";
  uptimeHours: number;
  assignedTo: string | null;
}

export interface LabSession {
  id: string;
  labTitle: string;
  workspace: string;
  user: string;
  status: "active" | "completed" | "expired";
  startedAt: string;
  remainingMinutes: number;
  vm: string;
  vmId?: string;
  labId?: string;
  userId?: string;
  expiresAt?: string | null;
  /** Authoritative server-side lifecycle record (Phase 6). */
  record?: import("./session/types").SessionRecord;
}

export interface SessionAuditEvent {
  id: string;
  sessionId: string;
  actor: string;
  action: string;
  detail: string;
  at: string;
}

export interface ActivityEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  at: string;
  kind: "workspace" | "lab" | "vm" | "session" | "user";
}
