/**
 * Real Azure validation for a cloud connection.
 *
 * Every step below performs an actual network call:
 *   Entra ID token -> ARM reachability -> subscription read ->
 *   resource group list (and optional scope check) -> RBAC permission read.
 * Nothing is simulated, and a connection is never marked CONNECTED without
 * these calls succeeding.
 */

import { AzureArmClient, AzureConnectionError, actionAllowed } from "./azure-arm.server";
import { REQUIRED_AZURE_ACTIONS, type ValidationResult, type ValidationStep, type ValidationStepId } from "./types";
import type { AzureCredentials } from "./azure-arm.server";

class StepRecorder {
  readonly steps: ValidationStep[] = [];
  private startedAt = Date.now();

  begin() {
    this.startedAt = Date.now();
  }

  push(id: ValidationStepId, state: ValidationStep["state"], detail: string) {
    this.steps.push({ id, state, detail, durationMs: Date.now() - this.startedAt });
    this.startedAt = Date.now();
  }
}

export async function validateAzureCredentials(
  credentials: AzureCredentials,
  options: { resourceGroup?: string | null } = {},
): Promise<ValidationResult> {
  const recorder = new StepRecorder();
  const client = new AzureArmClient(credentials);
  const verifiedAt = new Date().toISOString();
  const base = {
    steps: recorder.steps,
    subscriptionName: null,
    tenantId: credentials.tenantId,
    resourceGroups: [] as string[],
    permissions: [] as ValidationResult["permissions"],
    verifiedAt,
  };

  // 1 + 2. Authenticate against the tenant and reach Resource Manager.
  recorder.begin();
  try {
    await client.token();
    recorder.push("authenticate", "ok", "Microsoft Entra ID issued an access token.");
  } catch (error) {
    const failure = asFailure(error);
    recorder.push("authenticate", "failed", failure.message);
    return { ...base, ok: false, status: failure.status, message: failure.message };
  }

  // 3. Subscription reachable and enabled for this principal.
  let subscriptionName: string | null = null;
  try {
    const subscription = await client.getSubscription();
    recorder.push("connect", "ok", "Azure Resource Manager responded.");
    subscriptionName = subscription.displayName;
    if (subscription.state !== "Enabled") {
      const message = `Subscription "${subscription.displayName}" is ${subscription.state.toLowerCase()}.`;
      recorder.push("subscription", "failed", message);
      return { ...base, ok: false, status: "SUBSCRIPTION_ERROR", message, subscriptionName };
    }
    recorder.push("subscription", "ok", `Subscription "${subscription.displayName}" is enabled.`);
  } catch (error) {
    const failure = asFailure(error);
    recorder.push("connect", failure.status === "UNAVAILABLE" ? "failed" : "ok", failure.message);
    if (failure.status !== "UNAVAILABLE") recorder.push("subscription", "failed", failure.message);
    return { ...base, ok: false, status: failure.status, message: failure.message };
  }

  // 4. Resource groups — and the specified scope must exist when given.
  let resourceGroups: string[] = [];
  try {
    const groups = await client.listResourceGroups();
    resourceGroups = groups.map((g) => g.name);
    if (options.resourceGroup) {
      const scoped = await client.getResourceGroup(options.resourceGroup);
      if (!scoped) {
        const message = `Resource group "${options.resourceGroup}" was not found in this subscription.`;
        recorder.push("resource-groups", "failed", message);
        return { ...base, ok: false, status: "SUBSCRIPTION_ERROR", message, subscriptionName, resourceGroups };
      }
      recorder.push(
        "resource-groups",
        "ok",
        `${groups.length} resource group${groups.length === 1 ? "" : "s"} visible; "${scoped.name}" confirmed in ${scoped.location}.`,
      );
    } else {
      recorder.push("resource-groups", "ok", `${groups.length} resource group${groups.length === 1 ? "" : "s"} visible.`);
    }
  } catch (error) {
    const failure = asFailure(error);
    recorder.push("resource-groups", "failed", failure.message);
    return { ...base, ok: false, status: failure.status, message: failure.message, subscriptionName };
  }

  // 5. Least-privilege RBAC check at the narrowest configured scope.
  const scope = options.resourceGroup
    ? `/subscriptions/${credentials.subscriptionId}/resourceGroups/${encodeURIComponent(options.resourceGroup)}`
    : `/subscriptions/${credentials.subscriptionId}`;
  let permissions: ValidationResult["permissions"] = [];
  try {
    const effective = await client.effectiveActions(scope);
    if (!effective) {
      permissions = REQUIRED_AZURE_ACTIONS.map((a) => ({ ...a, allowed: false }));
      const message = "Azure reported no role assignments for this service principal.";
      recorder.push("permissions", "failed", message);
      return { ...base, ok: false, status: "PERMISSION_ERROR", message, subscriptionName, resourceGroups, permissions };
    }
    permissions = REQUIRED_AZURE_ACTIONS.map((required) => ({
      ...required,
      allowed: actionAllowed(required.action, effective.actions, effective.notActions),
    }));
    const missing = permissions.filter((p) => !p.allowed);
    if (missing.length > 0) {
      const message = `Missing Azure permissions: ${missing.map((m) => m.label).join(", ")}.`;
      recorder.push("permissions", "failed", message);
      return { ...base, ok: false, status: "PERMISSION_ERROR", message, subscriptionName, resourceGroups, permissions };
    }
    recorder.push("permissions", "ok", "All required VM permissions are granted.");
  } catch (error) {
    const failure = asFailure(error);
    recorder.push("permissions", "failed", failure.message);
    return { ...base, ok: false, status: failure.status, message: failure.message, subscriptionName, resourceGroups };
  }

  return {
    ...base,
    ok: true,
    status: "CONNECTED",
    message: "Connection successful.",
    subscriptionName,
    resourceGroups,
    permissions,
  };
}

function asFailure(error: unknown): { status: ValidationResult["status"]; message: string } {
  if (error instanceof AzureConnectionError) return { status: error.status, message: error.message };
  console.error("Azure validation failed:", error);
  return { status: "UNAVAILABLE", message: "Azure could not be reached. Try again in a moment." };
}
