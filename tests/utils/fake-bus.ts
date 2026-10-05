/**
 * Fake lifecycle/event bus.
 *
 * Captures every lifecycle phase that would have been streamed to a learner's
 * browser so tests can assert ordering without opening an SSE connection.
 */

export interface BusEvent {
  sessionId: string;
  vmId?: string;
  phase: string;
  message?: string;
  at: number;
}

export function createFakeBus() {
  const events: BusEvent[] = [];
  return {
    events,
    async publishLifecycle(event: Omit<BusEvent, "at">) {
      events.push({ ...event, at: Date.now() });
    },
    phases() {
      return events.map((e) => e.phase);
    },
    forSession(sessionId: string) {
      return events.filter((e) => e.sessionId === sessionId);
    },
    reset() {
      events.length = 0;
    },
  };
}