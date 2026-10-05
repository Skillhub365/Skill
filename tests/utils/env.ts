/**
 * Safe environment variables for tests.
 *
 * All values here are obviously fake. Nothing in the suite may read a real
 * secret, and no value is ever logged.
 */

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  SKILLTRACK_ENV: "development",
  SUPABASE_URL: "https://test.supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_only",
  SESSION_SIGNING_KEY: "test-signing-key-not-a-real-secret",
  MAX_CONCURRENT_SESSIONS_PER_USER: "1",
  MAX_SESSION_MINUTES: "480",
};

/** Environment variables that must never be present while tests run. */
const FORBIDDEN = [
  "AZURE_CLIENT_SECRET",
  "AZURE_KEY_VAULT_URI",
  "GUACAMOLE_URL",
  "GUACAMOLE_ADMIN_PASSWORD",
  "LAB_VM_PASSWORD",
];

export function applyTestEnv(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ ...TEST_ENV, ...overrides })) {
    process.env[key] = value;
  }
  for (const key of FORBIDDEN) {
    if (!(key in overrides)) delete process.env[key];
  }
}

/** Temporarily set env vars for one assertion, then restore the previous values. */
export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}