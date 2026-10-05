/**
 * Secret storage for cloud-connection credentials.
 *
 * The registry/database only ever holds a reference such as
 *   keyvault://skilltrack/azure/conn-a1b2c3-secret
 * The value itself lives in Azure Key Vault when the platform is deployed with
 * a vault URI, and in an AES-GCM encrypted in-process cache otherwise (dev).
 * Values are never logged, never returned by an API and never sent to a browser.
 *
 * Key Vault access goes through the shared client in
 * `@/lib/security/azure-vault.server`, so connection secrets and platform
 * secrets use exactly one authentication strategy and one cache policy.
 */

import {
  deleteVaultSecret,
  getVaultSecret,
  KeyVaultError,
  setVaultSecret,
  vaultConfigured,
} from "@/lib/security/azure-vault.server";
import { signingKey } from "@/lib/security/secrets.server";

export class SecretVaultError extends Error {}

export function vaultKind(): "azure-key-vault" | "encrypted-local" {
  return vaultConfigured() ? "azure-key-vault" : "encrypted-local";
}

/* ---------------------------------------------------------------- local ---- */

const encrypted = new Map<string, string>();

async function localKey(): Promise<CryptoKey> {
  const material = new TextEncoder().encode(await signingKey());
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function localPut(name: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await localKey(), new TextEncoder().encode(value)),
  );
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv);
  packed.set(cipher, iv.length);
  encrypted.set(name, btoa(String.fromCharCode(...packed)));
}

async function localGet(name: string): Promise<string | null> {
  const packedB64 = encrypted.get(name);
  if (!packedB64) return null;
  const packed = Uint8Array.from(atob(packedB64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(0, 12) },
    await localKey(),
    packed.slice(12),
  );
  return new TextDecoder().decode(plain);
}

/* ----------------------------------------------------------------- api ----- */

function secretName(connectionId: string) {
  return `${connectionId}-secret`;
}

export function secretReferenceFor(connectionId: string) {
  return `keyvault://skilltrack/azure/${secretName(connectionId)}`;
}

/** Rotation metadata, kept next to the reference by the registry. */
export interface SecretWriteResult {
  reference: string;
  storedIn: "azure-key-vault" | "encrypted-local";
  version: string | null;
  rotatedAt: string;
}

/**
 * Store (or rotate) a connection secret and return its reference. Errors are
 * surfaced as SecretVaultError with a status only, so an admin sees a safe
 * message and the value never reaches a log.
 */
export async function putConnectionSecret(connectionId: string, secret: string): Promise<string> {
  return (await writeConnectionSecret(connectionId, secret)).reference;
}

export async function writeConnectionSecret(connectionId: string, secret: string): Promise<SecretWriteResult> {
  const name = secretName(connectionId);
  if (!vaultConfigured()) {
    await localPut(name, secret);
    return {
      reference: secretReferenceFor(connectionId),
      storedIn: "encrypted-local",
      version: null,
      rotatedAt: new Date().toISOString(),
    };
  }
  try {
    const { version, rotatedAt } = await setVaultSecret(name, secret);
    return { reference: secretReferenceFor(connectionId), storedIn: "azure-key-vault", version, rotatedAt };
  } catch (error) {
    const status = error instanceof KeyVaultError ? error.status : undefined;
    console.error(`[secret-vault] write failed for ${name}${status ? ` [${status}]` : ""}`);
    throw new SecretVaultError(
      status === 403
        ? "Key Vault denied the write. Grant the platform identity the Key Vault Secrets Officer role."
        : "The credential could not be stored in Key Vault. Check the vault configuration and try again.",
    );
  }
}

/** Resolve a `keyvault://` reference back to the secret, server-side only. */
export async function resolveSecret(reference: string): Promise<string | null> {
  const name = reference.split("/").pop();
  if (!name) return null;
  return readPlatformSecret(name);
}

/**
 * Generic platform secret storage, used for values that are not tied to one
 * cloud connection (for example the lab image administrator credentials).
 * Same policy as connection secrets: Key Vault when configured, AES-GCM in
 * process otherwise, never logged and never returned to a browser.
 */
export async function writePlatformSecret(name: string, value: string): Promise<SecretWriteResult> {
  if (!vaultConfigured()) {
    await localPut(name, value);
    return {
      reference: `keyvault://skilltrack/platform/${name}`,
      storedIn: "encrypted-local",
      version: null,
      rotatedAt: new Date().toISOString(),
    };
  }
  try {
    const { version, rotatedAt } = await setVaultSecret(name, value);
    return { reference: `keyvault://skilltrack/platform/${name}`, storedIn: "azure-key-vault", version, rotatedAt };
  } catch (error) {
    const status = error instanceof KeyVaultError ? error.status : undefined;
    console.error(`[secret-vault] platform write failed for ${name}${status ? ` [${status}]` : ""}`);
    throw new SecretVaultError(
      status === 403
        ? "Key Vault denied the write. Grant the platform identity the Key Vault Secrets Officer role."
        : "The value could not be stored in Key Vault. Check the vault configuration and try again.",
    );
  }
}

export async function readPlatformSecret(name: string): Promise<string | null> {
  if (!vaultConfigured()) return localGet(name);
  try {
    return await getVaultSecret(name);
  } catch (error) {
    const status = error instanceof KeyVaultError ? error.status : undefined;
    console.error(`[secret-vault] read failed for ${name}${status ? ` [${status}]` : ""}`);
    return null;
  }
}

/**
 * Remove a connection credential. In Key Vault the secret is disabled before
 * it is deleted, so the credential stops working even when a purge-protection
 * policy blocks the delete.
 */
export async function deleteConnectionSecret(connectionId: string): Promise<void> {
  const name = secretName(connectionId);
  if (!vaultConfigured()) {
    encrypted.delete(name);
    return;
  }
  try {
    await deleteVaultSecret(name);
  } catch (error) {
    console.error(`[secret-vault] delete failed for ${name}`, (error as Error)?.name);
  }
}
