/**
 * Development-only sample Azure Compute Gallery data.
 *
 * Used ONLY for the synthetic mock connection surfaced in development. A real
 * configured cloud connection never falls back to this data.
 */

import type { ComputeGallery, GalleryConnectionOption, ImageDefinition, ImageVersion } from "./types";

export const MOCK_CONNECTION_ID = "mock-azure-training";
const SUB = "00000000-0000-0000-0000-0000000000mk";

export const mockConnection: GalleryConnectionOption = {
  id: MOCK_CONNECTION_ID,
  name: "Azure Sandbox (development)",
  subscriptionId: SUB,
  subscriptionName: "SkillTrack Training",
  tenantId: "11111111-2222-3333-4444-555555555555",
  status: "CONNECTED",
  mock: true,
};

const RG = "rg-skilltrack-training";

function galleryId(gallery: string) {
  return `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Compute/galleries/${gallery}`;
}

export const mockResourceGroups = [
  { name: RG, location: "eastus", provisioningState: "Succeeded" },
  { name: "rg-skilltrack-shared", location: "westeurope", provisioningState: "Succeeded" },
];

export const mockGalleries: ComputeGallery[] = [
  {
    id: galleryId("SkillTrackGallery"),
    name: "SkillTrackGallery",
    location: "eastus",
    description: "Shared training images for SkillTrack Labs",
    resourceGroup: RG,
  },
];

const definitions: Array<Omit<ImageDefinition, "id">> = [
  {
    name: "Windows-AI-Training",
    location: "eastus",
    publisher: "SkillTrack",
    offer: "AI-Training",
    sku: "win11-ai",
    osType: "Windows",
    osState: "Generalized",
    architecture: "x64",
    hyperVGeneration: "V2",
    description: "Windows 11 with Azure AI tooling preinstalled",
  },
  {
    name: "Linux-DevOps",
    location: "eastus",
    publisher: "SkillTrack",
    offer: "DevOps",
    sku: "ubuntu-2404-devops",
    osType: "Linux",
    osState: "Generalized",
    architecture: "x64",
    hyperVGeneration: "V2",
    description: "Ubuntu 24.04 with Docker, Terraform and the Azure CLI",
  },
  {
    name: "Azure-Data-Engineering",
    location: "eastus",
    publisher: "SkillTrack",
    offer: "Data",
    sku: "win2022-data",
    osType: "Windows",
    osState: "Generalized",
    architecture: "x64",
    hyperVGeneration: "V2",
    description: "Windows Server 2022 with Synapse and Fabric tooling",
  },
];

export function mockImageDefinitions(gallery: string): ImageDefinition[] {
  return definitions.map((d) => ({ ...d, id: `${galleryId(gallery)}/images/${d.name}` }));
}

export function mockImageVersions(gallery: string, definition: string): ImageVersion[] {
  return ["1.0.0", "1.0.1", "1.0.2", "1.0.3"].map((version, index) => ({
    id: `${galleryId(gallery)}/images/${definition}/versions/${version}`,
    name: version,
    location: "eastus",
    publishingProfile: {
      publishedDate: new Date(Date.UTC(2026, 2 + index, 12)).toISOString(),
      excludeFromLatest: false,
      replicaCount: 2,
    },
    provisioningState: "Succeeded",
    replicationStatus: "Completed",
    regions: ["eastus", "westeurope"],
  }));
}
