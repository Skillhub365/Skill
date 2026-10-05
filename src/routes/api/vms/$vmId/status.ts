import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const adoptSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(["Azure", "AWS", "GCP"]),
  region: z.string(),
  size: z.string(),
  image: z.string(),
  status: z.string(),
  templateId: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  labId: z.string(),
  labName: z.string(),
  userId: z.string(),
  userName: z.string(),
  sessionId: z.string().nullable(),
  startedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

export const Route = createFileRoute("/api/vms/$vmId/status")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { authorize, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { vmId: params.vmId });
        if ("denied" in guard) return guard.denied;
        const { orchestrator } = await import("@/lib/vm/orchestrator.server");
        let vm = await orchestrator.getVM(params.vmId);

        if (!vm) {
          // Worker may have recycled: rehydrate from the caller's snapshot.
          const url = new URL(request.url);
          const snapshot = url.searchParams.get("snapshot");
          if (snapshot) {
            const parsed = adoptSchema.safeParse(JSON.parse(snapshot));
            if (parsed.success) {
              vm = await orchestrator.adopt({
                ...parsed.data,
                status: parsed.data.status as never,
                readiness: { checked: false, ready: false, detail: "Rehydrated" },
                message: "",
              });
            }
          }
        }
        if (!vm) return deny("VM_UNAVAILABLE");
        if (guard.context.principal.role !== "admin" && vm.userId && vm.userId !== guard.context.principal.sub) {
          return deny("FORBIDDEN_VM");
        }

        const readiness = await orchestrator.checkVMReadiness(vm.id);
        return Response.json(
          { vm, status: vm.status, readiness },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});