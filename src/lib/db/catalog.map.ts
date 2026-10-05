/**
 * Row -> DTO mapping for the catalogue.
 *
 * The database is the source of truth, but the console still speaks the
 * domain vocabulary declared in `@/lib/mock-data` (types only). Keeping the
 * translation in one client-safe module means repositories and API routes
 * cannot drift from what the UI renders.
 */
import type {
  AccessType,
  Lab,
  LabAssignment,
  LabSession,
  LabStatus,
  ManagedUser,
  Role,
  Template,
  Workspace,
  WorkspaceUser,
} from "@/lib/mock-data";
import { EVENT_CATEGORY, type PlatformEvent, type PlatformEventType } from "@/lib/activity";
import {
  PERSISTENT_DEFAULTS,
  type AssignmentAccess,
  type PersistencePolicy,
} from "@/lib/labs/persistence";

export type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/* ---------------------------------------------------------------- workspace */

export function workspaceStatus(dbStatus: string): Workspace["status"] {
  if (dbStatus === "active") return "published";
  if (dbStatus === "draft") return "draft";
  return "archived";
}

export function toDbWorkspaceStatus(status: Workspace["status"], enabled: boolean): "active" | "draft" | "archived" | "suspended" {
  if (status === "archived") return "archived";
  if (status === "draft") return "draft";
  return enabled ? "active" : "suspended";
}

export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  organization_name: string;
  default_template_id: string | null;
  access_type: string;
  public_landing: unknown;
  status: string;
  created_by: string | null;
  created_at: string;
}

export function mapWorkspace(
  row: WorkspaceRow,
  ctx: {
    templateName?: string | undefined;
    region?: string | undefined;
    labs?: number;
    users?: number;
    activeSessions?: number;
    createdByEmail?: string | undefined;
  } = {},
): Workspace {
  const landing = asRecord(row.public_landing);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? "",
    org: row.organization_name,
    template: ctx.templateName ?? "Unassigned",
    templateId: row.default_template_id ?? "",
    accessType: (row.access_type as AccessType) ?? "WORKSPACE_URL",
    publicLanding: landing["enabled"] === true,
    enabled: row.status === "active",
    createdBy: ctx.createdByEmail ?? row.created_by ?? "",
    status: workspaceStatus(row.status),
    labs: ctx.labs ?? 0,
    users: ctx.users ?? 0,
    activeSessions: ctx.activeSessions ?? 0,
    region: ctx.region ?? "",
    createdAt: row.created_at.slice(0, 10),
  };
}

/* ----------------------------------------------------------------- template */

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  cloud_provider: string;
  operating_system: string;
  vm_size: string;
  region: string;
  image: string;
  configuration: unknown;
  status: string;
}

export function mapTemplate(row: TemplateRow, usedBy = 0): Template {
  const config = asRecord(row.configuration);
  const entries = asArray(config["entries"]) as { key: string; value: string }[];
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    cloudProvider: row.cloud_provider === "azure" ? "Azure" : (row.cloud_provider as Template["cloudProvider"]),
    os: row.operating_system,
    vmSize: row.vm_size,
    image: row.image,
    region: row.region,
    configuration: entries.filter((e) => e && typeof e.key === "string"),
    enabled: row.status === "active",
    software: (asArray(config["software"]) as string[]).filter((s) => typeof s === "string"),
    usedBy,
  };
}

export function toTemplateConfiguration(input: Pick<Template, "configuration" | "software">): Json {
  return { entries: input.configuration ?? [], software: input.software ?? [] };
}

/* ---------------------------------------------------------------------- lab */

export function labStatus(dbStatus: string): LabStatus {
  if (dbStatus === "published") return "published";
  if (dbStatus === "archived") return "unpublished";
  return "draft";
}

export function toDbLabStatus(status: LabStatus): "draft" | "configured" | "published" | "archived" {
  if (status === "published") return "published";
  if (status === "unpublished") return "archived";
  return "draft";
}

export interface LabRow {
  id: string;
  workspace_id: string;
  template_id: string | null;
  title: string;
  description: string | null;
  instructions: string | null;
  status: string;
  duration_minutes: number;
  published_at: string | null;
  max_extensions?: number | null;
  lab_mode?: string | null;
  default_access_days?: number | null;
  default_allowed_minutes?: number | null;
  idle_shutdown_minutes?: number | null;
  persistence_policy?: string | null;
  reset_on_access_end?: boolean | null;
}

/**
 * `labs.instructions` carries the authoring payload (objectives, level, tags)
 * as JSON. Phase 2 promotes these to real columns.
 */
export function readLabMeta(instructions: string | null): {
  objectives: string[];
  level: Lab["level"];
  tags: string[];
} {
  try {
    const parsed = JSON.parse(instructions ?? "{}") as Json;
    return {
      objectives: (asArray(parsed["objectives"]) as string[]).filter((o) => typeof o === "string"),
      level: (parsed["level"] as Lab["level"]) ?? "Beginner",
      tags: (asArray(parsed["tags"]) as string[]).filter((t) => typeof t === "string"),
    };
  } catch {
    return { objectives: [], level: "Beginner", tags: [] };
  }
}

export function writeLabMeta(meta: { objectives: string[]; level: Lab["level"]; tags: string[] }): string {
  return JSON.stringify(meta);
}

export function mapLab(
  row: LabRow,
  ctx: { workspaceSlug?: string | undefined; vmSize?: string | undefined } = {},
): Lab {
  const meta = readLabMeta(row.instructions);
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    objectives: meta.objectives,
    workspaceId: row.workspace_id,
    workspaceSlug: ctx.workspaceSlug ?? "",
    templateId: row.template_id ?? "",
    durationMinutes: row.duration_minutes,
    duration: row.duration_minutes,
    level: meta.level,
    status: labStatus(row.status),
    publishedAt: row.published_at ? row.published_at.slice(0, 10) : null,
    tags: meta.tags,
    vmSize: ctx.vmSize ?? "Standard_D2s_v5",
    labMode: row.lab_mode === "persistent" ? "persistent" : "session_based",
    maxExtensions: row.max_extensions ?? 1,
    defaultAccessDays: row.default_access_days ?? PERSISTENT_DEFAULTS.accessDays,
    defaultAllowedMinutes: row.default_allowed_minutes ?? PERSISTENT_DEFAULTS.allowedMinutes,
    idleShutdownMinutes: row.idle_shutdown_minutes ?? PERSISTENT_DEFAULTS.idleShutdownMinutes,
    persistencePolicy: (row.persistence_policy as PersistencePolicy) ?? PERSISTENT_DEFAULTS.persistencePolicy,
    resetOnAccessEnd: row.reset_on_access_end ?? PERSISTENT_DEFAULTS.resetOnAccessEnd,
  };
}

/* ------------------------------------------------------------ memberships */

const accountStatus = (status: string): WorkspaceUser["status"] =>
  status === "invited" ? "invited" : status === "active" ? "active" : "suspended";

export interface WorkspaceUserRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  status: string;
  capabilities: string[] | null;
}

export function mapWorkspaceUser(row: WorkspaceUserRow): WorkspaceUser {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: (row.role as Role) ?? "user",
    status: accountStatus(row.status),
  };
}

export interface AssignmentRow {
  id: string;
  lab_id: string;
  workspace_id: string;
  user_id: string;
  status: string;
  access_starts_at?: string | null;
  access_ends_at?: string | null;
  allowed_minutes?: number | null;
  used_minutes?: number | null;
  remaining_minutes?: number | null;
  persistent_vm_id?: string | null;
  last_started_at?: string | null;
  last_stopped_at?: string | null;
}

export function mapAssignment(row: AssignmentRow): LabAssignment {
  return {
    id: row.id,
    userId: row.user_id,
    labId: row.lab_id,
    workspaceId: row.workspace_id,
    status: (row.status as LabAssignment["status"]) ?? "assigned",
    access: mapAssignmentAccess(row),
  };
}

export function mapAssignmentAccess(row: AssignmentRow): AssignmentAccess {
  const allowed = row.allowed_minutes ?? null;
  const used = row.used_minutes ?? 0;
  return {
    accessStartsAt: row.access_starts_at ?? null,
    accessEndsAt: row.access_ends_at ?? null,
    allowedMinutes: allowed,
    usedMinutes: used,
    remainingMinutes: row.remaining_minutes ?? Math.max(0, (allowed ?? 0) - used),
    persistentVmId: row.persistent_vm_id ?? null,
    lastStartedAt: row.last_started_at ?? null,
    lastStoppedAt: row.last_stopped_at ?? null,
  };
}

/* --------------------------------------------------------------- profiles */

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  last_sign_in_at: string | null;
}

export function mapManagedUser(row: ProfileRow, role: Role, workspace: string): ManagedUser {
  return {
    id: row.id,
    name: row.full_name ?? row.email,
    email: row.email,
    role,
    workspace,
    status: accountStatus(row.status),
    lastActive: row.last_sign_in_at ? new Date(row.last_sign_in_at).toLocaleString() : "—",
  };
}

/* --------------------------------------------------------------- sessions */

export interface SessionRow {
  id: string;
  lab_id: string;
  user_id: string;
  workspace_id: string;
  status: string;
  vm_id: string | null;
  vm_name: string | null;
  lab_title: string | null;
  workspace_name: string | null;
  user_name: string | null;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
}

export function mapSession(row: SessionRow): LabSession {
  const status: LabSession["status"] =
    row.status === "ACTIVE" || row.status === "PENDING" || row.status === "CREATING" || row.status === "STARTING"
      ? "active"
      : row.status === "EXPIRED"
        ? "expired"
        : "completed";
  const remaining =
    status === "active" ? Math.max(0, Math.round((new Date(row.expires_at).getTime() - Date.now()) / 60_000)) : 0;
  return {
    id: row.id,
    labTitle: row.lab_title ?? "Lab",
    workspace: row.workspace_name ?? "",
    user: row.user_name ?? "",
    userId: row.user_id,
    labId: row.lab_id,
    status,
    startedAt: new Date(row.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    remainingMinutes: remaining,
    vm: row.vm_name ?? "—",
    ...(row.vm_id ? { vmId: row.vm_id } : {}),
    expiresAt: row.expires_at,
  };
}

/* ------------------------------------------------------------ activity log */

export interface ActivityRow {
  id: string;
  at: string;
  actor_name: string | null;
  action: string;
  target_id: string | null;
  detail: string | null;
  workspace_id: string | null;
  metadata: unknown;
}

export function mapActivity(row: ActivityRow): PlatformEvent {
  const type = (row.action in EVENT_CATEGORY ? row.action : "ERROR") as PlatformEventType;
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    type,
    category: EVENT_CATEGORY[type],
    actor: row.actor_name ?? "System",
    target: (metadata["target"] as string) ?? row.target_id ?? "",
    detail: row.detail ?? "",
    at: row.at,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
  };
}
