import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const createSchema = z.object({
  vmId: z.string().min(1).max(120),
  machineName: z.string().min(1).max(120),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
});

const noStore = { "Cache-Control": "no-store" };

/**
 * Remote access endpoints. Nothing here trusts the URL: the caller must
 * present a valid signed token AND own the server-side session, the session
 * must still be live, and the machine must actually be READY before the
 * gateway is asked to broker a desktop.
 */
async function denyIfNotOwner(sessionId: string, request: Request, vmId?: string) {
  const { authorize } = await import("@/lib/security/guard.server");
  const guard = await authorize(request, { sessionId, ...(vmId ? { vmId } : {}) });
  return "denied" in guard ? guard.denied : null;
}

/**
 * Chain validation for a connection request:
 * user -> workspace -> lab -> session -> VM -> expiry.
 * Returns a denial response, or the validated session record.
 */
async function validateChain(sessionId: string, vmId: string) {
  const { deny } = await import("@/lib/security/guard.server");
  const { getSession } = await import("@/lib/session/registry.server");
  const { isLive } = await import("@/lib/session/types");
  const snapshot = await getSession(sessionId);
  if (!snapshot) return { denied: deny("SESSION_NOT_FOUND") };
  const session = snapshot.session;
  if (!isLive(session.status)) return { denied: deny("SESSION_EXPIRED") };
  if (snapshot.remainingMs <= 0) return { denied: deny("SESSION_EXPIRED") };
  // A learner cannot point their session at somebody else's machine.
  if (session.vmId !== vmId) return { denied: deny("FORBIDDEN_VM") };

  const { cloudController } = await import("@/lib/cloud/controller.server");
  let status: string;
  try {
    status = await cloudController.getVMStatus(vmId, session.provider);
  } catch {
    return { denied: deny("VM_UNAVAILABLE") };
  }
  if (status !== "READY" && status !== "RUNNING" && status !== "READINESS_CHECK") {
    return { denied: deny("VM_UNAVAILABLE", "The machine is not running.") };
  }
  return { session };
}

export const Route = createFileRoute("/api/sessions/$sessionId/connection")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const body = await request.json().catch(() => null);
        const parsed = createSchema.safeParse(body);
        const denied = await denyIfNotOwner(params.sessionId, request, parsed.success ? parsed.data.vmId : undefined);
        if (denied) return denied;
        if (!parsed.success) {
          return Response.json({ error: "INVALID_REQUEST", code: "INVALID_REQUEST" }, { status: 400, headers: noStore });
        }

        const chain = await validateChain(params.sessionId, parsed.data.vmId);
        if ("denied" in chain) return chain.denied;

        const { remoteDesktop } = await import("@/lib/remote-desktop/service.server");
        const { publishLifecycle } = await import("@/lib/realtime/bus.server");
        const { normalizeGatewayError, securityCodeFor } = await import("@/lib/remote-desktop/gateway-errors");
        const { deny } = await import("@/lib/security/guard.server");
        try {
          // The VM's private address is resolved server-side and never accepted
          // from the browser, so a caller cannot point the gateway elsewhere.
          const { resolvePrivateIp } = await import("@/lib/vm/private-endpoints.server");
          await publishLifecycle({
            sessionId: params.sessionId,
            vmId: parsed.data.vmId,
            phase: "CONNECTING",
            message: "Brokering a secure desktop connection.",
            source: "gateway",
          });
          const connection = await remoteDesktop().createConnection({
            sessionId: params.sessionId,
            ...parsed.data,
            privateIp: (await resolvePrivateIp(parsed.data.vmId)) ?? undefined,
          });
          await publishLifecycle({
            sessionId: params.sessionId,
            vmId: parsed.data.vmId,
            phase: "CONNECTED",
            message: "Remote desktop connected.",
            source: "gateway",
          });
          {
            // Durable broker bookkeeping so any worker (and the reaper) can
            // clean this connection up later. No token or address is stored.
            const { upsertGateway, statusFor } = await import("@/lib/db/gateway-connections.repo.server");
            await upsertGateway({
              sessionId: params.sessionId,
              status: statusFor(connection.state),
              expiresAt: connection.expiresAt,
              metadata: {
                vmRef: connection.vmId,
                kind: connection.kind,
                machineName: connection.machineName,
                gateway: connection.gateway,
                ...(connection.clipboard ? { clipboard: connection.clipboard } : {}),
                message: connection.message,
              },
            });
          }
          {
            const { recordMetric, METRIC } = await import("@/lib/observability/metrics.server");
            recordMetric(METRIC.gatewayConnectSucceeded, 1, {
              sessionId: params.sessionId,
              vmId: parsed.data.vmId,
              outcome: "success",
            });
          }
          return Response.json({ connection }, { headers: noStore });
        } catch (error) {
          const failure = normalizeGatewayError(error);
          const { log } = await import("@/lib/observability/logger.server");
          const { recordMetric, METRIC } = await import("@/lib/observability/metrics.server");
          recordMetric(METRIC.gatewayConnectFailed, 1, {
            sessionId: params.sessionId,
            vmId: parsed.data.vmId,
            outcome: "failure",
            metadata: { errorCode: failure.code },
          });
          log.error({
            event: "gateway.connect.failed",
            sessionId: params.sessionId,
            vmId: parsed.data.vmId,
            errorCode: failure.code,
            outcome: "failure",
            message: failure.detail ?? failure.friendly,
          });
          await publishLifecycle({
            sessionId: params.sessionId,
            vmId: parsed.data.vmId,
            phase: "ERROR",
            message: failure.friendly,
            source: "gateway",
          });
          return deny(securityCodeFor(failure.code), failure.friendly);
        }
      },
      GET: async ({ params, request }) => {
        const denied = await denyIfNotOwner(params.sessionId, request);
        if (denied) return denied;
        const { remoteDesktop } = await import("@/lib/remote-desktop/service.server");
        const { normalizeGatewayError } = await import("@/lib/remote-desktop/gateway-errors");
        try {
          const connection = await remoteDesktop().getConnectionStatus(params.sessionId);
          return Response.json({ connection }, { headers: noStore });
        } catch (error) {
          const failure = normalizeGatewayError(error);
          return Response.json(
            { connection: null, code: failure.code, detail: failure.friendly },
            { status: 200, headers: noStore },
          );
        }
      },
      DELETE: async ({ params, request }) => {
        const denied = await denyIfNotOwner(params.sessionId, request);
        if (denied) return denied;
        const { remoteDesktop } = await import("@/lib/remote-desktop/service.server");
        const connection = await remoteDesktop().terminateConnection(params.sessionId).catch(() => null);
        const { markGatewayCleaned } = await import("@/lib/db/gateway-connections.repo.server");
        await markGatewayCleaned(params.sessionId);
        const { heartbeat } = await import("@/lib/session/registry.server");
        await heartbeat(params.sessionId, { connectionStatus: "DISCONNECTED" }).catch(() => null);
        return Response.json({ connection }, { headers: noStore });
      },
    },
  },
});
