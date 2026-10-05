# VM pool

Labs are served from a pool of pre-created Azure VMs. Pre-creation removes minutes
of provisioning from the learner's first click and keeps quota usage predictable.

## Records

`vm_pool_entries` holds one row per machine: Azure resource id, template binding,
state, current session, lease timestamps. `vm_records` holds the runtime VM view.

## Allocation

Allocation is a single atomic Postgres claim (`allocate_pool_vm`) that flips an
idle machine to allocated and binds the session id in one statement. Two concurrent
launches can never receive the same machine; when nothing is free the launch fails
with `VM_UNAVAILABLE` rather than provisioning silently.

## Registration workflow

1. Create the VM in Azure inside the lab subnet, no public IP.
2. Install the lab image / join the domain as needed; confirm RDP from the gateway subnet.
3. Admin → Cloud → VM Pool → Register: pick connection, resource group, VM, template.
4. Run **Sync** to reconcile pool state against Azure.

## Dynamic provisioning

`ENABLE_DYNAMIC_VM_PROVISIONING=true` allows creating machines on demand; it also
requires `AZURE_VNET_NAME` and `AZURE_SUBNET_NAME`. Treat it as preparation-grade —
pool mode is the supported production path today.

## Capacity

`MAX_CONCURRENT_SESSIONS_PER_USER` and `MAX_SESSION_MINUTES` bound demand before
any cloud spend. Size the pool to peak concurrent learners plus headroom for
machines held by the reaper mid-cleanup.

## Orphans

Admin → Cloud → Orphans lists allocated machines with no live session and offers a
manual sweep; the reaper does the same automatically. See
[runbooks/orphan-vm-cleanup.md](runbooks/orphan-vm-cleanup.md).
