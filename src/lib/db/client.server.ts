/**
 * Single entry point for privileged database access.
 *
 * Repositories import `db()` instead of reaching for the admin client
 * directly, so every server-side query goes through one audited place and the
 * service-role client never leaks into a client-reachable module graph.
 */
export async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
