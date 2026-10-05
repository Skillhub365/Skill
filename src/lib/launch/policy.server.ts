import { db } from "@/lib/db/client.server";
import { LIVE_SESSION_STATES } from "@/lib/session/types";

/**
 * Capacity and quota policy (Phase 5).
 *
 * Every limit is read from durable records — workspace first, then the
 * organisation, then the platform default — so an administrator can tighten
 * limits without a deploy, and a learner can never talk the server into a
 * longer session or a second machine.
 */

export const PLATFORM_MAX_CONCURRENT_SESSIONS_PER_USER = Number(
  process.env["MAX_CONCURRENT_SESSIONS_PER_USER"] ?? 1,
);
export const PLATFORM_MAX_SESSION_MINUTES = Number(process.env["MAX_SESSION_MINUTES"] ?? 480);

export interface CapacityPolicy {
  maxSessionMinutes: number;
  maxConcurrentWorkspaceSessions: number | null;
  maxConcurrentTenantSessions: number | null;
  maxConcurrentUserSessions: number;
  /** Estimated machine-hour ceiling for the calendar month, if configured. */
  monthlyVmHourBudget: number | null;
  budgetScope: "workspace" | "tenant" | null;
}

export type CapacityDenial =
  | { ok: true; policy: CapacityPolicy }
  | {
      ok: false;
      reason: "TENANT_LIMIT" | "WORKSPACE_LIMIT" | "USER_LIMIT" | "VM_UNAVAILABLE" | "BUDGET_EXCEEDED";
      detail: string;
    };

async function countLiveSessions(column: "workspace_id" | "tenant_id" | "user_id", value: string): Promise<number> {
  try {
    const supabase = await db();
    const { count } = await supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq(column, value)
      .in("status", LIVE_SESSION_STATES);
    return count ?? 0;
  } catch {
    return 0;
  }
}

interface LimitRow {
  max_concurrent_sessions: number | null;
  max_session_minutes: number | null;
  monthly_vm_hour_budget: number | null;
}

export async function resolvePolicy(tenantId: string, workspaceId: string): Promise<CapacityPolicy> {
  let workspaceRow: LimitRow | null = null;
  let tenantRow: LimitRow | null = null;
  try {
    const supabase = await db();
    const [{ data: ws }, { data: tn }] = await Promise.all([
      supabase
        .from("workspaces")
        .select("max_concurrent_sessions, max_session_minutes, monthly_vm_hour_budget")
        .eq("id", workspaceId)
        .maybeSingle(),
      supabase
        .from("tenants")
        .select("max_concurrent_sessions, max_session_minutes, monthly_vm_hour_budget")
        .eq("id", tenantId)
        .maybeSingle(),
    ]);
    workspaceRow = (ws as unknown as LimitRow | null) ?? null;
    tenantRow = (tn as unknown as LimitRow | null) ?? null;
  } catch {
    /* fall through to platform defaults */
  }

  return {
    maxSessionMinutes:
      workspaceRow?.max_session_minutes ?? tenantRow?.max_session_minutes ?? PLATFORM_MAX_SESSION_MINUTES,
    maxConcurrentWorkspaceSessions: workspaceRow?.max_concurrent_sessions ?? null,
    maxConcurrentTenantSessions: tenantRow?.max_concurrent_sessions ?? null,
    maxConcurrentUserSessions: PLATFORM_MAX_CONCURRENT_SESSIONS_PER_USER,
    monthlyVmHourBudget: workspaceRow?.monthly_vm_hour_budget ?? tenantRow?.monthly_vm_hour_budget ?? null,
    budgetScope:
      workspaceRow?.monthly_vm_hour_budget != null
        ? "workspace"
        : tenantRow?.monthly_vm_hour_budget != null
          ? "tenant"
          : null,
  };
}

/**
 * Pre-flight gate, evaluated BEFORE any cloud work: concurrency limits first
 * (cheap, durable counts), then real pool capacity for the lab's image.
 */
export async function checkCapacity(input: {
  tenantId: string;
  workspaceId: string;
  userId: string;
  templateId: string;
}): Promise<CapacityDenial> {
  const policy = await resolvePolicy(input.tenantId, input.workspaceId);

  if (policy.maxConcurrentUserSessions > 0) {
    const mine = await countLiveSessions("user_id", input.userId);
    if (mine >= policy.maxConcurrentUserSessions) {
      return {
        ok: false,
        reason: "USER_LIMIT",
        detail:
          policy.maxConcurrentUserSessions === 1
            ? "You already have a lab running. Stop it before starting another one."
            : `You can run at most ${policy.maxConcurrentUserSessions} labs at the same time.`,
      };
    }
  }

  if (policy.maxConcurrentWorkspaceSessions !== null) {
    const used = await countLiveSessions("workspace_id", input.workspaceId);
    if (used >= policy.maxConcurrentWorkspaceSessions) {
      return {
        ok: false,
        reason: "WORKSPACE_LIMIT",
        detail: "This workspace has reached its limit of simultaneous lab sessions. Please try again shortly.",
      };
    }
  }

  if (policy.maxConcurrentTenantSessions !== null) {
    const used = await countLiveSessions("tenant_id", input.tenantId);
    if (used >= policy.maxConcurrentTenantSessions) {
      return {
        ok: false,
        reason: "TENANT_LIMIT",
        detail: "Your organisation has reached its limit of simultaneous lab sessions. Please try again shortly.",
      };
    }
  }

  // Estimated month-to-date machine hours against the configured ceiling.
  // Deliberately evaluated after concurrency (cheaper) and before any cloud work.
  if (policy.monthlyVmHourBudget !== null && policy.monthlyVmHourBudget > 0) {
    const { monthToDateUsage } = await import("@/lib/reporting/usage.server");
    const used = await monthToDateUsage(
      policy.budgetScope === "workspace" ? { workspaceId: input.workspaceId } : { tenantId: input.tenantId },
    );
    if (used.vmHours >= policy.monthlyVmHourBudget) {
      return {
        ok: false,
        reason: "BUDGET_EXCEEDED",
        detail:
          "This month's lab machine allowance has been used up. Ask an administrator to raise the allowance or try again next month.",
      };
    }
  }

  const { availableCapacity, poolServesTemplate } = await import("@/lib/vm/pool/allocator.server");
  if (await poolServesTemplate(input.templateId)) {
    const free = await availableCapacity(input.templateId, input.workspaceId);
    if (free <= 0) {
      return {
        ok: false,
        reason: "VM_UNAVAILABLE",
        detail: "All lab machines for this image are currently in use. Please try again in a few minutes.",
      };
    }
  }

  return { ok: true, policy };
}

/** Clamp requested duration/extension to policy. */
export function clampDuration(requested: number, policy: CapacityPolicy) {
  return Math.max(5, Math.min(requested, policy.maxSessionMinutes));
}