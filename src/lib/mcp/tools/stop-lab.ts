import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ownedSession, result, withTool } from "../context";
import { safeSession } from "../redact";

export default defineTool({
  name: "skilltrack_stop_lab",
  title: "Stop lab",
  description:
    "Stop a running SkillTrack Labs session, disconnect its remote desktop and release the machine. This ends the learner's work immediately and cannot be undone.",
  inputSchema: { sessionId: z.string().min(4).max(120) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  handler: withTool<{ sessionId: string }>(
    { name: "skilltrack_stop_lab", group: "lifecycle", mutates: true },
    async (input, principal) => {
      await ownedSession(principal, input.sessionId);
      const { remoteDesktop } = await import("@/lib/remote-desktop/service.server");
      await remoteDesktop().terminateConnection(input.sessionId).catch(() => null);
      const { stopSession } = await import("@/lib/session/registry.server");
      const snapshot = await stopSession(input.sessionId, "user_stopped");
      return result({
        ok: true,
        message: "Session stopped and the machine released.",
        session: snapshot ? safeSession(snapshot.session, { remainingMs: snapshot.remainingMs }) : null,
      });
    },
  ),
});
