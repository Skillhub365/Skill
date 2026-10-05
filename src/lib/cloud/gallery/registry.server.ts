/**
 * Server-side registry of imported SkillTrack VM templates.
 *
 * Only Azure resource references are stored — never image binaries and never
 * credentials. Each record keeps its owning `cloudConnectionId`, so multiple
 * subscriptions, tenants and galleries coexist without ambiguity.
 */

import { galleryConnection } from "./provider.server";
import {
  getImageVersion,
  getLatestImageVersion,
  listComputeGalleries,
  listImageDefinitions,
} from "./provider.server";
import type { ImageTemplate, ImageTemplateDraft } from "./types";

const templates = new Map<string, ImageTemplate>();

export function listImageTemplates(): ImageTemplate[] {
  return [...templates.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getImageTemplate(id: string): ImageTemplate | null {
  return templates.get(id) ?? null;
}

export class ImportError extends Error {}

/**
 * Resolve every Azure reference for a draft and persist the template record.
 * The image itself stays in the customer's Azure Compute Gallery.
 */
export async function importImageTemplate(draft: ImageTemplateDraft, createdBy: string): Promise<ImageTemplate> {
  const option = galleryConnection(draft.cloudConnectionId);
  if (!option) throw new ImportError("The selected Azure connection is no longer available.");

  const gallery = (await listComputeGalleries(draft.cloudConnectionId, draft.resourceGroupName)).find(
    (g) => g.name === draft.galleryName,
  );
  if (!gallery) throw new ImportError("Compute gallery not found in this subscription.");

  const definition = (
    await listImageDefinitions(draft.cloudConnectionId, draft.resourceGroupName, draft.galleryName)
  ).find((d) => d.name === draft.imageDefinitionName);
  if (!definition) throw new ImportError("Image definition not found in this gallery.");

  const version =
    draft.versionPolicy === "latest"
      ? await getLatestImageVersion(
          draft.cloudConnectionId,
          draft.resourceGroupName,
          draft.galleryName,
          draft.imageDefinitionName,
        )
      : await getImageVersion(
          draft.cloudConnectionId,
          draft.resourceGroupName,
          draft.galleryName,
          draft.imageDefinitionName,
          draft.imageVersion,
        );
  if (!version) throw new ImportError("Image version not found for this image definition.");

  const now = new Date().toISOString();
  const record: ImageTemplate = {
    id: `imgtpl-${crypto.randomUUID().slice(0, 8)}`,
    name: draft.name.trim(),
    description: draft.description?.trim() ?? "",
    provider: "azure",
    cloudConnectionId: option.id,
    cloudConnectionName: option.name,
    tenantId: option.tenantId,
    subscriptionId: option.subscriptionId,
    subscriptionName: option.subscriptionName,
    resourceGroupName: draft.resourceGroupName,
    galleryName: gallery.name,
    galleryResourceId: gallery.id,
    imageDefinitionName: definition.name,
    imageDefinitionResourceId: definition.id,
    imageVersion: version.name,
    imageVersionResourceId: version.id,
    versionPolicy: draft.versionPolicy,
    osType: definition.osType,
    osState: definition.osState,
    architecture: definition.architecture,
    region: draft.region || gallery.location,
    vmSize: draft.vmSize,
    defaultSessionDuration: draft.defaultSessionDuration,
    maximumSessionDuration: draft.maximumSessionDuration,
    autoShutdownEnabled: draft.autoShutdownEnabled,
    status: draft.status,
    workspaceIds: [],
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  templates.set(record.id, record);
  return record;
}

export function updateImageTemplate(id: string, patch: Partial<ImageTemplate>): ImageTemplate | null {
  const record = templates.get(id);
  if (!record) return null;
  const next: ImageTemplate = {
    ...record,
    ...patch,
    id: record.id,
    cloudConnectionId: record.cloudConnectionId,
    galleryResourceId: record.galleryResourceId,
    imageDefinitionResourceId: record.imageDefinitionResourceId,
    imageVersionResourceId: patch.imageVersionResourceId ?? record.imageVersionResourceId,
    updatedAt: new Date().toISOString(),
  };
  templates.set(id, next);
  return next;
}

/** Clone keeps the same Azure references under a new template identity. */
export function cloneImageTemplate(id: string, name: string, createdBy: string): ImageTemplate | null {
  const record = templates.get(id);
  if (!record) return null;
  const now = new Date().toISOString();
  const copy: ImageTemplate = {
    ...record,
    id: `imgtpl-${crypto.randomUUID().slice(0, 8)}`,
    name,
    workspaceIds: [],
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  templates.set(copy.id, copy);
  return copy;
}

export function deleteImageTemplate(id: string): boolean {
  return templates.delete(id);
}

export function assignTemplateToWorkspace(id: string, workspaceId: string): ImageTemplate | null {
  const record = templates.get(id);
  if (!record) return null;
  if (record.workspaceIds.includes(workspaceId)) return record;
  return updateImageTemplate(id, { workspaceIds: [...record.workspaceIds, workspaceId] });
}

export function unassignTemplateFromWorkspace(id: string, workspaceId: string): ImageTemplate | null {
  const record = templates.get(id);
  if (!record) return null;
  return updateImageTemplate(id, { workspaceIds: record.workspaceIds.filter((w) => w !== workspaceId) });
}
