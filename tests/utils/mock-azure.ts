/**
 * Mock Azure provider.
 *
 * Tests never reach Azure Resource Manager. This records the calls that the
 * orchestrator would have made and returns deterministic VM records.
 */

export interface MockVm {
  id: string;
  name: string;
  status: string;
  provider: "Azure";
  privateIp: string;
  region: string;
  size: string;
}

export interface MockAzure {
  calls: Array<{ op: string; vmId: string }>;
  vms: Map<string, MockVm>;
  createVM(input: Record<string, unknown>): Promise<MockVm>;
  startVM(vmId: string): Promise<MockVm>;
  stopVM(vmId: string): Promise<MockVm | null>;
  getVM(vmId: string): Promise<MockVm | null>;
  extendVM(vmId: string): Promise<void>;
}

export function createMockAzure(): MockAzure {
  const azure: MockAzure = {
    calls: [],
    vms: new Map(),
    async createVM(input) {
      const id = `vm-${azure.vms.size + 1}`;
      const vm: MockVm = {
        id,
        name: String(input["name"] ?? id),
        status: "STOPPED",
        provider: "Azure",
        // Private addresses stay inside the mock; they are never asserted into
        // an API response.
        privateIp: "10.0.0.10",
        region: String(input["region"] ?? "westeurope"),
        size: String(input["size"] ?? "Standard_D4s_v5"),
      };
      azure.vms.set(id, vm);
      azure.calls.push({ op: "create", vmId: id });
      return vm;
    },
    async startVM(vmId) {
      const vm = azure.vms.get(vmId);
      if (!vm) throw new Error("VM not found");
      vm.status = "READY";
      azure.calls.push({ op: "start", vmId });
      return vm;
    },
    async stopVM(vmId) {
      const vm = azure.vms.get(vmId) ?? null;
      if (vm) vm.status = "STOPPED";
      azure.calls.push({ op: "stop", vmId });
      return vm;
    },
    async getVM(vmId) {
      return azure.vms.get(vmId) ?? null;
    },
    async extendVM(vmId) {
      azure.calls.push({ op: "extend", vmId });
    },
  };
  return azure;
}