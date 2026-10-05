import { describe, expect, it } from "vitest";
import { combineRealtime, type RealtimeSubscription } from "@/lib/realtime/useRealtimeTable";

const sub = (status: RealtimeSubscription["status"], lastEventAt: Date | null = null): RealtimeSubscription => ({
  status,
  live: status === "live",
  lastEventAt,
});

describe("combineRealtime", () => {
  it("reports live only when every subscription is live", () => {
    expect(combineRealtime(sub("live"), sub("live")).status).toBe("live");
    expect(combineRealtime(sub("live"), sub("reconnecting")).status).toBe("reconnecting");
    expect(combineRealtime(sub("live"), sub("fallback")).status).toBe("fallback");
  });

  it("keeps the most recent event timestamp", () => {
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-01-02T00:00:00Z");
    expect(combineRealtime(sub("live", older), sub("live", newer)).lastEventAt).toEqual(newer);
  });

  it("falls back when there are no subscriptions", () => {
    expect(combineRealtime().status).toBe("fallback");
  });
});
