import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { assertWorkspace, result, tenantOfWorkspace, withTool } from "../context";
import { safeSession } from "../redact";

export default defineTool({
  name: "skilltrack_list_sessions",
  title: "List sessions",
  description:
    "List lab sessions visible to this user with their status and remaining time. Learners see only their own sessions; administrators see the sessions of their own organisation. Connection details and machine addresses are never returned.",
  inputSchema: {
    live: z.boolean().optional().describe("Only sessions that are still running (default true)."),
    workspaceId: z.string().uuid().optional().describe("Restrict the list to one workspace."),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withTool<{ live?: boolean | undefined; workspaceId?: string | undefined; limit?: number | undefined }>(
    { name: "skilltrack_list_sessions", group: "session" },
    async (input, principal) => {
      if (input.workspaceId) assertWorkspace(principal, input.workspaceId);
      const { listSessions } = await import("@/lib/session/registry.server");
      const { isLive } = await import("@/lib/session/types");
      const admin = principal.role === "admin" || principal.role === "superadmin";
      const all = await listSessions();

      const visible: typeof all = [];
      for (const session of all) {
        if (!admin && session.userId !== principal.sub) continue;
        if (input.workspaceId && session.workspaceId !== input.workspaceId) continue;
        if ((input.live ?? true) && !isLive(session.status)) continue;
        if (admin && principal.role !== "superadmin") {
          // Administrators stay inside their own organisation.
          if ((await tenantOfWorkspace(session.workspaceId)) !== principal.tenantId) continue;
        }
        visible.push(session);
      }

      const sessions = visible
        .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
        .slice(0, input.limit ?? 20)
        .map((session) => safeSession(session));
      return result({ ok: true, count: sessions.length, sessions });
    },
  ),
});
