# SkillTrack Labs — example Azure footprint. Template only: no real ids or secrets.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
  }
}

provider "azurerm" {
  features {}
  # subscription_id comes from ARM_SUBSCRIPTION_ID or your CLI context — never hard-coded.
}

locals {
  name = "${var.prefix}-${var.environment}"
  tags = merge({ application = "skilltrack-labs", environment = var.environment }, var.tags)
}

resource "azurerm_resource_group" "labs" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

# ------------------------------------------------------------------ network --
resource "azurerm_virtual_network" "labs" {
  name                = "vnet-${local.name}"
  resource_group_name = azurerm_resource_group.labs.name
  location            = azurerm_resource_group.labs.location
  address_space       = [var.vnet_address_space]
  tags                = local.tags
}

resource "azurerm_subnet" "labs" {
  name                 = "snet-labs"
  resource_group_name  = azurerm_resource_group.labs.name
  virtual_network_name = azurerm_virtual_network.labs.name
  address_prefixes     = [var.lab_subnet_prefix]
}

resource "azurerm_subnet" "gateway" {
  name                 = "snet-gateway"
  resource_group_name  = azurerm_resource_group.labs.name
  virtual_network_name = azurerm_virtual_network.labs.name
  address_prefixes     = [var.gateway_subnet_prefix]
}

# Lab VMs: RDP only from the gateway subnet, nothing else inbound, no public IP.
resource "azurerm_network_security_group" "labs" {
  name                = "nsg-labs-${local.name}"
  resource_group_name = azurerm_resource_group.labs.name
  location            = azurerm_resource_group.labs.location
  tags                = local.tags

  security_rule {
    name                       = "allow-rdp-from-gateway"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3389"
    source_address_prefix      = var.gateway_subnet_prefix
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "deny-all-inbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "labs" {
  subnet_id                 = azurerm_subnet.labs.id
  network_security_group_id = azurerm_network_security_group.labs.id
}

# Gateway host: only 443 from the internet.
resource "azurerm_network_security_group" "gateway" {
  name                = "nsg-gateway-${local.name}"
  resource_group_name = azurerm_resource_group.labs.name
  location            = azurerm_resource_group.labs.location
  tags                = local.tags

  security_rule {
    name                       = "allow-https"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "gateway" {
  subnet_id                 = azurerm_subnet.gateway.id
  network_security_group_id = azurerm_network_security_group.gateway.id
}

# ---------------------------------------------------------------- identity ---
# User-assigned identity for the app host; its client id becomes AZURE_CLIENT_ID.
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-app-${local.name}"
  resource_group_name = azurerm_resource_group.labs.name
  location            = azurerm_resource_group.labs.location
  tags                = local.tags
}

resource "azurerm_role_assignment" "vm_contributor" {
  scope                = azurerm_resource_group.labs.id
  role_definition_name = "Virtual Machine Contributor"
  principal_id         = coalesce(var.app_principal_id, azurerm_user_assigned_identity.app.principal_id)
}

resource "azurerm_role_assignment" "network_contributor" {
  scope                = azurerm_resource_group.labs.id
  role_definition_name = "Network Contributor"
  principal_id         = coalesce(var.app_principal_id, azurerm_user_assigned_identity.app.principal_id)
}

# --------------------------------------------------------------- key vault ---
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "platform" {
  name                       = "kv-${var.prefix}-${var.environment}"
  resource_group_name        = azurerm_resource_group.labs.name
  location                   = azurerm_resource_group.labs.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  enable_rbac_authorization  = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
  tags                       = local.tags
}

resource "azurerm_role_assignment" "kv_secrets_user" {
  scope                = azurerm_key_vault.platform.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = coalesce(var.app_principal_id, azurerm_user_assigned_identity.app.principal_id)
}

# Secret VALUES are never stored in source control — create them out of band:
#   az keyvault secret set --vault-name <vault> --name SESSION-SIGNING-KEY --value <generated>

# ------------------------------------------------------------- monitoring ----
resource "azurerm_log_analytics_workspace" "platform" {
  name                = "log-${local.name}"
  resource_group_name = azurerm_resource_group.labs.name
  location            = azurerm_resource_group.labs.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

# ------------------------------------------------------------ image gallery --
resource "azurerm_shared_image_gallery" "labs" {
  name                = replace("gal_${var.prefix}_${var.environment}", "-", "_")
  resource_group_name = azurerm_resource_group.labs.name
  location            = azurerm_resource_group.labs.location
  description         = "Lab images imported as SkillTrack templates."
  tags                = local.tags
}

# --------------------------------------------------------------- app host ----
# Placeholder: deploy the TanStack Start build to your platform of choice and
# attach azurerm_user_assigned_identity.app so Key Vault and ARM calls work
# without a stored secret. Example (Container Apps / App Service) omitted on
# purpose so this template stays host-agnostic.

# ------------------------------------------------- scheduled cleanup worker ---
# Placeholder: the reaper runs in-process today. To externalise it, schedule a
# container job every 30s-1m with the same identity and environment; the durable
# lease keeps concurrent runners safe.
