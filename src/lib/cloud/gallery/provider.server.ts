/**
 * Gallery browsing service.
 *
 *   Admin browser -> SkillTrack backend -> Cloud Controller -> Azure Provider
 *   -> Azure Resource Manager -> Azure Compute Gallery
 *
 * Real cloud connections always perform live ARM calls; failures surface as
 * errors and are never replaced by sample data. The mock provider exists only
 * for the synthetic development connection.
 */

import {
  AzureConnectionError,
  getImageVersion as armGetImageVersion,
  listComputeGalleries as armGalleries,
  listImageDefinitions as armDefinitions,
  listImageVersions as armVersions,
} from "@/lib/cloud/connections/azure-arm.server";
import { armClientFor, getConnection, listConnections } from "@/lib/cloud/connections/registry.server";
import { deploymentEnvironment } from "@/lib/infra/runtime.server";
import type { AzureResourceGroup } from "@/lib/cloud/connections/types";
import {
  MOCK_CONNECTION_ID,
  mockConnection,
  mockGalleries,
  mockImageDefinitions,
  mockImageVersions,
  mockResourceGroups,
} from "./mock.server";
import type { ComputeGallery, GalleryConnectionOption, ImageDefinition, ImageVersion } from "./types";

function isMock(connectionId: string) {
  return connectionId === MOCK_CONNECTION_ID;
}

export function galleryConnections(): GalleryConnectionOption[] {
  const real = listConnections().map<GalleryConnectionOption>((c) => ({
    id: c.id,
    name: c.name,
    subscriptionId: c.subscriptionId,
    subscriptionName: c.subscriptionName,
    tenantId: c.tenantId,
    status: c.status,
    mock: false,
  }));
  // The sample connection only appears in development, and only while no real
  // Azure subscription is configured.
  if (real.length === 0 && deploymentEnvironment() === "development") return [mockConnection];
  return real;
}

export function galleryConnection(connectionId: string): GalleryConnectionOption | null {
  return galleryConnections().find((c) => c.id === connectionId) ?? null;
}

async function client(connectionId: string) {
  const connection = getConnection(connectionId);
  if (!connection) throw new AzureConnectionError("AUTHENTICATION_ERROR", "Cloud connection not found.");
  const arm = await armClientFor(connectionId);
  if (!arm) throw new AzureConnectionError("AUTHENTICATION_ERROR", "Connection credentials are unavailable.");
  return { arm, connection };
}

export async function listResourceGroups(connectionId: string): Promise<AzureResourceGroup[]> {
  if (isMock(connectionId)) return mockResourceGroups;
  const { arm } = await client(connectionId);
  return arm.listResourceGroups();
}

export async function listComputeGalleries(connectionId: string, resourceGroup: string): Promise<ComputeGallery[]> {
  if (isMock(connectionId)) return mockGalleries;
  const { arm } = await client(connectionId);
  const galleries = await armGalleries(arm, resourceGroup);
  return galleries.map((g) => ({
    id: g.id,
    name: g.name,
    location: g.location,
    description: g.properties?.description ?? null,
    resourceGroup,
  }));
}

export async function listImageDefinitions(
  connectionId: string,
  resourceGroup: string,
  gallery: string,
): Promise<ImageDefinition[]> {
  if (isMock(connectionId)) return mockImageDefinitions(gallery);
  const { arm } = await client(connectionId);
  const defs = await armDefinitions(arm, resourceGroup, gallery);
  return defs.map((d) => ({
    id: d.id,
    name: d.name,
    location: d.location,
    publisher: d.properties?.identifier?.publisher ?? "—",
    offer: d.properties?.identifier?.offer ?? "—",
    sku: d.properties?.identifier?.sku ?? "—",
    osType: d.properties?.osType ?? "—",
    osState: d.properties?.osState ?? "—",
    architecture: d.properties?.architecture ?? "x64",
    hyperVGeneration: d.properties?.hyperVGeneration ?? null,
    description: d.properties?.description ?? null,
  }));
}

export async function listImageVersions(
  connectionId: string,
  resourceGroup: string,
  gallery: string,
  definition: string,
): Promise<ImageVersion[]> {
  if (isMock(connectionId)) return mockImageVersions(gallery, definition);
  const { arm } = await client(connectionId);
  const versions = await armVersions(arm, resourceGroup, gallery, definition);
  return versions.map((v) => ({
    id: v.id,
    name: v.name,
    location: v.location,
    publishingProfile: {
      publishedDate: v.properties?.publishingProfile?.publishedDate ?? null,
      excludeFromLatest: Boolean(v.properties?.publishingProfile?.excludeFromLatest),
      replicaCount: v.properties?.publishingProfile?.replicaCount ?? null,
    },
    provisioningState: v.properties?.provisioningState ?? "Unknown",
    replicationStatus: v.properties?.replicationStatus?.aggregatedState ?? "Unknown",
    regions: (v.properties?.publishingProfile?.targetRegions ?? []).map((r) => r.name),
  }));
}

export async function getImageVersion(
  connectionId: string,
  resourceGroup: string,
  gallery: string,
  definition: string,
  version: string,
): Promise<ImageVersion | null> {
  if (isMock(connectionId)) {
    return mockImageVersions(gallery, definition).find((v) => v.name === version) ?? null;
  }
  const { arm } = await client(connectionId);
  const found = await armGetImageVersion(arm, resourceGroup, gallery, definition, version);
  if (!found) return null;
  const [mapped] = (await listImageVersions(connectionId, resourceGroup, gallery, definition)).filter(
    (v) => v.name === found.name,
  );
  return mapped ?? null;
}

/** Newest published version that is not excluded from "latest". */
export async function getLatestImageVersion(
  connectionId: string,
  resourceGroup: string,
  gallery: string,
  definition: string,
): Promise<ImageVersion | null> {
  const versions = (await listImageVersions(connectionId, resourceGroup, gallery, definition)).filter(
    (v) => !v.publishingProfile.excludeFromLatest,
  );
  return versions.sort((a, b) => compareVersion(a.name, b.name)).at(-1) ?? null;
}

function compareVersion(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
