/** Client-safe audit model for cloud connection and VM operations. */

export type CloudAuditAction =
  | "connection.create"
  | "connection.update"
  | "connection.test"
  | "connection.refresh"
  | "connection.scheduled-refresh"
  | "connection.schedule"
  | "connection.disconnect"
  | "workspace.link"
  | "workspace.unlink"
  | "vm.start"
  | "vm.deallocate"
  | "vm.status"
  | "vmpool.register"
  | "vmpool.remove"
  | "vmpool.allocate"
  | "vmpool.release"
  | "vmpool.reclaim"
  | "vmpool.retire"
  | "vmpool.restore"
  | "cloud.event"
  | "cloud.reconcile"
  | "infra.provision"
  | "infra.credentials"
  | "gateway.configure"
  | "gateway.verify";
// Infrastructure provisioning performed by a Super Admin from the console.

export const CLOUD_AUDIT_ACTION_LABEL: Record<CloudAuditAction, string> = {
  "connection.create": "Connection created",
  "connection.update": "Connection updated",
  "connection.test": "Test connection",
  "connection.refresh": "Refresh resources",
  "connection.scheduled-refresh": "Scheduled refresh",
  "connection.schedule": "Refresh schedule changed",
  "connection.disconnect": "Disconnect",
  "workspace.link": "Workspace linked",
  "workspace.unlink": "Workspace unlinked",
  "vm.start": "VM start",
  "vm.deallocate": "VM deallocate",
  "vm.status": "VM status",
  "vmpool.register": "VM pool register",
  "vmpool.remove": "VM pool remove",
  "vmpool.allocate": "VM allocated",
  "vmpool.release": "VM released",
  "vmpool.reclaim": "Orphan reclaimed",
  "vmpool.retire": "VM retired",
  "vmpool.restore": "VM returned to service",
  "cloud.event": "Azure event received",
  "cloud.reconcile": "Azure reconciliation",
  "infra.provision": "Infrastructure provisioned",
  "infra.credentials": "Lab VM credentials saved",
  "gateway.configure": "Gateway settings saved",
  "gateway.verify": "Gateway reachability verified",
};

export type CloudAuditOutcome = "success" | "failure" | "denied";

export interface CloudAuditEntry {
  id: string;
  at: string;
  action: CloudAuditAction;
  outcome: CloudAuditOutcome;
  /** Who performed it: a principal id, or "system" for scheduled work. */
  actorId: string;
  actorName: string;
  actorRole: string;
  connectionId: string | null;
  connectionName: string | null;
  subscriptionId: string | null;
  workspaceId: string | null;
  resourceGroup: string | null;
  target: string | null;
  /** Normalized, stable machine code — never a raw provider message. */
  errorCode: string | null;
  detail: string | null;
  durationMs: number;
}
