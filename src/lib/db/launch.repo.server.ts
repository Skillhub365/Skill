import { db } from "./client.server";

/**
 * Server-authoritative resolution of everything a lab launch needs.
 *
 * The browser sends a lab id and nothing else. Workspace, template, image,
 * region, VM size, provider, duration and the cloud binding are all read from
 * database records here, so a tampered request body cannot change which
 * machine is created or who it belongs to.
 */

import type { AssignmentAccess, LabMode, PersistencePolicy } from "@/lib/labs/persistence";

export type LaunchFailure =
  | "LAB_UNAVAILABLE"
  | "WORKSPACE_UNAVAILABLE"
  | "FORBIDDEN_ORG"
  | "FORBIDDEN_LAB"
  | "TEMPLATE_UNAVAILABLE"
  | "PROVIDER_UNSUPPORTED"
  | "CLOUD_BINDING_MISSING";

export interface LaunchPlan {
  tenantId: string;
  workspace: { id: string; name: string; slug: string; status: string };
  lab: {
    id: string;
    title: string;
    status: string;
    durationMinutes: number;
    maxExtensions: number;
    labMode: LabMode;
    idleShutdownMinutes: number;
    persistencePolicy: PersistencePolicy;
  };
  template: {
    id: string;
    name: string;
    provider: "Azure";
    region: string;
    size: string;
    image: string;
    cloudConnectionId: string | null;
  };
  durationMinutes: number;
  maxExtensionMinutes: number;
  /** Present whenever the learner has an assignment row for this lab. */
  assignment: { id: string; status: string; access: AssignmentAccess } | null;
}

export type LaunchResolution = { ok: true; plan: LaunchPlan } | { ok: false; reason: LaunchFailure; detail?: string };

interface Principal {
  sub: string;
  role: string;
  tenantId?: string | null;
}

function isAdmin(role: string) {
  return role === "admin" || role === "superadmin";
}

export async function resolveLaunchPlan(labId: string, principal: Principal): Promise<LaunchResolution> {
  const supabase = await db();

  const { data: lab } = await supabase
    .from("labs")
    .select(
      "id, title, status, duration_minutes, max_extensions, template_id, workspace_id, lab_mode, idle_shutdown_minutes, persistence_policy",
    )
    .eq("id", labId)
    .maybeSingle();
  if (!lab) return { ok: false, reason: "LAB_UNAVAILABLE" };

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, tenant_id, name, slug, status, cloud_connection_id, default_template_id")
    .eq("id", lab.workspace_id)
    .maybeSingle();
  if (!workspace) return { ok: false, reason: "WORKSPACE_UNAVAILABLE" };

  // Tenancy is checked before anything else — a role never crosses tenants.
  if (workspace.tenant_id !== (principal.tenantId ?? null)) {
    return { ok: false, reason: "FORBIDDEN_ORG" };
  }
  if (workspace.status !== "active") {
    return { ok: false, reason: "WORKSPACE_UNAVAILABLE", detail: "This workspace is not available right now." };
  }
  if (lab.status !== "published" && !isAdmin(principal.role)) {
    return { ok: false, reason: "LAB_UNAVAILABLE", detail: "This lab has not been published yet." };
  }

  // Membership + entitlement, from records only. The assignment row is loaded
  // for everyone (admins included) because persistent labs bill against it.
  const { findAssignment } = await import("@/lib/labs/persistent-vm.server");
  const grant = await findAssignment(lab.id, principal.sub);
  if (!isAdmin(principal.role)) {
    const { data: membership } = await supabase
      .from("workspace_users")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("user_id", principal.sub)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) return { ok: false, reason: "WORKSPACE_UNAVAILABLE" };
    if (!grant || grant.status === "revoked") return { ok: false, reason: "FORBIDDEN_LAB" };
  }

  const templateId = lab.template_id ?? workspace.default_template_id;
  if (!templateId) return { ok: false, reason: "TEMPLATE_UNAVAILABLE" };

  const { data: template } = await supabase
    .from("templates")
    .select("id, tenant_id, name, status, cloud_provider, region, vm_size, image, cloud_connection_id")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) return { ok: false, reason: "TEMPLATE_UNAVAILABLE" };
  if (template.tenant_id !== workspace.tenant_id) return { ok: false, reason: "FORBIDDEN_ORG" };
  if (template.status !== "active") {
    return { ok: false, reason: "TEMPLATE_UNAVAILABLE", detail: "The image template for this lab is disabled." };
  }
  if (template.cloud_provider !== "azure") {
    return { ok: false, reason: "PROVIDER_UNSUPPORTED", detail: "Only Azure-backed labs can be launched." };
  }

  const cloudConnectionId = template.cloud_connection_id ?? workspace.cloud_connection_id ?? null;

  const durationMinutes = lab.duration_minutes ?? 120;
  const labMode: LabMode = lab.lab_mode === "persistent" ? "persistent" : "session_based";
  return {
    ok: true,
    plan: {
      tenantId: workspace.tenant_id,
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, status: workspace.status },
      lab: {
        id: lab.id,
        title: lab.title,
        status: lab.status,
        durationMinutes,
        maxExtensions: lab.max_extensions ?? 1,
        labMode,
        idleShutdownMinutes: lab.idle_shutdown_minutes ?? 30,
        persistencePolicy: (lab.persistence_policy as PersistencePolicy) ?? "keep_disk",
      },
      template: {
        id: template.id,
        name: template.name,
        provider: "Azure",
        region: template.region ?? "eastus",
        size: template.vm_size ?? "Standard_D2s_v5",
        image: template.image ?? "",
        cloudConnectionId,
      },
      durationMinutes,
      maxExtensionMinutes: (lab.max_extensions ?? 1) * 30,
      assignment: grant ? { id: grant.id, status: grant.status, access: grant.access } : null,
    },
  };
}
