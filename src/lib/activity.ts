/** Platform-wide audit vocabulary shared by the admin console (Phase 7). */
export type PlatformEventType =
  | "LOGIN"
  | "WORKSPACE_CREATED"
  | "WORKSPACE_UPDATED"
  | "WORKSPACE_PUBLISHED"
  | "WORKSPACE_DISABLED"
  | "TEMPLATE_CREATED"
  | "TEMPLATE_UPDATED"
  | "LAB_CREATED"
  | "LAB_PUBLISHED"
  | "LAB_UNPUBLISHED"
  | "USER_CREATED"
  | "USER_REMOVED"
  | "USER_STATUS_CHANGED"
  | "USER_ASSIGNED"
  | "LAB_ASSIGNED"
  | "LAB_UNASSIGNED"
  | "LAB_STARTED"
  | "VM_START_REQUESTED"
  | "VM_STARTED"
  | "VM_READY"
  | "VM_STOPPED"
  | "VM_ADMIN_ACTION"
  | "CONNECTION_CREATED"
  | "CONNECTION_TERMINATED"
  | "SESSION_EXPIRED"
  | "SESSION_STOPPED"
  | "MCP_TOOL_CALLED"
  | "MCP_TOOL_DENIED"
  | "ERROR";

export type EventCategory = "auth" | "workspace" | "template" | "lab" | "user" | "vm" | "session" | "agent" | "error";

export interface PlatformEvent {
  id: string;
  type: PlatformEventType;
  category: EventCategory;
  actor: string;
  target: string;
  detail: string;
  at: string;
  workspaceId?: string;
}

export const EVENT_CATEGORY: Record<PlatformEventType, EventCategory> = {
  LOGIN: "auth",
  WORKSPACE_CREATED: "workspace",
  WORKSPACE_UPDATED: "workspace",
  WORKSPACE_PUBLISHED: "workspace",
  WORKSPACE_DISABLED: "workspace",
  TEMPLATE_CREATED: "template",
  TEMPLATE_UPDATED: "template",
  LAB_CREATED: "lab",
  LAB_PUBLISHED: "lab",
  LAB_UNPUBLISHED: "lab",
  USER_CREATED: "user",
  USER_REMOVED: "user",
  USER_STATUS_CHANGED: "user",
  USER_ASSIGNED: "user",
  LAB_ASSIGNED: "user",
  LAB_UNASSIGNED: "user",
  LAB_STARTED: "session",
  VM_START_REQUESTED: "vm",
  VM_STARTED: "vm",
  VM_READY: "vm",
  VM_STOPPED: "vm",
  VM_ADMIN_ACTION: "vm",
  CONNECTION_CREATED: "session",
  CONNECTION_TERMINATED: "session",
  SESSION_EXPIRED: "session",
  SESSION_STOPPED: "session",
  MCP_TOOL_CALLED: "agent",
  MCP_TOOL_DENIED: "agent",
  ERROR: "error",
};

export const CATEGORY_TONE: Record<EventCategory, string> = {
  auth: "bg-slate-500/10 text-slate-700 border-slate-500/20",
  workspace: "bg-indigo-500/10 text-indigo-700 border-indigo-500/20",
  template: "bg-violet-500/10 text-violet-700 border-violet-500/20",
  lab: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  user: "bg-teal-500/10 text-teal-700 border-teal-500/20",
  vm: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  session: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  agent: "bg-fuchsia-500/10 text-fuchsia-700 border-fuchsia-500/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
};

export const EVENT_CATEGORIES: EventCategory[] = [
  "auth",
  "workspace",
  "template",
  "lab",
  "user",
  "vm",
  "session",
  "agent",
  "error",
];

export function makeEvent(
  type: PlatformEventType,
  actor: string,
  target: string,
  detail: string,
  workspaceId?: string,
): PlatformEvent {
  return {
    id: `ev-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    type,
    category: EVENT_CATEGORY[type],
    actor,
    target,
    detail,
    at: new Date().toISOString(),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

/** Deterministic seed history so a fresh console is not empty. */
export const seedEvents: PlatformEvent[] = [
  { id: "ev-s1", type: "WORKSPACE_CREATED", category: "workspace", actor: "Satish Kumar", target: "Azure AI Training - ABC Corp", detail: "Workspace created with template Azure AI Workstation", at: "2026-05-12T09:14:00.000Z", workspaceId: "ws-1" },
  { id: "ev-s2", type: "LAB_CREATED", category: "lab", actor: "Satish Kumar", target: "Deploy an Azure OpenAI Chat App", detail: "Lab authored in Azure AI Training - ABC Corp", at: "2026-05-18T11:02:00.000Z", workspaceId: "ws-1" },
  { id: "ev-s3", type: "LAB_PUBLISHED", category: "lab", actor: "Satish Kumar", target: "Deploy an Azure OpenAI Chat App", detail: "Published to the workspace catalog", at: "2026-05-20T08:31:00.000Z", workspaceId: "ws-1" },
  { id: "ev-s4", type: "USER_ASSIGNED", category: "user", actor: "Satish Kumar", target: "priya@abccorp.com", detail: "Added to Azure AI Training - ABC Corp", at: "2026-05-20T08:44:00.000Z", workspaceId: "ws-1" },
  { id: "ev-s5", type: "WORKSPACE_PUBLISHED", category: "workspace", actor: "Satish Kumar", target: "DevOps Bootcamp - Contoso", detail: "Workspace published to learners", at: "2026-06-01T15:20:00.000Z", workspaceId: "ws-2" },
  { id: "ev-s6", type: "VM_READY", category: "vm", actor: "Orchestrator", target: "contoso-devops-07", detail: "Readiness probe passed in West Europe", at: "2026-06-02T10:05:00.000Z", workspaceId: "ws-2" },
];
