# Infrastructure examples

Templates, not turnkey deployments. **No real subscription ids, tenant ids or
secrets** — every environment-specific value is a documented variable.

| Format | Path | Use |
| --- | --- | --- |
| Terraform | `terraform/` | Preferred; full example (RG, VNet/subnet, NSG, Key Vault, identity, Log Analytics, gateway host placeholder) |
| Bicep | `bicep/` | Same footprint for Azure-native pipelines |

Not covered here: Supabase (managed externally — create the project and store its
service-role key in Key Vault), the app host (deploy the TanStack Start build to
your platform of choice and grant it the managed identity created here), and the
Guacamole stack itself (`deploy/guacamole`).

## Variables

| Name | Meaning |
| --- | --- |
| `prefix` | Resource name prefix, e.g. `skilltrack` |
| `environment` | `dev` / `staging` / `prod` |
| `location` | Azure region for all resources |
| `lab_subnet_prefix` | CIDR for lab VMs (no public IPs) |
| `gateway_subnet_prefix` | CIDR for the Guacamole host |
| `app_principal_id` | Object id of the app's managed identity (Key Vault + VM rights) |
| `tags` | Cost/ownership tags |

## Apply

```sh
cd infra/terraform
terraform init
terraform plan  -var-file=env.tfvars      # create from the variables above
terraform apply -var-file=env.tfvars
```

```sh
az deployment group create \
  -g rg-skilltrack-prod \
  -f infra/bicep/main.bicep \
  -p prefix=skilltrack environment=prod location=westeurope
```

## After apply

1. Store secrets in the new Key Vault using the dashed names from [../docs/key-vault.md](../docs/key-vault.md).
2. Deploy the Guacamole stack into the gateway subnet.
3. Create the shared image gallery / image version and register pool VMs in the app.
4. Set `AZURE_*` and `GUACAMOLE_*` variables on the app host.

## Scheduled cleanup worker

The reaper currently runs in-process. If you split it out, deploy it as a container
app job or Function on a 30s–1m schedule with the same managed identity and env; the
durable lease makes concurrent runners safe. See the placeholder in each template.
