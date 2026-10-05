import type { CloudProviderName, VmRecord, VmStatus } from "../types";

/**
 * Normalised runtime view of a machine. Provider-specific wording (Azure power
 * states, provisioning states) is kept here and never rendered raw to a user.
 */
export interface VmInstanceView {
  vmId: string;
  powerState: string | null;
  provisioningState: string | null;
  agentReady: boolean;
  detail: string;
  status: VmStatus;
  observedAt: string;
}

export interface CreateVmSpec {
  templateId: string;
  name: string;
  region: string;
  size: string;
  image: string;
  workspaceId: string;
  workspaceName: string;
  labId: string;
  labName: string;
  userId: string;
  userName: string;
  sessionId: string | null;
  durationMinutes: number;
}

/**
 * Cloud provider abstraction. AzureProvider is the only implementation today;
 * AWSProvider / GCPProvider slot in behind the same contract.
 */
export interface CloudProvider {
  readonly name: CloudProviderName;
  createVM(spec: CreateVmSpec): Promise<VmRecord>;
  startVM(vmId: string): Promise<VmRecord>;
  stopVM(vmId: string): Promise<VmRecord>;
  getVMStatus(vmId: string): Promise<VmStatus>;
  getVM(vmId: string): Promise<VmRecord | null>;
  checkVMReadiness(vmId: string): Promise<{ ready: boolean; detail: string }>;
  /** Runtime/instance view straight from the provider, normalised. */
  getVMInstanceView(vmId: string): Promise<VmInstanceView>;
  deleteVM(vmId: string): Promise<{ deleted: boolean }>;
  /** Rehydrate a VM the provider has no record of (stateless worker restart). */
  adopt(record: VmRecord): Promise<VmRecord>;
}