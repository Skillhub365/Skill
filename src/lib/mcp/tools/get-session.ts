import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ownedSession, result, withTool } from "../context";
import { safeSession } from "../redact";

export default defineTool({
  name: "skilltrack_get_session",
  title: "Get session status",
  description:
    "Return the live status of one SkillTrack Labs session: lifecycle state, connection state, machine readiness and minutes remaining. Access is refused unless the session belongs to this user, or to an administrator of the same organisation.",
  inputSchema: { sessionId: z.string().min(4).max(120).describe("The session id.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withTool<{ sessionId: string }>(
    { name: "skilltrack_get_session", group: "session" },
    async (input, principal) => {
      const snapshot = await ownedSession(principal, input.sessionId);
      const { cloudController } = await import("@/lib/cloud/controller.server");
      const vmStatus = await cloudController
        .getVMStatus(snapshot.session.vmId, snapshot.session.provider)
        .catch(() => null);
      return result({
        ok: true,
        session: safeSession(snapshot.session, { remainingMs: snapshot.remainingMs, vmStatus }),
        canExtend: snapshot.canExtend,
        extendableMinutes: snapshot.extendableMinutes,
        serverTime: snapshot.serverTime,
      });
    },
  ),
});
