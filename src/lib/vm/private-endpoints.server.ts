/**
 * Server-only registry of private VM endpoints (RDP addresses inside the
 * Azure VNet).
 *
 * These values must never reach the browser. They are persisted on
 * `vm_records.private_ip` so any worker can broker a tunnel for a machine it
 * did not start; the in-process map is only a read cache in front of it.
 */

import { db } from "@/lib/db/client.server";

let cache: Map<string, string> | null = null;
function store() {
  if (!cache) cache = new Map<string, string>();
  return cache;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function writeThrough(vmId: string, ip: string | null) {
  if (!UUID.test(vmId)) return; // ephemeral/simulated machine, no durable row
  try {
    const supabase = await db();
    await supabase.from("vm_records").update({ private_ip: ip } as never).eq("id", vmId);
  } catch (error) {
    console.error("[endpoints] persist failed", (error as Error)?.message);
  }
}

export function rememberPrivateIp(vmId: string, ip: string | null) {
  if (!ip) return;
  store().set(vmId, ip);
  void writeThrough(vmId, ip);
}

/** Cached lookup. Prefer `resolvePrivateIp` on a cold worker. */
export function privateIpFor(vmId: string): string | null {
  return store().get(vmId) ?? null;
}

/** Durable resolution used by the gateway when the cache is cold. */
export async function resolvePrivateIp(vmId: string): Promise<string | null> {
  const cached = store().get(vmId);
  if (cached) return cached;
  if (!UUID.test(vmId)) return null;
  try {
    const supabase = await db();
    const { data } = await supabase.from("vm_records").select("private_ip").eq("id", vmId).maybeSingle();
    const ip = (data?.private_ip as string | null) ?? null;
    if (ip) store().set(vmId, ip);
    return ip;
  } catch {
    return null;
  }
}

/** Called on release/delete so a reclaimed machine keeps no stale address. */
export function forgetPrivateIp(vmId: string) {
  store().delete(vmId);
  void writeThrough(vmId, null);
}
