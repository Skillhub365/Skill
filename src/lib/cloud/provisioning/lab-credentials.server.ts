/**
 * Windows administrator credentials baked into the lab images.
 *
 * Stored in Key Vault (or the AES-GCM local store in development) under fixed
 * names, and mirrored into the process environment so every existing reader
 * (`runtime.server.ts`, the Azure provider, the Guacamole broker) picks them up
 * without a restart. The password is never returned by any API.
 */

import { readPlatformSecret, writePlatformSecret } from "@/lib/cloud/connections/secret-vault.server";

const USERNAME_SECRET = "lab-vm-username";
const PASSWORD_SECRET = "lab-vm-password";

export interface LabCredentialStatus {
  configured: boolean;
  username: string | null;
  storedIn: "azure-key-vault" | "encrypted-local" | "environment" | null;
}

/** Push the stored values into process.env so existing config readers see them. */
function applyToEnv(username: string, password: string) {
  process.env["LAB_VM_USERNAME"] = username;
  process.env["LAB_VM_PASSWORD"] = password;
}

export async function saveLabCredentials(
  username: string,
  password: string,
): Promise<{ storedIn: "azure-key-vault" | "encrypted-local" }> {
  const write = await writePlatformSecret(USERNAME_SECRET, username);
  await writePlatformSecret(PASSWORD_SECRET, password);
  applyToEnv(username, password);
  return { storedIn: write.storedIn };
}

/**
 * Load the credentials from the vault into the environment. Safe to call on
 * every request: environment values configured at deploy time always win, so a
 * platform operator can override the console.
 */
export async function hydrateLabCredentials(): Promise<LabCredentialStatus> {
  const envUser = process.env["LAB_VM_USERNAME"]?.trim();
  const envPass = process.env["LAB_VM_PASSWORD"]?.trim();
  if (envUser && envPass) return { configured: true, username: envUser, storedIn: "environment" };

  const username = (await readPlatformSecret(USERNAME_SECRET))?.trim() ?? null;
  const password = (await readPlatformSecret(PASSWORD_SECRET))?.trim() ?? null;
  if (!username || !password) return { configured: false, username: username ?? null, storedIn: null };
  applyToEnv(username, password);
  const { vaultKind } = await import("@/lib/cloud/connections/secret-vault.server");
  return { configured: true, username, storedIn: vaultKind() };
}
