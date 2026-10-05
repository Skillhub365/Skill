/**
 * Deterministic time helpers.
 *
 * Session expiry, heartbeat grace and allocation leases are all wall-clock
 * driven, so tests move a fake clock instead of sleeping.
 */

import { vi } from "vitest";

export const T0 = new Date("2026-03-01T09:00:00.000Z");

export function useFakeClock(start: Date = T0) {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  return {
    /** Advance both the clock and any pending timers. */
    async advanceMinutes(minutes: number) {
      await vi.advanceTimersByTimeAsync(minutes * 60_000);
    },
    async advanceMs(ms: number) {
      await vi.advanceTimersByTimeAsync(ms);
    },
    /** Move the clock without firing intervals (cheaper for long jumps). */
    jumpMinutes(minutes: number) {
      vi.setSystemTime(new Date(Date.now() + minutes * 60_000));
    },
    restore() {
      vi.useRealTimers();
    },
  };
}