import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Azure Event Grid ingest — the production path for live VM state.
 *
 * Azure pushes resource-write / power-state events here; SkillTrack maps them
 * onto registered machines, updates the durable pool row, and publishes the
 * matching lifecycle phase to any live launch stream. Scheduled reconciliation
 * (see reconcile.server.ts) exists only as the safety net under this.
 *
 * Security: public by URL only. Every request must present the shared ingest
 * key (`aeg-subscription-key`, Event Grid's own header, or `x-ingest-key`) and
 * a payload matching the schema below. The response never contains resource
 * IDs, subscription IDs, credentials or provider messages.
 */

const eventSchema = z.object({
  id: z.string().max(200).optional(),
  eventType: z.string().max(200).optional(),
  subject: z.string().max(500).optional(),
  topic: z.string().max(500).optional(),
  eventTime: z.string().max(64).optional(),
  dataVersion: z.string().max(40).optional(),
  data: z
    .object({
      validationCode: z.string().max(200).optional(),
      validationUrl: z.string().max(500).optional(),
      resourceUri: z.string().max(500).optional(),
      status: z.string().max(80).optional(),
      subStatus: z.string().max(80).optional(),
      operationName: z.string().max(200).optional(),
    })
    .passthrough()
    .optional(),
});

const payloadSchema = z.array(eventSchema).min(1).max(100);

const VALIDATION_EVENT = "microsoft.eventgrid.subscriptionvalidationevent";

/** Constant-time-ish comparison so the key cannot be probed byte by byte. */
function secretMatches(provided: string, expected: string) {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/events/azure")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["AZURE_EVENTGRID_KEY"];
        const provided =
          request.headers.get("aeg-subscription-key") ??
          request.headers.get("x-ingest-key") ??
          new URL(request.url).searchParams.get("key") ??
          "";
        if (!expected || !provided || !secretMatches(provided, expected)) {
          const { recordRejectedEvent } = await import("@/lib/cloud/events/status.server");
          recordRejectedEvent();
          console.warn("[azure-event] rejected an unauthenticated ingest attempt");
          return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
        }

        const body = await request.json().catch(() => null);
        const parsed = payloadSchema.safeParse(Array.isArray(body) ? body : [body]);
        if (!parsed.success) {
          const { recordRejectedEvent } = await import("@/lib/cloud/events/status.server");
          recordRejectedEvent();
          return new Response("Invalid payload", { status: 400, headers: { "Cache-Control": "no-store" } });
        }

        // Event Grid subscription handshake: echo the validation code back.
        const validation = parsed.data.find(
          (e) => e.data?.validationCode || (e.eventType ?? "").toLowerCase() === VALIDATION_EVENT,
        );
        if (validation?.data?.validationCode) {
          return Response.json(
            { validationResponse: validation.data.validationCode },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const { ingestAzureEvents } = await import("@/lib/cloud/events/ingest.server");
        const summary = await ingestAzureEvents(parsed.data);
        return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
      },

      /** Some Event Grid setups probe the endpoint before subscribing. */
      OPTIONS: async () => new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } }),
    },
  },
});