import { db } from "./client.server";
import {
  mapActivity,
  mapAssignment,
  mapLab,
  mapManagedUser,
  mapSession,
  mapTemplate,
  mapWorkspace,
  mapWorkspaceUser,
  type ActivityRow,
  type AssignmentRow,
  type LabRow,
  type ProfileRow,
  type SessionRow,
  type TemplateRow,
  type WorkspaceRow,
  type WorkspaceUserRow,
} from "./catalog.map";
import type { PlatformEvent } from "@/lib/activity";
import type {
  Lab,
  LabAssignment,
  LabSession,
  ManagedUser,
  Role,
  Template,
  Workspace,
  WorkspaceUser,
} from "@/lib/mock-data";
import type { WorkspaceCapability, WorkspaceCapabilityGrant } from "@/lib/security/workspace-capabilities";

/**
 * Read side of the catalogue. Every query is tenant-scoped and narrowed again
 * by what the caller is actually allowed to see, so a learner can never widen
 * their view by calling the API directly.
 */

export interface CatalogPrincipal {
  sub: string;
  role: Role;
  tenantId: string | null;
  workspaceIds: string[];
  labIds: string[];
}

export interface CatalogSnapshot {
  workspaces: Workspace[];
  templates: Template[];
  labs: Lab[];
  workspaceUsers: WorkspaceUser[];
  labAssignments: LabAssignment[];
  capabilityGrants: WorkspaceCapabilityGrant[];
  sessions: LabSession[];
  users: ManagedUser[];
  events: PlatformEvent[];
}

const WORKSPACE_COLUMNS =
  "id, slug, name, description, organization_name, default_template_id, access_type, public_landing, status, created_by, created_at";
const TEMPLATE_COLUMNS =
  "id, name, description, cloud_provider, operating_system, vm_size, region, image, configuration, status";
const LAB_COLUMNS =
  "id, workspace_id, template_id, title, description, instructions, status, duration_minutes, published_at, max_extensions, lab_mode, default_access_days, default_allowed_minutes, idle_shutdown_minutes, persistence_policy, reset_on_access_end";
const ASSIGNMENT_COLUMNS =
  "id, lab_id, workspace_id, user_id, status, access_starts_at, access_ends_at, allowed_minutes, used_minutes, remaining_minutes, persistent_vm_id, last_started_at, last_stopped_at";
const SESSION_COLUMNS =
  "id, lab_id, user_id, workspace_id, status, vm_id, vm_name, lab_title, workspace_name, user_name, started_at, expires_at, ended_at";

export function isAdminRole(role: Role) {
  return role === "admin" || role === "superadmin";
}

/** Resolve the tenant a request operates in; superadmins may span tenants. */
export async function tenantIdFor(principal: CatalogPrincipal): Promise<string | null> {
  if (principal.tenantId) return principal.tenantId;
  if (principal.role !== "superadmin") return null;
  const supabase = await db();
  const { data } = await supabase.from("tenants").select("id").order("created_at").limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * The whole catalogue in one round trip, already filtered for the caller.
 * The console renders many cross-referenced tables, so a single snapshot beats
 * a dozen chatty endpoints.
 */
export async function loadCatalog(principal: CatalogPrincipal): Promise<CatalogSnapshot> {
  const supabase = await db();
  const tenantId = await tenantIdFor(principal);
  const admin = isAdminRole(principal.role);

  if (!tenantId) {
    return {
      workspaces: [], templates: [], labs: [], workspaceUsers: [], labAssignments: [],
      capabilityGrants: [], sessions: [], users: [], events: [],
    };
  }

  const [workspaceRes, templateRes, labRes, membershipRes, assignmentRes, sessionRes] = await Promise.all([
    supabase.from("workspaces").select(WORKSPACE_COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    supabase.from("templates").select(TEMPLATE_COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    supabase.from("labs").select(LAB_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("workspace_users").select("id, workspace_id, user_id, role, status, capabilities"),
    supabase.from("lab_assignments").select(ASSIGNMENT_COLUMNS),
    supabase.from("sessions").select(SESSION_COLUMNS).eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(200),
  ]);

  const workspaceRows = (workspaceRes.data ?? []) as WorkspaceRow[];
  const workspaceIds = new Set(workspaceRows.map((w) => w.id));
  const templateRows = (templateRes.data ?? []) as TemplateRow[];
  const labRows = ((labRes.data ?? []) as LabRow[]).filter((l) => workspaceIds.has(l.workspace_id));
  const membershipRows = ((membershipRes.data ?? []) as WorkspaceUserRow[]).filter((m) => workspaceIds.has(m.workspace_id));
  const assignmentRows = ((assignmentRes.data ?? []) as AssignmentRow[]).filter(
    (a) => workspaceIds.has(a.workspace_id) && a.status !== "revoked",
  );
  const sessionRows = (sessionRes.data ?? []) as SessionRow[];

  const templateById = new Map(templateRows.map((t) => [t.id, t]));

  // Visibility narrowing: learners see only their own membership footprint.
  const visibleWorkspaceIds = admin
    ? new Set(workspaceRows.map((w) => w.id))
    : new Set(principal.workspaceIds.filter((id) => workspaceIds.has(id)));
  const assignedLabIds = new Set(principal.labIds);

  const visibleWorkspaces = workspaceRows.filter((w) => visibleWorkspaceIds.has(w.id));
  const visibleLabs = labRows.filter(
    (l) => visibleWorkspaceIds.has(l.workspace_id) && (admin || (l.status === "published" && assignedLabIds.has(l.id))),
  );
  const visibleMemberships = admin ? membershipRows : membershipRows.filter((m) => m.user_id === principal.sub);
  const visibleAssignments = admin ? assignmentRows : assignmentRows.filter((a) => a.user_id === principal.sub);
  const visibleSessions = admin ? sessionRows : sessionRows.filter((s) => s.user_id === principal.sub);

  const labCount = new Map<string, number>();
  for (const lab of labRows) labCount.set(lab.workspace_id, (labCount.get(lab.workspace_id) ?? 0) + 1);
  const memberCount = new Map<string, number>();
  for (const m of membershipRows) memberCount.set(m.workspace_id, (memberCount.get(m.workspace_id) ?? 0) + 1);
  const activeCount = new Map<string, number>();
  for (const s of sessionRows) {
    if (s.status === "ACTIVE" || s.status === "CREATING" || s.status === "STARTING") {
      activeCount.set(s.workspace_id, (activeCount.get(s.workspace_id) ?? 0) + 1);
    }
  }
  const templateUse = new Map<string, number>();
  for (const lab of labRows) if (lab.template_id) templateUse.set(lab.template_id, (templateUse.get(lab.template_id) ?? 0) + 1);

  const slugById = new Map(workspaceRows.map((w) => [w.id, w.slug]));

  const users = admin ? await loadManagedUsers(tenantId, workspaceRows, membershipRows) : [];
  const events = admin ? await loadActivity(tenantId) : [];

  return {
    workspaces: visibleWorkspaces.map((w) => {
      const tpl = w.default_template_id ? templateById.get(w.default_template_id) : undefined;
      return mapWorkspace(w, {
        templateName: tpl?.name,
        region: tpl?.region,
        labs: labCount.get(w.id) ?? 0,
        users: memberCount.get(w.id) ?? 0,
        activeSessions: activeCount.get(w.id) ?? 0,
      });
    }),
    templates: templateRows.map((t) => mapTemplate(t, templateUse.get(t.id) ?? 0)),
    labs: visibleLabs.map((l) =>
      mapLab(l, {
        workspaceSlug: slugById.get(l.workspace_id),
        vmSize: l.template_id ? templateById.get(l.template_id)?.vm_size : undefined,
      }),
    ),
    workspaceUsers: visibleMemberships.map(mapWorkspaceUser),
    labAssignments: visibleAssignments.map(mapAssignment),
    capabilityGrants: visibleMemberships.map<WorkspaceCapabilityGrant>((m) => ({
      id: m.id,
      workspaceId: m.workspace_id,
      userId: m.user_id,
      capabilities: (m.capabilities ?? []) as WorkspaceCapability[],
      grantedBy: "platform",
      grantedAt: new Date(0).toISOString(),
    })),
    sessions: visibleSessions.map(mapSession),
    users,
    events,
  };
}

async function loadManagedUsers(
  tenantId: string,
  workspaces: WorkspaceRow[],
  memberships: WorkspaceUserRow[],
): Promise<ManagedUser[]> {
  const supabase = await db();
  const [profileRes, roleRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, status, last_sign_in_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    supabase.from("user_roles").select("user_id, role"),
  ]);

  const roleByUser = new Map<string, Role>();
  for (const row of roleRes.data ?? []) {
    const next = row.role as Role;
    const current = roleByUser.get(row.user_id);
    const rank: Record<Role, number> = { user: 0, admin: 1, superadmin: 2 };
    if (!current || rank[next] > rank[current]) roleByUser.set(row.user_id, next);
  }

  const workspaceName = new Map(workspaces.map((w) => [w.id, w.name]));
  const firstWorkspace = new Map<string, string>();
  for (const m of memberships) {
    if (!firstWorkspace.has(m.user_id)) firstWorkspace.set(m.user_id, workspaceName.get(m.workspace_id) ?? "");
  }

  return ((profileRes.data ?? []) as ProfileRow[]).map((p) => {
    const role = roleByUser.get(p.id) ?? "user";
    const workspace = role === "user" ? (firstWorkspace.get(p.id) ?? "Unassigned") : "All workspaces";
    return mapManagedUser(p, role, workspace);
  });
}

async function loadActivity(tenantId: string): Promise<PlatformEvent[]> {
  const supabase = await db();
  const { data } = await supabase
    .from("activity_logs")
    .select("id, at, actor_name, action, target_id, detail, workspace_id, metadata")
    .eq("tenant_id", tenantId)
    .order("at", { ascending: false })
    .limit(250);
  return ((data ?? []) as ActivityRow[]).map(mapActivity);
}

/** Narrow an authorized principal to the fields the catalogue queries need. */
export function toCatalogPrincipal(principal: unknown): CatalogPrincipal {
  const p = principal as {
    sub: string;
    role: Role;
    tenantId?: string | null;
    workspaces?: string[];
    workspaceIds?: string[];
    labs?: string[];
    labIds?: string[];
  };
  return {
    sub: p.sub,
    role: p.role,
    tenantId: p.tenantId ?? null,
    workspaceIds: p.workspaceIds ?? p.workspaces ?? [],
    labIds: p.labIds ?? p.labs ?? [],
  };
}
