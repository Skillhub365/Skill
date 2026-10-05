import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, ownedSession, result, withTool } from "../context";

/**
 * Re-brokers the remote desktop. The tunnel URL, gateway address and machine
 * IP are deliberately withheld: the agent gets a state, and the learner opens
 * the desktop in the SkillTrack Labs browser session.
 */
export default defineTool({
  name: "skilltrack_reconnect_session",
  title: "Reconnect remote desktop",
  description:
    "Re-establish the remote desktop connection for a running SkillTrack Labs session and report the connection state. Returns no tunnel URL, gateway address or machine address — the learner opens the desktop in the SkillTrack Labs app.",
  inputSchema: { sessionId: z.string().min(4).max(120) },
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  handler: withTool<{ sessionId: string }>(
    { name: "skilltrack_reconnect_session", group: "lifecycle", mutates: true },
    async (input, principal) => {
      const snapshot = await ownedSession(principal, input.sessionId);
      const session = snapshot.session;
      const { isLive } = await import("@/lib/session/types");
      if (!isLive(session.status) || snapshot.remainingMs <= 0) {
        fail("INVALID_REQUEST", "That session has ended. Start the lab again.");
      }

      const { cloudController } = await import("@/lib/cloud/controller.server");
      const status = await cloudController.getVMStatus(session.vmId, session.provider).catch(() => null);
      if (status !== "READY" && status !== "RUNNING" && status !== "READINESS_CHECK") {
        fail("UPSTREAM_ERROR", "The machine is not running yet; try again shortly.");
      }

      const { remoteDesktop } = await import("@/lib/remote-desktop/service.server");
      const { resolvePrivateIp } = await import("@/lib/vm/private-endpoints.server");
      const { normalizeGatewayError } = await import("@/lib/remote-desktop/gateway-errors");
      try {
        await remoteDesktop().terminateConnection(input.sessionId).catch(() => null);
        const connection = await remoteDesktop().createConnection({
          sessionId: input.sessionId,
          vmId: session.vmId,
          machineName: session.vmName,
          privateIp: (await resolvePrivateIp(session.vmId)) ?? undefined,
          durationMinutes: Math.max(1, Math.round(snapshot.remainingMs / 60_000)),
        });
        const { heartbeat } = await import("@/lib/session/registry.server");
        await heartbeat(input.sessionId, { connectionStatus: "CONNECTING" }).catch(() => null);
        return result({
          ok: true,
          sessionId: input.sessionId,
          connectionState: connection.state,
          protocol: connection.protocol,
          message: "Desktop re-brokered. Open the session in SkillTrack Labs to use it.",
        });
      } catch (error) {
        fail("UPSTREAM_ERROR", normalizeGatewayError(error).friendly);
      }
    },
  ),
});
