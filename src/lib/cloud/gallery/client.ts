/**
 * Browser client for gallery browsing and image template management.
 * Every call goes to SkillTrack — never to Azure.
 */

import { ApiError } from "@/lib/errors";
import { authHeaders } from "@/lib/security/token-store";
import type { SecurityErrorCode } from "@/lib/security/types";
import type { AzureResourceGroup } from "@/lib/cloud/connections/types";
import type {
  ComputeGallery,
  GalleryConnectionOption,
  ImageDefinition,
  ImageTemplate,
  ImageTemplateDraft,
  ImageVersion,
} from "./types";

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { code?: SecurityErrorCode; detail?: string };
  if (!res.ok) throw new ApiError((data.code as SecurityErrorCode) ?? "UNKNOWN", data.detail, res.status);
  return data;
}

function query(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

const gallery = "/api/admin/cloud/gallery";
const templates = "/api/admin/image-templates";

export async function fetchGalleryConnections() {
  return unwrap<{ connections: GalleryConnectionOption[] }>(
    await fetch(`${gallery}?level=connections`, { headers: authHeaders() }),
  );
}

export async function fetchResourceGroups(connectionId: string) {
  return unwrap<{ resourceGroups: AzureResourceGroup[] }>(
    await fetch(`${gallery}?${query({ level: "resource-groups", connectionId })}`, { headers: authHeaders() }),
  );
}

export async function fetchComputeGalleries(connectionId: string, resourceGroup: string) {
  return unwrap<{ galleries: ComputeGallery[] }>(
    await fetch(`${gallery}?${query({ level: "galleries", connectionId, resourceGroup })}`, {
      headers: authHeaders(),
    }),
  );
}

export async function fetchImageDefinitions(connectionId: string, resourceGroup: string, galleryName: string) {
  return unwrap<{ imageDefinitions: ImageDefinition[] }>(
    await fetch(`${gallery}?${query({ level: "image-definitions", connectionId, resourceGroup, gallery: galleryName })}`, {
      headers: authHeaders(),
    }),
  );
}

export async function fetchImageVersions(
  connectionId: string,
  resourceGroup: string,
  galleryName: string,
  imageDefinition: string,
) {
  return unwrap<{ imageVersions: ImageVersion[] }>(
    await fetch(
      `${gallery}?${query({ level: "image-versions", connectionId, resourceGroup, gallery: galleryName, imageDefinition })}`,
      { headers: authHeaders() },
    ),
  );
}

function json(method: string, body?: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

export async function fetchImageTemplates() {
  return unwrap<{ templates: ImageTemplate[] }>(await fetch(templates, { headers: authHeaders() }));
}

export async function importImageTemplate(draft: ImageTemplateDraft) {
  return unwrap<{ template: ImageTemplate }>(await fetch(templates, json("POST", draft)));
}

export async function patchImageTemplate(
  id: string,
  patch: Partial<ImageTemplate> & { assignWorkspaceId?: string; unassignWorkspaceId?: string },
) {
  return unwrap<{ template: ImageTemplate }>(await fetch(`${templates}/${id}`, json("PATCH", patch)));
}

export async function cloneImageTemplate(id: string, name: string) {
  return unwrap<{ template: ImageTemplate }>(await fetch(`${templates}/${id}`, json("POST", { name })));
}

export async function deleteImageTemplate(id: string) {
  return unwrap<{ deleted: boolean }>(await fetch(`${templates}/${id}`, json("DELETE")));
}
