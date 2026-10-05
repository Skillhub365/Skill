output "resource_group" { value = azurerm_resource_group.labs.name }
output "vnet_name" { value = azurerm_virtual_network.labs.name }
output "lab_subnet_name" { value = azurerm_subnet.labs.name }
output "gateway_subnet_name" { value = azurerm_subnet.gateway.name }
output "key_vault_uri" { value = azurerm_key_vault.platform.vault_uri }
output "app_identity_client_id" { value = azurerm_user_assigned_identity.app.client_id }
output "log_analytics_workspace_id" { value = azurerm_log_analytics_workspace.platform.id }

# Map these onto app configuration:
#   AZURE_RESOURCE_GROUP  = resource_group
#   AZURE_VNET_NAME       = vnet_name
#   AZURE_SUBNET_NAME     = lab_subnet_name
#   AZURE_KEY_VAULT_URI   = key_vault_uri
#   AZURE_CLIENT_ID       = app_identity_client_id (user-assigned managed identity)
