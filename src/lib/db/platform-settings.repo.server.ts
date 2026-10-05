import { db } from "./client.server";

/**
 * Small durable key/value store for server-owned platform state that is not
 * a domain entity — for example the last remote-desktop gateway verification.
 * The table is service-role only, so nothing here is browser reachable.
 */
export async function readSetting<T>(key: string): Promise<T | null> {
  try {
    const supabase = await db();
    const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    return ((data as { value?: T } | null)?.value ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function writeSetting<T>(key: string, value: T): Promise<void> {
  try {
    const supabase = await db();
    await supabase
      .from("platform_settings")
      .upsert({ key, value: value as never, updated_at: new Date().toISOString() } as never, { onConflict: "key" });
  } catch (error) {
    console.error("[platform-settings] write failed", (error as Error)?.message);
  }
}
