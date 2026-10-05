import { defineTool } from "@lovable.dev/mcp-js";
import { result, withTool } from "../context";
import { routing } from "../config";

export default defineTool({
  name: "skilltrack_whoami",
  title: "Who am I",
  description:
    "Return the SkillTrack Labs identity behind this connection: display name, role, organisation and how many workspaces and labs are reachable. Use it to confirm the agent is connected as the right person before acting.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withTool({ name: "skilltrack_whoami", group: "diagnostics" }, async (_input, principal) =>
    result({
      ok: true,
      name: principal.name,
      email: principal.email,
      role: principal.role,
      organisationId: principal.tenantId,
      workspaceCount: principal.workspaceIds.length,
      assignedLabCount: principal.labIds.length,
      capabilities: principal.capabilities,
      enabledToolGroups: routing().enabledGroups,
      mutationsAllowed: routing().allowMutations,
    }),
  ),
});
