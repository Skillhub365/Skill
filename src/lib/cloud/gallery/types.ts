/**
 * Azure Compute Gallery browsing + SkillTrack image template model.
 *
 * SkillTrack never copies an image. It stores Azure resource references
 * (gallery -> image definition -> image version) and resolves them at
 * provisioning time through the owning cloud connection.
 */

export interface GalleryConnectionOption {
  id: string;
  name: string;
  subscriptionId: string;
  subscriptionName: string | null;
  tenantId: string;
  status: string;
  /** True for the development-only sample provider. */
  mock: boolean;
}

export interface ComputeGallery {
  id: string;
  name: string;
  location: string;
  description: string | null;
  resourceGroup: string;
}

export interface ImageDefinition {
  id: string;
  name: string;
  location: string;
  publisher: string;
  offer: string;
  sku: string;
  osType: "Windows" | "Linux" | string;
  osState: "Generalized" | "Specialized" | string;
  architecture: string;
  hyperVGeneration: string | null;
  description: string | null;
}

export interface ImageVersion {
  id: string;
  name: string;
  location: string;
  publishingProfile: {
    publishedDate: string | null;
    excludeFromLatest: boolean;
    replicaCount: number | null;
  };
  provisioningState: string;
  replicationStatus: string;
  regions: string[];
}

export type ImageTemplateStatus = "active" | "disabled";
export type ImageVersionPolicy = "pinned" | "latest";

/** The SkillTrack VM_TEMPLATE record produced by an import. */
export interface ImageTemplate {
  id: string;
  name: string;
  description: string;
  provider: "azure";
  cloudConnectionId: string;
  cloudConnectionName: string;
  tenantId: string;
  subscriptionId: string;
  subscriptionName: string | null;
  resourceGroupName: string;
  galleryName: string;
  galleryResourceId: string;
  imageDefinitionName: string;
  imageDefinitionResourceId: string;
  imageVersion: string;
  imageVersionResourceId: string;
  versionPolicy: ImageVersionPolicy;
  osType: string;
  osState: string;
  architecture: string;
  region: string;
  vmSize: string;
  defaultSessionDuration: number;
  maximumSessionDuration: number;
  autoShutdownEnabled: boolean;
  status: ImageTemplateStatus;
  /** Workspaces this template has been assigned to. */
  workspaceIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageTemplateDraft {
  name: string;
  description?: string;
  cloudConnectionId: string;
  resourceGroupName: string;
  galleryName: string;
  imageDefinitionName: string;
  imageVersion: string;
  versionPolicy: ImageVersionPolicy;
  region: string;
  vmSize: string;
  defaultSessionDuration: number;
  maximumSessionDuration: number;
  autoShutdownEnabled: boolean;
  status: ImageTemplateStatus;
}

export const IMPORT_STEP_LABEL = [
  "Azure connection",
  "Resource group",
  "Compute gallery",
  "Image definition",
  "Image version",
  "Template configuration",
  "Review",
] as const;
