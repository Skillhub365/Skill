import type { Row } from "./fake-supabase";

/**
 * VM pool rows plus a stand-in for the `allocate_pool_vm` SECURITY DEFINER
 * function. The stand-in mirrors the production contract: it claims exactly
 * one AVAILABLE row per call and stamps a lease on it, which is what makes the
 * concurrency tests meaningful.
 */

export function poolRow(overrides: Partial<Row> & { id: string; template_id: string }): Row {
  const now = new Date().toISOString();
  return {
    tenant_id: null,
    name: overrides.id,
    template_name: "Windows 11 Lab",
    workspace_id: null,
    lab_id: null,
    cloud_connection_id: "conn-1",
    cloud_connection_name: "Azure Lab Subscription",
    subscription_id: "00000000-0000-0000-0000-00000000cafe",
    resource_group: "rg-labs",
    azure_resource_id: `/subscriptions/fake/resourceGroups/rg-labs/providers/Microsoft.Compute/virtualMachines/${overrides.id}`,
    azure_vm_name: overrides.id,
    region: "westeurope",
    vm_size: "Standard_D4s_v5",
    image_version: "1.0.0",
    os_type: "Windows",
    status: "AVAILABLE",
    power_state: "deallocated",
    private_ip: "10.0.0.4",
    assigned_user_id: null,
    assigned_user_name: null,
    current_session_id: null,
    allocation_lock_token: null,
    allocation_expires_at: null,
    orphaned: false,
    last_error: null,
    last_synced_at: now,
    mock: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** The atomic claim, as the database performs it. */
export function allocatePoolVmHandler(tables: Record<string, Row[]>) {
  return (args: Row) => {
    const rows = tables["vm_pool_entries"] ?? [];
    const candidate = rows.find(
      (row) =>
        row["template_id"] === args["p_template_id"] &&
        row["status"] === "AVAILABLE" &&
        row["current_session_id"] === null &&
        (!args["p_workspace_id"] || !row["workspace_id"] || row["workspace_id"] === args["p_workspace_id"]),
    );
    if (!candidate) return null;
    const seconds = Number(args["p_lock_seconds"] ?? 900);
    Object.assign(candidate, {
      status: "ALLOCATED",
      lab_id: args["p_lab_id"] ?? null,
      assigned_user_id: args["p_user_id"] ?? null,
      assigned_user_name: args["p_user_name"] ?? null,
      current_session_id: args["p_session_id"] ?? null,
      allocation_lock_token: args["p_lock_token"] ?? null,
      allocation_expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
    return [{ ...candidate }];
  };
}