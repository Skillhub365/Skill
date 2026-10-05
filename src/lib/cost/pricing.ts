/**
 * Estimated compute pricing.
 *
 * SkillTrack does not read Azure Cost Management. Every figure derived from
 * this table is an ESTIMATE and must be labelled as such in the UI and in
 * exports. Rates are configurable without a deploy through
 * `VM_HOURLY_RATES_CENTS` (JSON: {"Standard_D2s_v5": 10}), so finance can align
 * them with the customer's actual agreement.
 */

export const PRICING_SOURCE = "estimate" as const;

/** Indicative pay-as-you-go rates, US cents per hour. */
const DEFAULT_RATES_CENTS: Record<string, number> = {
  Standard_B2ms: 8.3,
  Standard_B4ms: 16.6,
  Standard_D2s_v5: 9.6,
  Standard_D4s_v5: 19.2,
  Standard_D8s_v5: 38.4,
  Standard_E4s_v5: 25.2,
  Standard_E8s_v5: 50.4,
};

const FALLBACK_RATE_CENTS = 12;

let cached: Record<string, number> | null = null;

function rates(): Record<string, number> {
  if (cached) return cached;
  const raw = process.env["VM_HOURLY_RATES_CENTS"];
  let overrides: Record<string, number> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        overrides = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>)
            .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
            .map(([key, value]) => [key, value as number]),
        );
      }
    } catch {
      /* malformed override: fall back to defaults rather than fail a launch */
    }
  }
  cached = { ...DEFAULT_RATES_CENTS, ...overrides };
  return cached;
}

/** Reset the memoised table (tests and after a configuration reload). */
export function resetPricingCache() {
  cached = null;
}

export function hourlyRateCents(vmSize: string | null | undefined): number {
  if (!vmSize) return FALLBACK_RATE_CENTS;
  return rates()[vmSize] ?? FALLBACK_RATE_CENTS;
}

export function estimateCostCents(vmSize: string | null | undefined, hours: number): number {
  return Math.max(0, hours) * hourlyRateCents(vmSize);
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Rate card for the admin console, so operators can see what feeds estimates. */
export function rateCard(): Array<{ size: string; hourlyRateCents: number }> {
  return Object.entries(rates())
    .map(([size, hourlyRateCents]) => ({ size, hourlyRateCents }))
    .sort((a, b) => a.hourlyRateCents - b.hourlyRateCents);
}
