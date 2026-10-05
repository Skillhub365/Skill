import { describe, expect, it } from "vitest";
import { classifyAzureEvent } from "@/lib/cloud/events/ingest.server";

const vmResource =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-labs/providers/Microsoft.Compute/virtualMachines/vm-lab-01";

function evt(operationName: string, status: string, eventType = "Microsoft.Resources.ResourceWriteSuccess") {
  return { eventType, subject: vmResource, data: { operationName, status, resourceUri: vmResource } };
}

describe("Azure Event Grid classification", () => {
  it("maps an accepted start to start-accepted", () => {
    expect(classifyAzureEvent(evt("Microsoft.Compute/virtualMachines/start/action", "Accepted"))).toBe("start-accepted");
  });

  it("maps a succeeded start to running", () => {
    expect(classifyAzureEvent(evt("Microsoft.Compute/virtualMachines/start/action", "Succeeded"))).toBe("running");
  });

  it("maps deallocate in flight and completed", () => {
    expect(classifyAzureEvent(evt("Microsoft.Compute/virtualMachines/deallocate/action", "Accepted"))).toBe("deallocating");
    expect(classifyAzureEvent(evt("Microsoft.Compute/virtualMachines/deallocate/action", "Succeeded"))).toBe("deallocated");
  });

  it("maps failures", () => {
    expect(classifyAzureEvent(evt("Microsoft.Compute/virtualMachines/start/action", "Failed"))).toBe("failed");
    expect(
      classifyAzureEvent(evt("Microsoft.Compute/virtualMachines/write", "Failed", "Microsoft.Resources.ResourceWriteFailure")),
    ).toBe("provisioning-failed");
  });

  it("maps deletion", () => {
    expect(
      classifyAzureEvent(evt("Microsoft.Compute/virtualMachines/delete", "Succeeded", "Microsoft.Resources.ResourceDeleteSuccess")),
    ).toBe("deleted");
  });

  it("ignores unrelated events", () => {
    expect(classifyAzureEvent({ eventType: "Microsoft.Storage.BlobCreated", subject: "/blobs/x" })).toBeNull();
  });
});