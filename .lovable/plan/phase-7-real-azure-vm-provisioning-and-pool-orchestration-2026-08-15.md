# Phase 7 — Real Azure VM Provisioning and Pool Orchestration

Turn the existing Azure connection + gallery template work into a real VM pool: Super Admin registers actual Azure VMs discovered from the subscription, learners get one allocated exclusively when they start a lab, and SkillTrack drives the real ARM start/stop/status calls end to end.

## What gets built

### 1. VM pool (registered Azure machines)
A server-side pool registry holding one record per registered Azure VM: name, workspace, template, cloud connection, subscription, resource group, Azure resource ID, region, size, image version, pool status, assigned user and current session.

Pool states: `AVAILABLE → ALLOCATED → STARTING → RUNNING → READY → IN_USE → STOPPING → STOPPED → AVAILABLE`, plus `ERROR`.

### 2. Register Azure VM wizard (Super Admin)
`Cloud → VM Pool` page with a `+ Register Azure VM` wizard:
Cloud Connection → Resource Group → Azure VM (live list from ARM, no free-text resource IDs) → SkillTrack Template → Review & Register.

Compatibility check at the review step compares subscription, resource group, OS, region and VM size against the selected template and shows non-blocking warnings for mismatches.

### 3. Pool dashboard
Per-template summary row (Available / Allocated / Running / In Use / Stopped / Error) plus a machine table with Start, Stop, Release, Refresh actions, real Azure power state, and orphan flagging (Azure says running, SkillTrack has no active session) with Stop / Release remediation.

### 4. Allocation with a lock
Start Lab resolves user → workspace → lab assignment → template → cloud connection, then atomically claims one `AVAILABLE` VM for that template/workspace. A single-writer claim guarantees no two sessions ever get the same machine; when nothing is free the learner sees "No VM is currently available for this lab. Please try again shortly." The browser never sends a VM ID — assignment is derived server-side from the authenticated session.

### 5. Real Azure lifecycle
Start Lab issues a real ARM start on the mapped resource; the existing Cloud Controller poll loop reads real instance-view power state, normalises it (`PowerState/running → RUNNING`, `PowerState/deallocated → STOPPED`), runs the readiness check, and streams phases over the existing SSE channel (`REQUESTED → ALLOCATING → ALLOCATED → STARTING → BOOTING → CHECKING → READY → CONNECTING`). Raw ARM payloads are never returned to the browser.

Stop Lab / session expiry / auto-cleanup run the ordered release: terminate remote desktop → stop or deallocate the Azure VM → wait for confirmation → clear the user assignment → return the VM to the pool → end session → audit event.

### 6. Dynamic provisioning scaffold
`provisionVMFromTemplate(templateId, sessionId)` is defined with the full resolution chain (connection → resource group → image version → size → region → network → create → wait → start → readiness) but stays behind `ENABLE_DYNAMIC_VM_PROVISIONING=false` and is not exposed in the UI.

## Technical notes

- `src/lib/vm/pool/` — new `types.ts`, `registry.server.ts` (records + status transitions), `allocator.server.ts` (claim/release lock).
- `src/lib/vm/orchestrator.server.ts` — add `allocateVM(sessionId)`, `releaseVM(vmId)`, `provisionVMFromTemplate` (flagged); existing `startVM/stopVM/getVMStatus/checkVMReadiness` route through the pool's resolved Azure resource instead of an ad-hoc mapping.
- `src/lib/cloud/connections/azure-arm.server.ts` — reuse `listVirtualMachines` for discovery; add instance-view read by resource ID for pool refresh.
- `src/lib/cloud/mapping.server.ts` — mappings now derive from pool records so admin views stay masked.
- APIs: `src/routes/api/admin/cloud/vm-pool.ts` (list/register/refresh), `.../vm-pool/$vmId.ts` (start/stop/release), all behind `authorizeCloudAdmin` with `cloud:manage` / `vm:manage`; lab start/stop routes keep learner-chain validation and gain allocation.
- UI: `src/routes/admin/cloud/vm-pool.tsx` plus `AzureVmRegisterWizard.tsx` and `VmPoolTable.tsx`, sidebar entry under Cloud (Super Admin only).
- Audit: register, start, stop, release, orphan-cleanup recorded via the existing cloud audit log with normalised error codes.
- Mock provider stays for development; when a workspace resolves to a live Azure connection, real ARM calls are used.
