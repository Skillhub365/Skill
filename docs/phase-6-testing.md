# Phase 6 — Automated tests and CI

## Tooling
- **Vitest** (node environment) for unit and integration tests: `tests/unit`, `tests/integration`.
- **Playwright** for end-to-end smoke coverage: `tests/e2e`.
- No test touches Azure, the remote-desktop gateway, Key Vault or a real database. Test doubles live in `tests/utils`.

## Commands
| Command | Purpose |
| --- | --- |
| `npm test` | Unit + integration suites |
| `npm run test:watch` | Watch mode |
| `npm run test:e2e` | Playwright smoke (starts a dev server unless `E2E_BASE_URL` is set) |
| `npm run ci` | lint → typecheck → tests → build |

## What is covered
- **Authorization chain** — identity resolution from durable records, role and capability matrix, cross-tenant refusal, archived workspaces, unpublished labs, session and VM ownership.
- **Launch resolution** — tenant, workspace, assignment, template and cloud-binding checks; capacity limits and duration clamping.
- **Session lifecycle** — creation, idempotent relaunch, clock-driven expiry, ordered teardown (gateway → VM → session).
- **VM pool** — atomic allocation, no double-hand-out under concurrency, exhaustion, release and lease behaviour.
- **Session APIs** — real route handlers: anonymous and expired tokens refused, cross-learner access refused, no credential or private IP in any response.
- **E2E smoke** — landing and sign-in render, protected routes redirect, APIs answer 401 anonymously.

## Test doubles
- `fake-supabase.ts` — in-memory query builder incl. embedded selects and the `allocate_pool_vm` RPC.
- `mock-azure.ts`, `mock-guacamole.ts`, `fake-bus.ts`, `clock.ts` — deterministic providers and time.
- `fixtures.ts` — two tenants with learners, admins, a super admin, workspaces, labs and templates.

## CI
`.github/workflows/ci.yml` runs lint, typecheck, tests and build on every push and pull request, then the Playwright smoke job with mock providers (`CLOUD_MODE=mock`, `REMOTE_DESKTOP_MODE=simulated`).
