import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { assertWorkspace, result, withTool } from "../context";

export default defineTool({
  name: "skilltrack_list_labs",
  title: "List labs",
  description:
    "List the SkillTrack Labs labs this user can launch, with workspace, status and duration. Learners see only labs assigned to them; administrators see the labs of their own organisation.",
  inputSchema: {
    workspaceId: z.string().uuid().optional().describe("Restrict the list to one workspace."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withTool<{ workspaceId?: string | undefined }>(
    { name: "skilltrack_list_labs", group: "catalog" },
    async (input, principal) => {
      if (input.workspaceId) assertWorkspace(principal, input.workspaceId);
      const { loadCatalog, toCatalogPrincipal } = await import("@/lib/db/catalog.repo.server");
      const catalog = await loadCatalog(toCatalogPrincipal(principal.identity));
      const workspaces = new Map(catalog.workspaces.map((w) => [w.id, w]));
      const labs = catalog.labs
        .filter((lab) => (input.workspaceId ? lab.workspaceId === input.workspaceId : true))
        .filter((lab) => workspaces.has(lab.workspaceId))
        .map((lab) => ({
          labId: lab.id,
          title: lab.title,
          status: lab.status,
          workspaceId: lab.workspaceId,
          workspaceName: workspaces.get(lab.workspaceId)?.name ?? "",
          durationMinutes: lab.durationMinutes,
          launchable: lab.status === "published",
        }));
      return result({ ok: true, count: labs.length, labs });
    },
  ),
});
