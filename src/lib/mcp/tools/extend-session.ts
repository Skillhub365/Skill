import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, ownedSession, result, withTool } from "../context";
import { safeSession } from "../redact";

export default defineTool({
  name: "skilltrack_extend_session",
  title: "Extend session",
  description:
    "Extend a running SkillTrack Labs session by a number of minutes, up to the extension allowance configured for its lab. Refused for sessions the caller does not own and for sessions that have already ended.",
  inputSchema: {
    sessionId: z.string().min(4).max(120),
    minutes: z.number().int().min(5).max(120).describe("Minutes to add; the server clamps this to the allowance."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: withTool<{ sessionId: string; minutes: number }>(
    { name: "skilltrack_extend_session", group: "session", mutates: true },
    async (input, principal) => {
      await ownedSession(principal, input.sessionId);
      const { extendSession } = await import("@/lib/session/registry.server");
      const outcome = await extendSession(input.sessionId, input.minutes);
      if (!outcome.snapshot) fail("NOT_FOUND", "No session with that id.");
      if (outcome.error) fail("INVALID_REQUEST", outcome.error);
      return result({
        ok: true,
        message: `Session extended by up to ${input.minutes} minutes.`,
        session: safeSession(outcome.snapshot.session, { remainingMs: outcome.snapshot.remainingMs }),
      });
    },
  ),
});
