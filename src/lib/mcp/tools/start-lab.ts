import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { assertLab, fail, result, withTool } from "../context";
import { safeSession } from "../redact";

/**
 * Starts a lab through the very same server flow as the web UI, so quota,
 * allocation, idempotency and rollback behave identically for agents.
 */
export default defineTool({
  name: "skilltrack_start_lab",
  title: "Start lab",
  description:
    "Start a SkillTrack Labs lab for the signed-in user and return the resulting session. Repeating the call for a lab that is already running returns the existing session instead of a second machine. The lab must be published and assigned to the caller.",
  inputSchema: { labId: z.string().uuid().describe("The lab to launch.") },
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  handler: withTool<{ labId: string }>(
    { name: "skilltrack_start_lab", group: "lifecycle", mutates: true },
    async (input, principal) => {
      assertLab(principal, input.labId);
      const { launchLab } = await import("@/lib/launch/launch.server");
      const { newCorrelationId } = await import("@/lib/observability/correlation");
      const correlationId = newCorrelationId("mcp");
      const outcome = await launchLab({
        labId: input.labId,
        principal: principal.identity,
        launchKey: `mcp:${principal.sub}:${input.labId}`,
        correlationId,
        channel: "mcp",
      });
      if (!outcome.ok) fail("UPSTREAM_ERROR", outcome.detail ?? `The lab could not be started (${outcome.code}).`);

      const { getSession } = await import("@/lib/session/registry.server");
      const snapshot = await getSession(outcome.sessionId);
      if (!snapshot) fail("UPSTREAM_ERROR", "The session was created but could not be read back.");
      return result({
        ok: true,
        reused: outcome.reused,
        message: outcome.reused
          ? "This lab was already running; returning the existing session."
          : "Lab starting. Poll skilltrack_get_session until the machine is ready.",
        session: safeSession(snapshot.session, { remainingMs: snapshot.remainingMs }),
      });
    },
  ),
});
