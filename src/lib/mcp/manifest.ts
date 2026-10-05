/**
 * Client-safe description of the MCP tool surface, used by the admin console.
 * Kept separate from the server definition so the browser bundle never pulls
 * server-only tool code.
 */
export interface McpToolInfo {
  name: string;
  title: string;
  group: "catalog" | "session" | "lifecycle" | "diagnostics";
  mutates: boolean;
  summary: string;
}

export const MCP_TOOLS: McpToolInfo[] = [
  { name: "skilltrack_health", title: "MCP health", group: "diagnostics", mutates: false, summary: "Deployment health and routing; no tenant data." },
  { name: "skilltrack_whoami", title: "Who am I", group: "diagnostics", mutates: false, summary: "Identity, role and reach of the connected user." },
  { name: "skilltrack_list_labs", title: "List labs", group: "catalog", mutates: false, summary: "Labs the caller may launch." },
  { name: "skilltrack_list_sessions", title: "List sessions", group: "session", mutates: false, summary: "Visible sessions with remaining time." },
  { name: "skilltrack_get_session", title: "Get session status", group: "session", mutates: false, summary: "Lifecycle, connection and machine state of one session." },
  { name: "skilltrack_start_lab", title: "Start lab", group: "lifecycle", mutates: true, summary: "Launch a lab; idempotent per user and lab." },
  { name: "skilltrack_stop_lab", title: "Stop lab", group: "lifecycle", mutates: true, summary: "End a session and release the machine." },
  { name: "skilltrack_extend_session", title: "Extend session", group: "session", mutates: true, summary: "Add time within the lab's allowance." },
  { name: "skilltrack_reconnect_session", title: "Reconnect desktop", group: "lifecycle", mutates: true, summary: "Re-broker the desktop; returns state only." },
];
