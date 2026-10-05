/** Slug helpers shared by the admin console and the server-side repositories. */

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Deterministic workspace slug: "<org-prefix>-<workspace name without the org>".
 * "Azure AI Training - ABC Corp" @ "ABC Corp" -> "abc-azure-ai-training".
 */
export function workspaceSlugFor(org: string, name: string) {
  const orgTokens = slugify(org).split("-").filter(Boolean);
  const prefix = orgTokens[0] ?? "";
  const nameTokens = slugify(name)
    .split("-")
    .filter((token) => token && !orgTokens.includes(token));
  const combined = [prefix, ...nameTokens].filter(Boolean).join("-");
  return combined || slugify(name) || "workspace";
}

/** Ensures a slug is unique across the catalogue by appending a numeric suffix. */
export function uniqueSlug(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export const WORKSPACE_URL_BASE = "https://labs.skilltracklabs.com/workspace";
export const SESSION_URL_BASE = "https://labs.skilltracklabs.com/session";
