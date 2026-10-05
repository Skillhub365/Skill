# Production cutover and mock containment

SkillTrack Labs ships with mock Azure, a simulated desktop, and a sample cloud
connection so the product can be developed without a subscription. Those paths
are development-only. In staging and production they are blocked unless an
operator deliberately enables the emergency flag.

## How the platform decides

`SKILLTRACK_ENV` (or the inferred environment) selects the posture:

| Environment | Mock Azure | Simulated desktop | Sample connection |
| --- | --- | --- | --- |
| development | allowed | allowed | allowed |
| staging / production | blocked | blocked | blocked |
| staging / production with `ALLOW_MOCK_FALLBACK=true` | allowed, banner shown | allowed, banner shown | allowed, banner shown |

When a required integration is missing in a live environment the request fails
with a clear error instead of silently simulating a machine or a desktop.

## Cutover checklist

Open **Admin → Operations → Production readiness**. Every required row must be
green before go-live:

1. Authentication and signing key configured.
2. Database reachable.
3. Realtime credentials present (consoles subscribe instead of polling).
4. Key Vault configured and reachable.
5. At least one healthy Azure cloud connection.
6. Event Grid configured and delivering (last event under 24 hours old).
7. Guacamole gateway configured, reachable, and accepting authentication.
8. Real VMs registered in the pool with available capacity.
9. A successful Super Admin "Test RDP" recorded.
10. Session reaper enabled with a recent clean run.
11. Emergency mock fallback OFF and no mock machines registered.

The same report is available to administrators at `GET /api/admin/readiness`
for external monitoring. It never contains secrets — only posture and
plain-language detail.

## Smoke test after cutover

1. Sign in as a Super Admin; confirm no degraded banner appears.
2. Start a machine from the VM pool and confirm it reaches `RUNNING` in Azure.
3. Run **Test RDP** on that machine; confirm it passes and cleans up.
4. Sign in as a learner, launch an assigned lab, and confirm a real desktop
   opens (the simulated desktop shows a development watermark).
5. Stop the session; confirm the machine deallocates and usage is recorded.
6. Open **Admin → Usage reports** and confirm the session appears.

## Enabling and disabling emergency fallback

Only enable fallback during an incident where the gateway or Azure is
unavailable and a demo must continue:

```
ALLOW_MOCK_FALLBACK=true
```

While it is on:

- Administrators see a persistent red banner on every page.
- A `PRODUCTION_FALLBACK_ACTIVE` security event is written whenever the
  readiness report is fetched.
- The readiness report reports **Not ready**.

To roll back, remove the variable from the deployment configuration and
redeploy. Re-check the readiness panel and confirm the banner is gone before
telling users the platform is real again.

## If a required check fails

- **Database / Key Vault** — verify credentials and network access; the app
  refuses to start with local fallbacks in a live environment.
- **Azure** — re-validate the cloud connection from Admin → Cloud connections;
  rotate the service-principal secret if authentication fails.
- **Event Grid** — re-run the reconciliation from the connection console; state
  stays correct through reconciliation while events are down.
- **Guacamole** — see `docs/runbooks/` for gateway recovery; learners see an
  explicit "desktop unavailable" message rather than a simulation.
- **VM pool** — register real machines; the sample connection is rejected.
