# Lab lifecycle

## Launch sequence

```mermaid
sequenceDiagram
  participant L as Learner
  participant API as POST /api/labs/:labId/start
  participant P as Launch plan
  participant A as Pool allocator
  participant AZ as Azure
  participant S as Session registry
  L->>API: start lab (idempotency key)
  API->>P: resolve tenant→workspace→lab→assignment→template
  API->>API: capacity + quota check, clamp duration
  API->>A: claim a pool VM (atomic)
  API->>S: create session (before further cloud work)
  API->>AZ: start VM
  AZ-->>API: RUNNING → READY (polled)
  API-->>L: sessionId + VM, lifecycle events over SSE
```

A repeated POST with the same idempotency key — or any live session for the same
learner and lab — returns the existing session instead of provisioning again.
A failure part-way through compensates: session failed, VM stopped and released.

## VM state machine

```mermaid
stateDiagram-v2
  [*] --> STOPPED
  STOPPED --> ALLOCATING
  ALLOCATING --> STARTING
  STARTING --> BOOTING
  BOOTING --> RUNNING
  RUNNING --> READY
  READY --> STOPPING
  STOPPING --> STOPPED
  STARTING --> FAILED
  BOOTING --> FAILED
  FAILED --> STOPPED
```

## Session state machine

```mermaid
stateDiagram-v2
  [*] --> REQUESTED
  REQUESTED --> ACTIVE
  ACTIVE --> ACTIVE: extend (bounded by maxExtensionMinutes)
  ACTIVE --> EXPIRED: timer elapsed
  ACTIVE --> STOPPED: learner or admin stops
  REQUESTED --> FAILED
  EXPIRED --> [*]
  STOPPED --> [*]
```

## Teardown order

Gateway connection and ephemeral user → VM stop/deallocate → pool release →
session marked stopped/expired → audit entry. The reaper repeats this for anything
left behind.

## Cleanup / reaper

```mermaid
flowchart TD
  T[Every 30s] --> LEASE{Acquire durable lease?}
  LEASE -- no --> SKIP[Another instance owns this run]
  LEASE -- yes --> E[Expire overdue sessions]
  E --> O[Find orphaned VMs: allocated, no live session]
  O --> D[Stop + deallocate + release]
  D --> R[Record cleanup_runs + activity log]
```
