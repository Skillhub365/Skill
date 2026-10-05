# Runbook: Validate VM capacity (Super Admin)

Audience: Super Admin. Surface: **Cloud → VM Pool** (`/admin/cloud/vm-pool`).
This is the production control surface for pre-created Azure machines.
`/admin/virtual-machines` is a read-mostly view of machines learners are using.

## What the banner tells you

- **Environment** — `development` means power actions on development sample
  machines are simulated. Live environments refuse to operate a sample.
- **Azure connected / not configured** — whether real ARM calls are possible.
- **Remote desktop gateway live / Simulated desktop** — which desktop path a
  learner would get.

Each row also carries a *Backing* badge: **Real Azure**, **Development
sample**, or **Unavailable** (the owning cloud connection has no usable
credentials — re-validate it under Cloud → Cloud Connections).

## Validate one machine end to end

1. Open the row menu → **Start VM**. The status moves to Starting and settles
   on Running once Azure confirms.
2. **Test Azure status** — probes ARM for power state, provisioning state and
   guest-agent health.
3. **Test remote desktop** — runs the redacted checklist: machine in service,
   Azure running, private address resolvable server-side, gateway configured,
   gateway reachable, RDP credentials present, test connection viable. Fix any
   red step before telling learners the lab is ready.
4. **Stop VM** when finished — deallocation stops compute billing.

Nothing in these results contains an address, token or password; all of that
is used and kept server-side.

## Assigning capacity

Row menu → **Assign workspace / learner**. Leave fields empty to keep the
machine in the shared pool. Assignment reserves capacity; it does not start a
session or bill compute. Machines running a session cannot be reassigned —
use **Release session** first.

## Retire vs unregister

- **Retire** — keeps the record and its audit history, but the machine is
  never offered to a learner again. Reversible via **Return to service**,
  which is an explicit operator override (retirement is otherwise terminal).
- **Unregister from SkillTrack** — removes the registration only. The Azure
  virtual machine is left untouched; deleting it is a separate action in Azure.

## Audit

Every action writes to the cloud audit trail, the platform activity feed and
the lifecycle event stream, with the operator, the machine and the outcome.
Review under Admin → Activity, or Cloud → Audit.
