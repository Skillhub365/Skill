// SkillTrack Labs — example Azure footprint (Bicep). Template only.
// Deploy at resource-group scope:
//   az deployment group create -g rg-skilltrack-prod -f main.bicep -p environment=prod

@description('Resource name prefix, e.g. skilltrack.')
param prefix string = 'skilltrack'

@description('dev | staging | prod.')
param environment string

@description('Azure region for every resource.')
param location string = resourceGroup().location

@description('Address space of the lab virtual network.')
param vnetAddressSpace string = '10.40.0.0/16'

@description('Subnet for lab VMs. VMs here must have no public IP.')
param labSubnetPrefix string = '10.40.1.0/24'

@description('Subnet hosting the Guacamole gateway; only source allowed to reach RDP.')
param gatewaySubnetPrefix string = '10.40.2.0/27'

@description('Additional cost/ownership tags.')
param tags object = {}

var name = '${prefix}-${environment}'
var allTags = union({ application: 'skilltrack-labs', environment: environment }, tags)

resource labsNsg 'Microsoft.Network/networkSecurityGroups@2023-09-01' = {
  name: 'nsg-labs-${name}'
  location: location
  tags: allTags
  properties: {
    securityRules: [
      {
        name: 'allow-rdp-from-gateway'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '3389'
          sourceAddressPrefix: gatewaySubnetPrefix
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'deny-all-inbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

resource gatewayNsg 'Microsoft.Network/networkSecurityGroups@2023-09-01' = {
  name: 'nsg-gateway-${name}'
  location: location
  tags: allTags
  properties: {
    securityRules: [
      {
        name: 'allow-https'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: 'Internet'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: 'vnet-${name}'
  location: location
  tags: allTags
  properties: {
    addressSpace: { addressPrefixes: [ vnetAddressSpace ] }
    subnets: [
      {
        name: 'snet-labs'
        properties: {
          addressPrefix: labSubnetPrefix
          networkSecurityGroup: { id: labsNsg.id }
        }
      }
      {
        name: 'snet-gateway'
        properties: {
          addressPrefix: gatewaySubnetPrefix
          networkSecurityGroup: { id: gatewayNsg.id }
        }
      }
    ]
  }
}

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-app-${name}'
  location: location
  tags: allTags
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${prefix}-${environment}'
  location: location
  tags: allTags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
  }
}

// Key Vault Secrets User
var secretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
resource vaultAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, appIdentity.id, secretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsUserRoleId)
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Virtual Machine Contributor on this resource group
var vmContributorRoleId = '9980e02c-c2be-4d73-94e8-173b1dc7cf3c'
resource vmAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, appIdentity.id, vmContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', vmContributorRoleId)
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${name}'
  location: location
  tags: allTags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource gallery 'Microsoft.Compute/galleries@2023-07-03' = {
  name: replace('gal_${prefix}_${environment}', '-', '_')
  location: location
  tags: allTags
  properties: { description: 'Lab images imported as SkillTrack templates.' }
}

// App host and scheduled cleanup worker are intentionally left as placeholders:
// deploy the app build to your platform of choice, attach appIdentity, and set
// AZURE_* / GUACAMOLE_* configuration. Secret VALUES are created out of band.

output resourceGroupName string = resourceGroup().name
output vnetName string = vnet.name
output labSubnetName string = 'snet-labs'
output gatewaySubnetName string = 'snet-gateway'
output keyVaultUri string = vault.properties.vaultUri
output appIdentityClientId string = appIdentity.properties.clientId
output logAnalyticsWorkspaceId string = logs.id
