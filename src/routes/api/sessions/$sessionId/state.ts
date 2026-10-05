import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const noStore = { "Cache-Control": "no-store" };

const sessionSnapshotSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  workspaceSlug: z.string(),
  labId: z.string(),
  labName: z.string(),
  vmId: z.string(),
  vmName: z.string(),
  provider: z.enum(["Azure", "AWS", "GCP"]),
  createdAt: z.string(),
  startTime: z.string(),
  expiryTime: z.string(),
  endedAt: z.string().nullable(),
  durationMinutes: z.number(),
  extendedMinutes: z.number(),
  maxExtensionMinutes: z.number(),
  status: z.enum(["CREATING", "STARTING", "ACTIVE", "DISCONNECTING", "EXPIRED", "STOPPED", "ERROR"]),
  connectionStatus: z.enum(["NONE", "CONNECTING", "CONNECTED", "DISCONNECTED", "ERROR"]),
  endReason: z.string().nullable(),
  lastSeenAt: z.string(),
  message: z.string(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("heartbeat"),
    connectionStatus: z.enum(["NONE", "CONNECTING", "CONNECTED", "DISCONNECTED", "ERROR"]).optional(),
    vmStatus: z.string().optional(),
    snapshot: sessionSnapshotSchema.optional(),
  }),
  z.object({ action: z.literal("extend"), minutes: z.number().int().min(5).max(240), snapshot: sessionSnapshotSchema.optional() }),
  z.object({ action: z.literal("stop"), snapshot: sessionSnapshotSchema.optional() }),
]);

export const Route = createFileRoute("/api/sessions/$sessionId/state")({
  server: {
    handlers: {
      /** Authoritative session clock + state. */
      GET: async ({ params, request }) => {
        const { authorize, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { sessionId: params.sessionId });
        if ("denied" in guard) return guard.denied;
        // Session state is durable: a cold worker rehydrates from the
        // database, so client-supplied snapshots are never trusted.
        const registry = await import("@/lib/session/registry.server");
        const snapshot = await registry.getSession(params.sessionId);
        if (!snapshot) return deny("SESSION_NOT_FOUND");
        if (guard.context.principal.role !== "admin" && snapshot.session.userId !== guard.context.principal.sub) {
          return deny("FORBIDDEN_SESSION");
        }
        return Response.json(snapshot, { headers: noStore });
      },
      /** heartbeat | extend | stop */
      POST: async ({ params, request }) => {
        const { authorize, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { sessionId: params.sessionId });
        if ("denied" in guard) return guard.denied;
        const parsed = actionSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return deny("INVALID_REQUEST");
        }
        const registry = await import("@/lib/session/registry.server");
        const known = await registry.getSessionRaw(params.sessionId);
        if (known && guard.context.principal.role !== "admin" && known.userId !== guard.context.principal.sub) {
          return deny("FORBIDDEN_SESSION");
        }
        if (parsed.data.action === "heartbeat") {
          const snapshot = await registry.heartbeat(params.sessionId, {
            ...(parsed.data.connectionStatus ? { connectionStatus: parsed.data.connectionStatus } : {}),
            ...(parsed.data.vmStatus ? { vmStatus: parsed.data.vmStatus } : {}),
          });
          if (!snapshot) return Response.json({ error: "Session not found" }, { status: 404, headers: noStore });
          return Response.json(snapshot, { headers: noStore });
        }
        if (parsed.data.action === "extend") {
          const result = await registry.extendSession(params.sessionId, parsed.data.minutes);
          if (!result.snapshot) return deny("SESSION_NOT_FOUND");
          if (result.error) return Response.json({ error: result.error, ...result.snapshot }, { status: 409, headers: noStore });
          return Response.json(result.snapshot, { headers: noStore });
        }
        const stopped = await registry.stopSession(params.sessionId);
        if (!stopped) return deny("SESSION_NOT_FOUND");
        return Response.json(stopped, { headers: noStore });
      },
      /** Same as POST { action: "stop" } — used by beacons on browser close. */
      DELETE: async ({ params, request }) => {
        const { authorize } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { sessionId: params.sessionId });
        if ("denied" in guard) return guard.denied;
        const registry = await import("@/lib/session/registry.server");
        const stopped = await registry.stopSession(params.sessionId);
        if (!stopped) return Response.json({ error: "Session not found" }, { status: 404, headers: noStore });
        return Response.json(stopped, { headers: noStore });
      },
    },
  },
});
