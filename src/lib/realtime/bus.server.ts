import { PHASE_PROGRESS, type LifecycleEvent, type LifecyclePhase, type LifecycleSource } from "@/lib/cloud/types";
import {
  appendLifecycleEvent,
  lastLifecyclePhase,
  lifecycleSince,
} from "@/lib/db/lifecycle-events.repo.server";

/**
 * Server-side lifecycle event bus.
 *
 * The database is the source of truth: every event is written to
 * `lifecycle_events` and its identity column supplies the sequence number the
 * browser uses to resume. The in-memory channel below exists only for live
 * fanout to sockets attached to *this* worker — it holds no authoritative
 * history, so replay works after a restart and across instances.
 */

interface Channel {
  /** Fallback counter used only when the durable write fails. */
  localSeq: number;
  subscribers: Set<(event: LifecycleEvent) => void>;
}

let channels: Map<string, Channel> | null = null;

function channel(sessionId: string): Channel {
  if (!channels) channels = new Map<string, Channel>();
  let existing = channels.get(sessionId);
  if (!existing) {
    existing = { localSeq: 0, subscribers: new Set() };
    channels.set(sessionId, existing);
  }
  return existing;
}

export interface PublishInput {
  sessionId: string;
  vmId: string;
  phase: LifecyclePhase;
  message: string;
  source?: LifecycleSource;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Persist a lifecycle event, then fan it out to live subscribers. Awaiting the
 * durable write is what guarantees a reconnecting browser sees the same
 * sequence numbers it saw on the stream.
 */
export async function publishLifecycle(input: PublishInput): Promise<LifecycleEvent> {
  const c = channel(input.sessionId);
  const source = input.source ?? "controller";

  const persisted = await appendLifecycleEvent({
    sessionId: input.sessionId,
    vmId: input.vmId,
    phase: input.phase,
    message: input.message,
    source,
    correlationId: input.correlationId ?? null,
    metadata: input.metadata ?? {},
  });

  const event: LifecycleEvent = persisted ?? {
    // Durable write failed: still notify attached clients, but flag the event
    // with a local sequence so replay does not silently skip it.
    seq: --c.localSeq,
    sessionId: input.sessionId,
    vmId: input.vmId,
    phase: input.phase,
    message: input.message,
    progress: PHASE_PROGRESS[input.phase],
    source,
    at: new Date().toISOString(),
  };

  for (const notify of c.subscribers) {
    try {
      notify(event);
    } catch {
      /* a broken stream must never stop the others */
    }
  }
  return event;
}

/** Last durable phase for a session, used to suppress duplicate events. */
export async function lastPhase(sessionId: string): Promise<LifecyclePhase | null> {
  return lastLifecyclePhase(sessionId);
}

/** Durable replay: everything after `afterSeq`, straight from the database. */
export async function historySince(sessionId: string, afterSeq: number): Promise<LifecycleEvent[]> {
  return lifecycleSince(sessionId, afterSeq);
}

export function subscribeLifecycle(sessionId: string, listener: (event: LifecycleEvent) => void): () => void {
  const c = channel(sessionId);
  c.subscribers.add(listener);
  return () => {
    c.subscribers.delete(listener);
    if (c.subscribers.size === 0) channels?.delete(sessionId);
  };
}

/** Drops the local fanout channel. Durable history is untouched. */
export function closeChannel(sessionId: string) {
  channels?.delete(sessionId);
}
