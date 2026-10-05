/**
 * Server-only mapping between a SkillTrack lab machine and its cloud resource.
 *
 * Keeping this out of the VM record means Azure resource IDs and subscription
 * IDs never travel to the browser with ordinary status responses; the admin
 * console reads them through CloudController.getVMDetails(), masked.
 */

export interface CloudResourceMapping {
  workspaceId: string;
  templateId: string;
  labId: string;
  vmId: string;
  azureSubscriptionId: string;
  azureResourceGroup: string;
  azureVmName: string;
  azureResourceId: string;
  azureRegion: string;
}

let mappings: Map<string, CloudResourceMapping> | null = null;
function store() {
  if (!mappings) mappings = new Map<string, CloudResourceMapping>();
  return mappings;
}

export function rememberMapping(mapping: CloudResourceMapping) {
  store().set(mapping.vmId, mapping);
}

export function mappingFor(vmId: string): CloudResourceMapping | null {
  return store().get(vmId) ?? null;
}

export function forgetMapping(vmId: string) {
  store().delete(vmId);
}

/** Find the machine behind an Azure resource ID (Event Grid payloads). */
export function vmIdForAzureResource(resourceId: string): string | null {
  const needle = resourceId.toLowerCase();
  for (const mapping of store().values()) {
    if (mapping.azureResourceId.toLowerCase() === needle) return mapping.vmId;
  }
  return null;
}

function mask(value: string) {
  if (value.length <= 8) return value ? "••••" : "";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/** Admin-visible view: identifiers are partially masked, secrets never shown. */
export function redactMapping(mapping: CloudResourceMapping) {
  return {
    templateId: mapping.templateId,
    azureSubscriptionId: mask(mapping.azureSubscriptionId),
    azureResourceGroup: mapping.azureResourceGroup,
    azureVmName: mapping.azureVmName,
    azureResourceId: mapping.azureResourceId.replace(mapping.azureSubscriptionId, mask(mapping.azureSubscriptionId)),
    azureRegion: mapping.azureRegion,
  };
}