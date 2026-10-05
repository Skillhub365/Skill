import { db } from "./client.server";
import { recordActivity } from "./events.repo.server";
import { recordSecurityEvent } from "./security-audit.server";
import { invalidateIdentityCache } from "@/lib/security/identity.server";
import { slugify, uniqueSlug, workspaceSlugFor } from "@/lib/slug";
import { toDbLabStatus, toDbWorkspaceStatus, writeLabMeta } from "./catalog.map";
import type { CatalogPrincipal } from "./catalog.repo.server";
import type { Lab, LabStatus, Role, Workspace } from "@/lib/mock-data";
import type { WorkspaceCapability } from "@/lib/security/workspace-capabilities";
import type { AssignmentAccess, LabMode, PersistencePolicy } from "@/lib/labs/persistence";
import { mapAssignmentAccess, type AssignmentRow } from "./catalog.map";

/**
 * Write side of the catalogue. Callers pass an already-authorized principal;
 * every statement re-scopes to that principal's tenant so an id from another
 * tenant simply matches no row.
 */

export type WriteFailure = "NOT_FOUND" | "CONFLICT" | "INVALID";
export type WriteResult<T> = { ok: true; data: T } | { ok: false; reason: WriteFailure; detail?: string };

const fail = (reason: WriteFailure, detail?: string): { ok: false; reason: WriteFailure; detail?: string } => ({
  ok: false,
  reason,
  ...(detail ? { detail } : {}),
});

async function requireTenantWorkspace(tenantId: string, workspaceId: string) {
  const supabase = await db();
  const { data } = await supabase
    .from("workspaces")
    .select("id, name, slug, status")
    .eq("id", workspaceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

/* -------------------------------------------------------------- workspaces */

/** Mapped Partial that tolerates explicitly-undefined keys from parsed JSON bodies. */
export type Optional<T> = { [K in keyof T]?: T[K] | undefined };

export interface WorkspaceInput {
  name: string;
  description: string;
  org: string;
  templateId: string;
  accessType: Workspace["accessType"];
  publicLanding: boolean;
  enabled: boolean;
  status: Workspace["status"];
  slug?: string | undefined;
}

export async function createWorkspace(
  tenantId: string,
  principal: CatalogPrincipal,
  input: WorkspaceInput,
): Promise<WriteResult<{ id: string; slug: string }>> {
  const supabase = await db();
  const { data: existing } = await supabase.from("workspaces").select("slug").eq("tenant_id", tenantId);
  const taken = (existing ?? []).map((w) => w.slug);
  const base = slugify(input.slug ?? "") || workspaceSlugFor(input.org, input.name);
  const slug = uniqueSlug(base, taken);

  const { data, error } = await supabase
    .from("workspaces")
    .insert({
      tenant_id: tenantId,
      name: input.name,
      description: input.description || null,
      organization_name: input.org,
      slug,
      status: toDbWorkspaceStatus(input.status, input.enabled),
      access_type: input.accessType,
      public_landing: { enabled: input.publicLanding },
      default_template_id: input.templateId || null,
      created_by: principal.sub,
    })
    .select("id, slug")
    .single();

  if (error || !data) return fail("CONFLICT", error?.message);

  await recordActivity({
    tenantId,
    action: "WORKSPACE_CREATED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "workspace",
    targetId: data.id,
    target: input.name,
    workspaceId: data.id,
    detail: `Workspace created · /workspace/${data.slug}`,
  });
  return { ok: true, data };
}

export interface WorkspacePatch {
  name?: string | undefined;
  description?: string | undefined;
  org?: string | undefined;
  templateId?: string | undefined;
  accessType?: Workspace["accessType"] | undefined;
  publicLanding?: boolean | undefined;
  enabled?: boolean | undefined;
  status?: Workspace["status"] | undefined;
  slug?: string | undefined;
  regenerateSlug?: boolean | undefined;
}

export async function updateWorkspace(
  tenantId: string,
  principal: CatalogPrincipal,
  id: string,
  patch: WorkspacePatch,
): Promise<WriteResult<{ id: string; slug: string }>> {
  const supabase = await db();
  const { data: current } = await supabase
    .from("workspaces")
    .select("id, name, slug, organization_name, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!current) return fail("NOT_FOUND");

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update["name"] = patch.name;
  if (patch.description !== undefined) update["description"] = patch.description || null;
  if (patch.org !== undefined) update["organization_name"] = patch.org;
  if (patch.templateId !== undefined) update["default_template_id"] = patch.templateId || null;
  if (patch.accessType !== undefined) update["access_type"] = patch.accessType;
  if (patch.publicLanding !== undefined) update["public_landing"] = { enabled: patch.publicLanding };
  if (patch.status !== undefined || patch.enabled !== undefined) {
    const status = patch.status ?? (current.status === "draft" ? "draft" : "published");
    const enabled = patch.enabled ?? current.status === "active";
    update["status"] = toDbWorkspaceStatus(status, enabled);
  }

  let slug = current.slug;
  if (patch.slug !== undefined || patch.regenerateSlug) {
    const { data: others } = await supabase.from("workspaces").select("id, slug").eq("tenant_id", tenantId);
    const taken = (others ?? []).filter((w) => w.id !== id).map((w) => w.slug);
    const base =
      slugify(patch.slug ?? "") ||
      workspaceSlugFor(patch.org ?? current.organization_name, patch.name ?? current.name);
    slug = uniqueSlug(base, taken);
    update["slug"] = slug;
  }

  const { error } = await supabase.from("workspaces").update(update as never).eq("id", id).eq("tenant_id", tenantId);
  if (error) return fail("CONFLICT", error.message);

  await recordActivity({
    tenantId,
    action: patch.status === "published" ? "WORKSPACE_PUBLISHED" : "WORKSPACE_UPDATED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "workspace",
    targetId: id,
    target: patch.name ?? current.name,
    workspaceId: id,
    detail: patch.regenerateSlug || patch.slug ? `Workspace URL is now /workspace/${slug}` : "Workspace configuration updated",
  });
  return { ok: true, data: { id, slug } };
}

/* --------------------------------------------------------------- templates */

export interface TemplateInput {
  name: string;
  description: string;
  cloudProvider: string;
  os: string;
  vmSize: string;
  image: string;
  region: string;
  configuration: { key: string; value: string }[];
  software: string[];
  enabled: boolean;
}

export async function createTemplate(
  tenantId: string,
  principal: CatalogPrincipal,
  input: TemplateInput,
): Promise<WriteResult<{ id: string }>> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("templates")
    .insert({
      tenant_id: tenantId,
      name: input.name,
      description: input.description || null,
      cloud_provider: "azure",
      operating_system: input.os,
      vm_size: input.vmSize,
      region: input.region,
      image: input.image,
      configuration: { entries: input.configuration, software: input.software },
      status: input.enabled ? "active" : "draft",
      created_by: principal.sub,
    })
    .select("id")
    .single();
  if (error || !data) return fail("CONFLICT", error?.message);

  await recordActivity({
    tenantId,
    action: "TEMPLATE_CREATED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "template",
    targetId: data.id,
    target: input.name,
    detail: `${input.os} · ${input.vmSize} · ${input.region}`,
  });
  return { ok: true, data };
}

export async function updateTemplate(
  tenantId: string,
  principal: CatalogPrincipal,
  id: string,
  patch: Optional<TemplateInput>,
): Promise<WriteResult<{ id: string }>> {
  const supabase = await db();
  const { data: current } = await supabase
    .from("templates")
    .select("id, name, configuration, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!current) return fail("NOT_FOUND");

  const config = (current.configuration ?? {}) as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update["name"] = patch.name;
  if (patch.description !== undefined) update["description"] = patch.description || null;
  if (patch.os !== undefined) update["operating_system"] = patch.os;
  if (patch.vmSize !== undefined) update["vm_size"] = patch.vmSize;
  if (patch.image !== undefined) update["image"] = patch.image;
  if (patch.region !== undefined) update["region"] = patch.region;
  if (patch.configuration !== undefined || patch.software !== undefined) {
    update["configuration"] = {
      entries: patch.configuration ?? config["entries"] ?? [],
      software: patch.software ?? config["software"] ?? [],
    };
  }
  if (patch.enabled !== undefined) update["status"] = patch.enabled ? "active" : "draft";

  const { error } = await supabase.from("templates").update(update as never).eq("id", id).eq("tenant_id", tenantId);
  if (error) return fail("CONFLICT", error.message);

  await recordActivity({
    tenantId,
    action: "TEMPLATE_UPDATED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "template",
    targetId: id,
    target: patch.name ?? current.name,
    detail: "Template configuration updated",
  });
  return { ok: true, data: { id } };
}

/* -------------------------------------------------------------------- labs */

export interface LabInputDto {
  title: string;
  description: string;
  objectives: string[];
  workspaceId: string;
  templateId: string;
  durationMinutes: number;
  level: Lab["level"];
  status: LabStatus;
  tags: string[];
  labMode?: LabMode | undefined;
  maxExtensions?: number | undefined;
  defaultAccessDays?: number | undefined;
  defaultAllowedMinutes?: number | undefined;
  idleShutdownMinutes?: number | undefined;
  persistencePolicy?: PersistencePolicy | undefined;
  resetOnAccessEnd?: boolean | undefined;
}

/** Persistent-lab columns shared by create and update. */
function persistenceColumns(input: Optional<LabInputDto>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.labMode !== undefined) out["lab_mode"] = input.labMode;
  if (input.maxExtensions !== undefined) out["max_extensions"] = input.maxExtensions;
  if (input.defaultAccessDays !== undefined) out["default_access_days"] = input.defaultAccessDays;
  if (input.defaultAllowedMinutes !== undefined) out["default_allowed_minutes"] = input.defaultAllowedMinutes;
  if (input.idleShutdownMinutes !== undefined) out["idle_shutdown_minutes"] = input.idleShutdownMinutes;
  if (input.persistencePolicy !== undefined) out["persistence_policy"] = input.persistencePolicy;
  if (input.resetOnAccessEnd !== undefined) out["reset_on_access_end"] = input.resetOnAccessEnd;
  return out;
}

export async function createLab(
  tenantId: string,
  principal: CatalogPrincipal,
  input: LabInputDto,
): Promise<WriteResult<{ id: string }>> {
  const workspace = await requireTenantWorkspace(tenantId, input.workspaceId);
  if (!workspace) return fail("NOT_FOUND", "Workspace not found in this tenant");

  const supabase = await db();
  const { data, error } = await supabase
    .from("labs")
    .insert({
      workspace_id: input.workspaceId,
      template_id: input.templateId || null,
      title: input.title,
      description: input.description || null,
      instructions: writeLabMeta({ objectives: input.objectives, level: input.level, tags: input.tags }),
      status: toDbLabStatus(input.status),
      duration_minutes: input.durationMinutes,
      published_at: input.status === "published" ? new Date().toISOString() : null,
      created_by: principal.sub,
      ...persistenceColumns(input),
    })
    .select("id")
    .single();
  if (error || !data) return fail("CONFLICT", error?.message);

  await recordActivity({
    tenantId,
    action: input.status === "published" ? "LAB_PUBLISHED" : "LAB_CREATED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "lab",
    targetId: data.id,
    target: input.title,
    workspaceId: input.workspaceId,
    detail: `${input.durationMinutes} min · ${workspace.name}`,
  });
  return { ok: true, data };
}

export async function updateLab(
  tenantId: string,
  principal: CatalogPrincipal,
  id: string,
  patch: Optional<LabInputDto>,
): Promise<WriteResult<{ id: string }>> {
  const supabase = await db();
  const { data: current } = await supabase
    .from("labs")
    .select("id, title, workspace_id, instructions, status, published_at")
    .eq("id", id)
    .maybeSingle();
  if (!current) return fail("NOT_FOUND");
  if (!(await requireTenantWorkspace(tenantId, current.workspace_id))) return fail("NOT_FOUND");
  if (patch.workspaceId && !(await requireTenantWorkspace(tenantId, patch.workspaceId))) return fail("NOT_FOUND");

  let meta: { objectives: string[]; level: Lab["level"]; tags: string[] };
  try {
    meta = JSON.parse(current.instructions ?? "{}");
  } catch {
    meta = { objectives: [], level: "Beginner", tags: [] };
  }

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update["title"] = patch.title;
  if (patch.description !== undefined) update["description"] = patch.description || null;
  if (patch.workspaceId !== undefined) update["workspace_id"] = patch.workspaceId;
  if (patch.templateId !== undefined) update["template_id"] = patch.templateId || null;
  if (patch.durationMinutes !== undefined) update["duration_minutes"] = patch.durationMinutes;
  if (patch.objectives !== undefined || patch.level !== undefined || patch.tags !== undefined) {
    update["instructions"] = writeLabMeta({
      objectives: patch.objectives ?? meta.objectives ?? [],
      level: patch.level ?? meta.level ?? "Beginner",
      tags: patch.tags ?? meta.tags ?? [],
    });
  }
  if (patch.status !== undefined) {
    update["status"] = toDbLabStatus(patch.status);
    update["published_at"] =
      patch.status === "published" ? (current.published_at ?? new Date().toISOString()) : current.published_at;
  }
  Object.assign(update, persistenceColumns(patch));

  const { error } = await supabase.from("labs").update(update as never).eq("id", id);
  if (error) return fail("CONFLICT", error.message);

  if (patch.status) {
    await recordActivity({
      tenantId,
      action: patch.status === "published" ? "LAB_PUBLISHED" : "LAB_UNPUBLISHED",
      actorId: principal.sub,
      actorRole: principal.role,
      targetType: "lab",
      targetId: id,
      target: patch.title ?? current.title,
      workspaceId: patch.workspaceId ?? current.workspace_id,
      detail: patch.status === "published" ? "Lab published to the workspace catalogue" : `Lab moved to ${patch.status}`,
    });
  }
  return { ok: true, data: { id } };
}

/* -------------------------------------------------------- workspace users */

export async function addWorkspaceUser(
  tenantId: string,
  principal: CatalogPrincipal,
  workspaceId: string,
  userId: string,
): Promise<WriteResult<{ id: string }>> {
  const workspace = await requireTenantWorkspace(tenantId, workspaceId);
  if (!workspace) return fail("NOT_FOUND");

  const supabase = await db();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!profile) return fail("NOT_FOUND", "User is not part of this tenant");

  const { data, error } = await supabase
    .from("workspace_users")
    .upsert(
      { workspace_id: workspaceId, user_id: userId, role: "user", status: "active", invited_by: principal.sub },
      { onConflict: "workspace_id,user_id" },
    )
    .select("id")
    .single();
  if (error || !data) return fail("CONFLICT", error?.message);

  await recordActivity({
    tenantId,
    action: "USER_ASSIGNED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: userId,
    target: profile.email,
    workspaceId,
    detail: `Added to ${workspace.name}`,
  });
  invalidateIdentityCache(userId);
  await recordSecurityEvent({
    tenantId,
    action: "WORKSPACE_MEMBERSHIP_CHANGED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: userId,
    target: profile.email,
    workspaceId,
    detail: `Granted access to ${workspace.name}`,
  });
  return { ok: true, data };
}

export async function removeWorkspaceUser(
  tenantId: string,
  principal: CatalogPrincipal,
  membershipId: string,
): Promise<WriteResult<{ id: string }>> {
  const supabase = await db();
  const { data: membership } = await supabase
    .from("workspace_users")
    .select("id, workspace_id, user_id")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership || !(await requireTenantWorkspace(tenantId, membership.workspace_id))) return fail("NOT_FOUND");

  await supabase
    .from("lab_assignments")
    .delete()
    .eq("user_id", membership.user_id)
    .eq("workspace_id", membership.workspace_id);
  await supabase.from("workspace_users").delete().eq("id", membershipId);

  await recordActivity({
    tenantId,
    action: "USER_REMOVED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: membership.user_id,
    workspaceId: membership.workspace_id,
    detail: "Removed from workspace",
  });
  invalidateIdentityCache(membership.user_id);
  await recordSecurityEvent({
    tenantId,
    action: "WORKSPACE_MEMBERSHIP_CHANGED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: membership.user_id,
    workspaceId: membership.workspace_id,
    detail: "Workspace access revoked",
  });
  return { ok: true, data: { id: membershipId } };
}

export async function setWorkspaceUserStatus(
  tenantId: string,
  membershipId: string,
  status: "active" | "invited" | "suspended",
): Promise<WriteResult<{ id: string }>> {
  const supabase = await db();
  const { data: membership } = await supabase
    .from("workspace_users")
    .select("id, workspace_id, user_id")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership || !(await requireTenantWorkspace(tenantId, membership.workspace_id))) return fail("NOT_FOUND");
  await supabase.from("workspace_users").update({ status }).eq("id", membershipId);

  // Membership status feeds the authorization chain, so the cached identity
  // has to go before the next request is authorized.
  invalidateIdentityCache(membership.user_id);
  await recordSecurityEvent({
    tenantId,
    action: "WORKSPACE_MEMBERSHIP_CHANGED",
    targetType: "user",
    targetId: membership.user_id,
    workspaceId: membership.workspace_id,
    detail: `Workspace membership set to ${status}`,
  });
  return { ok: true, data: { id: membershipId } };
}

export async function setUserCapabilities(
  tenantId: string,
  principal: CatalogPrincipal,
  workspaceId: string,
  userId: string,
  capabilities: WorkspaceCapability[],
): Promise<WriteResult<{ id: string }>> {
  if (!(await requireTenantWorkspace(tenantId, workspaceId))) return fail("NOT_FOUND");
  const supabase = await db();
  const { data, error } = await supabase
    .from("workspace_users")
    .update({ capabilities: [...new Set(capabilities)] })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) return fail("NOT_FOUND", error?.message);

  await recordActivity({
    tenantId,
    action: "USER_STATUS_CHANGED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: userId,
    workspaceId,
    detail: capabilities.length ? `Permissions set to ${capabilities.join(", ")}` : "All workspace permissions revoked",
  });
  invalidateIdentityCache(userId);
  await recordSecurityEvent({
    tenantId,
    action: "CAPABILITIES_CHANGED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: userId,
    workspaceId,
    detail: capabilities.length ? `Permissions: ${capabilities.join(", ")}` : "All workspace permissions revoked",
  });
  return { ok: true, data };
}

/* -------------------------------------------------------- lab assignments */

export async function toggleAssignment(
  tenantId: string,
  principal: CatalogPrincipal,
  workspaceId: string,
  userId: string,
  labId: string,
): Promise<WriteResult<{ assigned: boolean }>> {
  if (!(await requireTenantWorkspace(tenantId, workspaceId))) return fail("NOT_FOUND");
  const supabase = await db();

  const { data: lab } = await supabase.from("labs").select("id, title, workspace_id").eq("id", labId).maybeSingle();
  if (!lab || lab.workspace_id !== workspaceId) return fail("NOT_FOUND", "Lab is not part of this workspace");

  const { data: existing } = await supabase
    .from("lab_assignments")
    .select("id")
    .eq("lab_id", labId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await supabase.from("lab_assignments").delete().eq("id", existing.id);
  } else {
    // Persistent labs get their access window and hour allowance seeded from
    // the lab defaults, so an assignment is immediately usable.
    const { data: labConfig } = await supabase
      .from("labs")
      .select("lab_mode, default_access_days, default_allowed_minutes")
      .eq("id", labId)
      .maybeSingle();
    const persistent = (labConfig as { lab_mode?: string } | null)?.lab_mode === "persistent";
    const days = (labConfig as { default_access_days?: number } | null)?.default_access_days ?? 10;
    const allowed = (labConfig as { default_allowed_minutes?: number } | null)?.default_allowed_minutes ?? 1200;
    await supabase.from("lab_assignments").insert({
      lab_id: labId,
      workspace_id: workspaceId,
      user_id: userId,
      status: "assigned",
      assigned_by: principal.sub,
      ...(persistent
        ? {
            access_starts_at: new Date().toISOString(),
            access_ends_at: new Date(Date.now() + days * 86_400_000).toISOString(),
            allowed_minutes: allowed,
          }
        : {}),
    });
  }

  await recordActivity({
    tenantId,
    action: existing ? "LAB_UNASSIGNED" : "LAB_ASSIGNED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "lab",
    targetId: labId,
    target: lab.title,
    workspaceId,
    detail: `${existing ? "Unassigned from" : "Assigned to"} learner`,
  });
  invalidateIdentityCache(userId);
  await recordSecurityEvent({
    tenantId,
    action: "LAB_ASSIGNMENT_CHANGED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "lab",
    targetId: labId,
    target: lab.title,
    workspaceId,
    detail: existing ? "Lab assignment revoked" : "Lab assigned",
  });
  return { ok: true, data: { assigned: !existing } };
}

/* -------------------------------------------- persistent lab access grants */

export interface AssignmentAccessInput {
  workspaceId: string;
  userId: string;
  labId: string;
  accessStartsAt?: string | null | undefined;
  accessEndsAt?: string | null | undefined;
  /** Absolute allowance in minutes. */
  allowedMinutes?: number | null | undefined;
  /** Relative top-up, added to the existing allowance. */
  addMinutes?: number | undefined;
  /** Extend the end of the access window by whole days. */
  extendDays?: number | undefined;
  status?: "assigned" | "revoked" | undefined;
}

/**
 * Set or adjust one learner's persistent-lab grant: access window, hour
 * allowance, top-ups, extensions and revocation. Used minutes are never
 * rewritten here — only the launch/stop accounting path may change them.
 */
export async function setAssignmentAccess(
  tenantId: string,
  principal: CatalogPrincipal,
  input: AssignmentAccessInput,
): Promise<WriteResult<{ access: AssignmentAccess; status: string }>> {
  if (!(await requireTenantWorkspace(tenantId, input.workspaceId))) return fail("NOT_FOUND");
  const supabase = await db();

  const { data: lab } = await supabase
    .from("labs")
    .select("id, title, workspace_id, lab_mode")
    .eq("id", input.labId)
    .maybeSingle();
  if (!lab || lab.workspace_id !== input.workspaceId) return fail("NOT_FOUND", "Lab is not part of this workspace");

  const { data: existing } = await supabase
    .from("lab_assignments")
    .select("id, allowed_minutes, used_minutes, access_ends_at, persistent_vm_id")
    .eq("lab_id", input.labId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!existing) return fail("NOT_FOUND", "This learner is not assigned to the lab");

  const update: Record<string, unknown> = {};
  if (input.accessStartsAt !== undefined) update["access_starts_at"] = input.accessStartsAt;
  if (input.accessEndsAt !== undefined) update["access_ends_at"] = input.accessEndsAt;
  if (input.allowedMinutes !== undefined) update["allowed_minutes"] = input.allowedMinutes;
  if (input.addMinutes) update["allowed_minutes"] = (existing.allowed_minutes ?? 0) + input.addMinutes;
  if (input.extendDays) {
    const from = existing.access_ends_at ? new Date(existing.access_ends_at).getTime() : Date.now();
    update["access_ends_at"] = new Date(Math.max(from, Date.now()) + input.extendDays * 86_400_000).toISOString();
  }
  if (input.status !== undefined) update["status"] = input.status;

  const { data: saved, error } = await supabase
    .from("lab_assignments")
    .update(update as never)
    .eq("id", existing.id)
    .select(
      "id, lab_id, workspace_id, user_id, status, access_starts_at, access_ends_at, allowed_minutes, used_minutes, remaining_minutes, persistent_vm_id, last_started_at, last_stopped_at",
    )
    .single();
  if (error || !saved) return fail("CONFLICT", error?.message);

  // Revoking or ending access hands the learner's dedicated machine back.
  if (input.status === "revoked" && existing.persistent_vm_id) {
    try {
      const { reclaimPersistentVm } = await import("@/lib/labs/persistent-vm.server");
      await reclaimPersistentVm(existing.id, existing.persistent_vm_id, `admin:${principal.sub}`);
    } catch {
      /* reclaim is best-effort; the reaper retries once the grant is inactive */
    }
  }

  await recordActivity({
    tenantId,
    action: input.status === "revoked" ? "LAB_UNASSIGNED" : "LAB_ASSIGNED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "lab",
    targetId: input.labId,
    target: lab.title,
    workspaceId: input.workspaceId,
    detail:
      input.status === "revoked"
        ? "Persistent lab access revoked"
        : `Persistent access updated (${(saved as AssignmentRow).allowed_minutes ?? 0} min allowance)`,
  });
  invalidateIdentityCache(input.userId);

  return {
    ok: true,
    data: { access: mapAssignmentAccess(saved as AssignmentRow), status: String((saved as AssignmentRow).status) },
  };
}

/* ------------------------------------------------------------- user admin */

export interface ManagedUserInputDto {
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "suspended";
}

export async function createManagedUser(
  tenantId: string,
  principal: CatalogPrincipal,
  input: ManagedUserInputDto,
): Promise<WriteResult<{ id: string }>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    email_confirm: true,
    user_metadata: { full_name: input.name },
  });
  if (error || !created.user) return fail("CONFLICT", error?.message ?? "Could not create the account");

  const userId = created.user.id;
  await supabaseAdmin
    .from("profiles")
    .update({ tenant_id: tenantId, full_name: input.name, status: input.status })
    .eq("id", userId);
  await supabaseAdmin.from("user_roles").upsert({ user_id: userId, tenant_id: tenantId, role: input.role }, { onConflict: "user_id,role" });
  if (input.role !== "user") await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "user");

  await recordActivity({
    tenantId,
    action: "USER_CREATED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: userId,
    target: input.email,
    detail: `${input.role} account created`,
  });
  await recordSecurityEvent({
    tenantId,
    action: "USER_INVITED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: userId,
    target: input.email,
    detail: `Invited as ${input.role}`,
  });
  return { ok: true, data: { id: userId } };
}

export async function updateManagedUser(
  tenantId: string,
  principal: CatalogPrincipal,
  id: string,
  patch: Optional<ManagedUserInputDto>,
): Promise<WriteResult<{ id: string }>> {
  const supabase = await db();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!profile) return fail("NOT_FOUND");

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update["full_name"] = patch.name;
  if (patch.status !== undefined) update["status"] = patch.status;
  if (Object.keys(update).length > 0) await supabase.from("profiles").update(update as never).eq("id", id);

  if (patch.role) {
    // Only a superadmin may mint another superadmin, and nobody may change
    // their own role — both are privilege-escalation paths.
    if (patch.role === "superadmin" && principal.role !== "superadmin") {
      return fail("INVALID", "Only a platform superadmin can grant the superadmin role");
    }
    if (id === principal.sub) return fail("INVALID", "You cannot change your own role");
    await supabase.from("user_roles").delete().eq("user_id", id);
    await supabase.from("user_roles").insert({ user_id: id, tenant_id: tenantId, role: patch.role });
  }

  await recordActivity({
    tenantId,
    action: "USER_STATUS_CHANGED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: id,
    target: profile.email,
    detail: "User record updated",
  });
  // Role and status both feed the authorization chain.
  invalidateIdentityCache(id);
  if (patch.role) {
    await recordSecurityEvent({
      tenantId,
      action: "ROLE_CHANGED",
      actorId: principal.sub,
      actorRole: principal.role,
      targetType: "user",
      targetId: id,
      target: profile.email,
      detail: `Role changed to ${patch.role}`,
    });
  }
  if (patch.status === "suspended" || patch.status === "active") {
    await recordSecurityEvent({
      tenantId,
      action: patch.status === "suspended" ? "USER_SUSPENDED" : "USER_REACTIVATED",
      actorId: principal.sub,
      actorRole: principal.role,
      targetType: "user",
      targetId: id,
      target: profile.email,
      detail: patch.status === "suspended" ? "Account suspended" : "Account reactivated",
    });
  }
  return { ok: true, data: { id } };
}

export async function removeManagedUser(
  tenantId: string,
  principal: CatalogPrincipal,
  id: string,
): Promise<WriteResult<{ id: string }>> {
  const supabase = await db();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!profile) return fail("NOT_FOUND");
  if (id === principal.sub) return fail("INVALID", "You cannot remove your own account");

  // Soft removal keeps audit history intact while revoking every entitlement.
  await supabase.from("lab_assignments").delete().eq("user_id", id);
  await supabase.from("workspace_users").delete().eq("user_id", id);
  await supabase.from("profiles").update({ status: "disabled" }).eq("id", id);

  await recordActivity({
    tenantId,
    action: "USER_REMOVED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: id,
    target: profile.email,
    detail: "Account disabled and entitlements revoked",
  });
  invalidateIdentityCache(id);
  await recordSecurityEvent({
    tenantId,
    action: "USER_SUSPENDED",
    actorId: principal.sub,
    actorRole: principal.role,
    targetType: "user",
    targetId: id,
    target: profile.email,
    detail: "Account disabled and entitlements revoked",
  });
  return { ok: true, data: { id } };
}
