/**
 * Azure Event Grid ingest: turn a provider event into SkillTrack state.
 *
 * Flow per event: classify -> resolve the Azure resource to a registered
 * machine -> update power/status -> persist a lifecycle event for any live
 * session -> audit. Unknown resources are counted and dropped, never guessed.
 */

import type { LifecyclePhase } from "@/lib/cloud/types";
import type { PoolVmStatus } from "@/lib/vm/pool/types";
import type { AzureEventKind, IngestSummary } from "./types";

export interface RawAzureEvent {
  id?: string | undefined;
  eventType?: string | undefined;
  subject?: string | undefined;
  topic?: string | undefined;
  eventTime?: string | undefined;
  data?:
    | {
        validationCode?: string | undefined;
        validationUrl?: string | undefined;
        resourceUri?: string | undefined;
        status?: string | undefined;
        operationName?: string | undefined;
        subStatus?: string | undefined;
      }
    | undefined;
}

/** Classify an Event Grid payload into one of the kinds SkillTrack acts on. */
export function classifyAzureEvent(event: RawAzureEvent): AzureEventKind | null {
  const type = (event.eventType ?? "").toLowerCase();
  const op = (event.data?.operationName ?? "").toLowerCase();
  const status = (event.data?.status ?? "").toLowerCase();
  const signal = `${type} ${op}`;

  if (type.includes("resourcedeletesuccess") || op.includes("virtualmachines/delete")) return "deleted";
  // Provisioning failure is a failed *write* on the resource; a failed power
  // operation is an ordinary failure even though Event Grid types it as a write.
  if (status === "failed" && (op.includes("write") || (!op && type.includes("write")))) return "provisioning-failed";
  if (status === "failed") return "failed";
  if (signal.includes("deallocate") || signal.includes("poweroff")) {
    return status === "succeeded" ? "deallocated" : "deallocating";
  }
  if (signal.includes("/start/action") || signal.includes("start")) {
    return status === "succeeded" ? "running" : "start-accepted";
  }
  if (signal.includes("write") && status === "succeeded") return "running";
  return null;
}

interface KindEffect {
  powerState: string;
  status: PoolVmStatus | null;
  phase: LifecyclePhase | null;
  message: string;
}

const EFFECTS: Record<AzureEventKind, KindEffect> = {
  "start-accepted": { powerState: "VM starting", status: "STARTING", phase: "STARTING", message: "Azure accepted the start request." },
  running: { powerState: "VM running", status: "RUNNING", phase: "RUNNING", message: "Azure reports the machine is running." },
  deallocating: { powerState: "VM deallocating", status: "STOPPING", phase: "STOPPING", message: "Azure is deallocating the machine." },
  deallocated: { powerState: "VM deallocated", status: "STOPPED", phase: "STOPPED", message: "Azure reports the machine is deallocated." },
  failed: { powerState: "VM unknown", status: "ERROR", phase: "ERROR", message: "Azure reported a failed operation on this machine." },
  "provisioning-failed": { powerState: "VM unknown", status: "ERROR", phase: "ERROR", message: "Azure reported a provisioning failure." },
  deleted: { powerState: "VM deleted", status: "ERROR", phase: "ERROR", message: "The Azure resource for this machine no longer exists." },
};

function resourceOf(event: RawAzureEvent) {
  return (event.data?.resourceUri ?? event.subject ?? "").trim();
}

/**
 * Apply a batch of validated events. Returns counters only — callers echo
 * these back to Azure, so they must not carry resource identifiers.
 */
export async function ingestAzureEvents(events: RawAzureEvent[]): Promise<IngestSummary> {
  const summary: IngestSummary = { received: events.length, applied: 0, ignored: 0, unknownResources: 0 };

  const registry = await import("@/lib/vm/pool/registry.server");
  await registry.ensurePoolLoaded();
  const { publishLifecycle } = await import("@/lib/realtime/bus.server");
  const { getSessionRaw, listSessionIdsForVm } = await import("@/lib/session/registry.server");
  const { recordAzureEvent } = await import("./status.server");
  const { recordCloudAudit, SYSTEM_ACTOR } = await import("@/lib/cloud/audit/audit-log.server");

  for (const event of events) {
    const kind = classifyAzureEvent(event);
    const resource = resourceOf(event);
    if (!kind || !resource) {
      summary.ignored += 1;
      continue;
    }

    const vm = registry.findPoolVmByAzureResourceId(resource);
    if (!vm) {
      // Unknown machines are expected on a shared subscription: log a counter,
      // never the resource path, and move on.
      summary.unknownResources += 1;
      console.warn("[azure-event] no registered machine for an incoming event", { kind });
      continue;
    }

    const effect = EFFECTS[kind];
    const at = event.eventTime ?? new Date().toISOString();
    registry.applyAzureSignal(vm.id, {
      powerState: effect.powerState,
      // A machine held by a live session keeps its SkillTrack status; the
      // state machine also rejects any impossible move.
      ...(vm.currentSessionId && kind !== "deleted" && kind !== "failed" ? {} : { status: effect.status ?? undefined }),
      error: kind === "failed" || kind === "provisioning-failed" || kind === "deleted" ? effect.message : null,
      azureMissing: kind === "deleted",
      eventType: kind,
      source: "eventgrid",
      at,
    });
    recordAzureEvent(vm.cloudConnectionId, kind, at);
    summary.applied += 1;

    // Push the same phase down the learner's launch stream when a session owns
    // the machine, so the browser sees provider truth without polling.
    if (effect.phase) {
      for (const sessionId of await listSessionIdsForVm(vm.id)) {
        if (!(await getSessionRaw(sessionId))) continue;
        await publishLifecycle({
          sessionId,
          vmId: vm.id,
          phase: effect.phase,
          message: effect.message,
          source: "eventgrid",
        });
      }
    }

    try {
      recordCloudAudit({
        action: "cloud.event",
        outcome: kind === "failed" || kind === "provisioning-failed" ? "failure" : "success",
        actor: SYSTEM_ACTOR,
        target: vm.azureVmName,
        connectionId: vm.cloudConnectionId,
        connectionName: vm.cloudConnectionName,
        subscriptionId: vm.subscriptionId,
        resourceGroup: vm.resourceGroup,
        workspaceId: vm.workspaceId,
        detail: `${effect.message} (${kind})`,
      });
    } catch {
      /* auditing is best-effort */
    }
  }

  return summary;
}