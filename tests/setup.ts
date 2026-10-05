import { beforeEach } from "vitest";
import { applyTestEnv } from "./utils/env";

/**
 * Global test setup.
 *
 * Every test process starts from a known, *fake* environment: no real Azure,
 * Guacamole, Key Vault or production Supabase credentials are ever read, and
 * nothing here is printed, so a CI log can never leak a value.
 */
applyTestEnv();

beforeEach(() => {
  applyTestEnv();
});