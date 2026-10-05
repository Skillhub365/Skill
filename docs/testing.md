# Testing

See also [phase-6-testing.md](phase-6-testing.md) for the original design notes.

| Suite | Command | Covers |
| --- | --- | --- |
| Unit | `npm run test:unit` | authorization chain, launch resolution, session lifecycle, VM pool concurrency |
| Integration | `npm run test:integration` | session API routes end to end against in-memory doubles |
| E2E | `npm run test:e2e` | Playwright smoke journey |
| Everything | `npm run ci` | lint → typecheck → test → build |

Tests never reach real Azure, Guacamole, Key Vault or a production database:
`tests/utils/` provides `fake-supabase`, `mock-azure`, `mock-guacamole`, `fake-bus`
and a deterministic clock. CI (`.github/workflows/ci.yml`) pins
`CLOUD_MODE=mock`, `REMOTE_DESKTOP_MODE=simulated` and placeholder Supabase values.

Gaps: no coverage thresholds enforced, no authenticated E2E journey
(launch → connect → expire), no staging contract tests against real providers.
