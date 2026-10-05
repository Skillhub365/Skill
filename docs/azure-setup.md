# Azure setup

## Permissions

The platform identity needs, scoped to the lab resource group:

- `Virtual Machine Contributor` — start/stop/deallocate lab VMs
- `Network Contributor` — NIC/subnet association (dynamic provisioning only)
- `Reader` on the subscription — inventory and gallery discovery
- `Key Vault Secrets User` on the vault (Officer only if it must write rotations)

Grant nothing at subscription-owner level.

## Identity

Prefer a **managed identity** on the app host: no secret to store or rotate. Set
`AZURE_USE_MANAGED_IDENTITY=true`; user-assigned identities are selected with
`AZURE_CLIENT_ID`. A **service principal** (`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/
`AZURE_CLIENT_SECRET`) is the development and staging fallback and is rejected in
production unless `AZURE_ALLOW_SERVICE_PRINCIPAL=true`.

## Resource group and network

- One resource group per environment holds lab VMs, NICs and disks (`AZURE_RESOURCE_GROUP`).
- `AZURE_VNET_NAME` / `AZURE_SUBNET_NAME` define the lab subnet.
- **Lab VMs must have no public IP.**
- NSG: inbound 3389 allowed **only** from the Guacamole subnet prefix; deny all other
  inbound; outbound restricted to what the image needs (updates, activation).
- The gateway host lives in its own subnet inside or peered to the lab VNet and
  publishes only 443.

## Images

Use an Azure Compute Gallery image definition with a versioned image. Import it
through Admin → Cloud → Image Templates (connection → resource group → gallery →
definition → version → template config). The template records the resource ids and
the owning cloud connection.

## VM pool

Register pre-created machines in Admin → Cloud → VM Pool and run **Sync** after any
change made directly in Azure. See [vm-pool.md](vm-pool.md).

## Quota, SKU, region

Check regional vCPU quota for the chosen SKU family before growing the pool; keep
pool VMs, gallery replicas and the gateway in the same region to avoid egress and
latency. See [runbooks/quota-sku-failures.md](runbooks/quota-sku-failures.md).

## Troubleshooting

Azure errors are normalized in `src/lib/cloud/azure-errors.ts`. Common codes:
`AuthorizationFailed` (role assignment), `OperationNotAllowed` (quota),
`SkuNotAvailable` (region/SKU), `ResourceNotFound` (pool row out of sync — run Sync),
`Conflict` (concurrent operation on the VM — retry after the current one settles).
