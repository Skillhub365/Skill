# Architecture

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| UI | `src/routes/*.tsx`, `src/components/**` | Admin console and learner experience |
| API | `src/routes/api/**` | Server routes; every privileged operation |
| Security | `src/lib/security/**` | Identity, authorization chain, secrets, Key Vault |
| Data | `src/lib/db/*.repo.server.ts` | Supabase repositories, no business logic in routes |
| Cloud | `src/lib/cloud/**`, `src/lib/vm/**` | Connections, controller, providers, pool, reaper |
| Gateway | `src/lib/remote-desktop/**` | Guacamole brokering, simulated desktop |
| Realtime | `src/lib/realtime/**` | Server event bus + SSE to the browser |

## Request and auth flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant R as Server route
  participant G as authorize()
  participant DB as Supabase
  B->>R: fetch /api/... (bearer token)
  R->>G: authorize(request, {labId?, role?})
  G->>DB: verify token, load profile + roles + tenant
  G->>DB: workspace membership / lab assignment
  alt denied
    G-->>B: 401 / 403 with a safe error code
  else allowed
    G-->>R: principal + capabilities
    R->>DB: repository calls under the principal
    R-->>B: JSON (no-store)
  end
```

## Tenant isolation

```mermaid
flowchart TD
  T[Tenant] --> W[Workspace]
  W --> L[Lab]
  W --> U[Workspace user]
  L --> A[Lab assignment]
  A --> S[Session]
  S --> V[VM record]
  S --> GC[Gateway connection]
```

Every hop is re-checked server-side; a client-supplied id can only narrow access,
never widen it. RLS enforces the same boundary at the database.

## Deployment topology

```mermaid
flowchart LR
  subgraph Public
    B[Browser]
  end
  subgraph App
    APP[TanStack Start server]
  end
  subgraph Data
    SB[(Supabase Postgres)]
  end
  subgraph AzureVNet[Azure lab VNet]
    NG[NGINX 443] --> GW[Guacamole web app] --> GD[guacd] --> VM[Lab VMs, private only]
  end
  B --> APP --> SB
  APP --> GW
  B -->|WSS 443| NG
  APP --> ARM[Azure Resource Manager]
  APP --> KV[Key Vault]
```
