import { describe, expect, it } from "vitest";
import { redactResourceId, LIVE_STATUSES } from "@/lib/reporting/usage-detail.server";

describe("usage reporting", () => {
  it("redacts the subscription id from an Azure resource id", () => {
    const id =
      "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-labs/providers/Microsoft.Compute/virtualMachines/lab-vm-01";
    const redacted = redactResourceId(id);
    expect(redacted).toBe("…/resourceGroups/rg-labs/…/lab-vm-01");
    expect(redacted).not.toContain("11111111");
  });

  it("returns null when no resource id is present", () => {
    expect(redactResourceId(null)).toBeNull();
  });

  it("treats running sessions as live for billing through now", () => {
    expect(LIVE_STATUSES).toContain("ACTIVE");
    expect(LIVE_STATUSES).not.toContain("EXPIRED");
  });
});
