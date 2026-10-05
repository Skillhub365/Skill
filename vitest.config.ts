import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Test runner configuration.
 *
 * Deliberately independent from `vite.config.ts`: tests exercise plain
 * TypeScript modules (server logic, guards, repositories) and must not boot the
 * TanStack Start / Nitro plugin chain.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    testTimeout: 15_000,
    restoreMocks: true,
    clearMocks: true,
    sequence: { concurrent: false },
  },
});