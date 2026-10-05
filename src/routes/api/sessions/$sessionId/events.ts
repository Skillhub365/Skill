import { createFileRoute } from "@tanstack/react-router";

/**
 * Server-sent lifecycle stream for one session.
 *
 * The browser opens this once and receives REQUESTED -> ... -> READY /
 * CONNECTED / ERROR pushes. It never talks to Azure, and the stream is
 * authorised on every connection: a session URL alone grants nothing.
 */
export const Route = createFileRoute("/api/sessions/$sessionId/events")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { authorize, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { sessionId: params.sessionId });
        if ("denied" in guard) return guard.denied;

        const { getSessionRaw } = await import("@/lib/session/registry.server");
        const session = await getSessionRaw(params.sessionId);
        if (session && session.userId !== guard.context.principal.sub && guard.context.principal.role !== "admin") {
          return deny("FORBIDDEN_SESSION");
        }

        const { subscribeLifecycle, historySince } = await import("@/lib/realtime/bus.server");
        const url = new URL(request.url);
        const afterSeq = Number(url.searchParams.get("after") ?? "0") || 0;

        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let keepAlive: ReturnType<typeof setInterval> | null = null;

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (payload: unknown) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
              } catch {
                /* client went away */
              }
            };
            // Subscribe first so nothing published during the durable replay
            // read is lost, then drop replayed events the client already has.
            let replayedThrough = afterSeq;
            const live: typeof send = (payload) => {
              const seq = (payload as { seq?: number })?.seq ?? 0;
              if (seq > 0 && seq <= replayedThrough) return;
              send(payload);
            };
            unsubscribe = subscribeLifecycle(params.sessionId, live);
            // Replay anything published before this connection was established.
            for (const event of await historySince(params.sessionId, afterSeq)) {
              replayedThrough = Math.max(replayedThrough, event.seq);
              send(event);
            }
            keepAlive = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": keep-alive\n\n"));
              } catch {
                /* ignored */
              }
            }, 15_000);
            request.signal.addEventListener("abort", () => {
              unsubscribe?.();
              if (keepAlive) clearInterval(keepAlive);
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            });
          },
          cancel() {
            unsubscribe?.();
            if (keepAlive) clearInterval(keepAlive);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});