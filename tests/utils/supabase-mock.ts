/**
 * Wires the fake Supabase client into the server module graph.
 *
 * Every privileged repository resolves the admin client through
 * `@/integrations/supabase/client.server`, so mocking that one module is
 * enough to keep the whole suite off any real database.
 */

import { createFakeSupabase, type FakeSupabase, type Tables } from "./fake-supabase";

/**
 * Held on `globalThis` so the active fake survives `vi.resetModules()`, which
 * tests use to get a clean copy of a stateful server module.
 */
const globalState = globalThis as typeof globalThis & { __fakeSupabase?: { client: FakeSupabase } };
const state = (globalState.__fakeSupabase ??= { client: createFakeSupabase() });

/**
 * The module shape a test file registers with
 * `vi.mock("@/integrations/supabase/client.server", supabaseModuleMock)`.
 */
export function supabaseModuleMock() {
  return {
    get supabaseAdmin() {
      return state.client;
    },
    supabaseServer: () => state.client,
  };
}

export function setFakeSupabase(seed: Tables): FakeSupabase {
  state.client = createFakeSupabase(seed);
  return state.client;
}

export function fakeSupabase(): FakeSupabase {
  return state.client;
}