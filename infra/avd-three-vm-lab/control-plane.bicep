@description('Azure region for the disposable lab.')
param location string = resourceGroup().location

@minLength(6)
@maxLength(11)
@description('Short unique name used for every run-owned resource.')
param baseName string

@description('Globally unique AP2 ownership marker.')
param runMarker string

@description('Absolute UTC cleanup deadline and host-pool token expiry.')
param expiryUtc string

@description('Object ID of the one fixed learner.')
param learnerObjectId string

var tags = {
  ap2Run: runMarker
  expiresUtc: expiryUtc
  purpose: 'avd-three-vm-lab'
}
var hostPoolName = '${baseName}-hp'
var appGroupName = '${baseName}-dag'
var desktopVirtualizationUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '1d18fff3-a72a-46b5-b4a9-0b38a3cd7e63'
)

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-07-01' = {
  name: '${baseName}-nat-pip'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Regional'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

resource natGateway 'Microsoft.Network/natGateways@2024-07-01' = {
  name: '${baseName}-nat'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    idleTimeoutInMinutes: 10
    publicIpAddresses: [
      {
        id: publicIp.id
      }
    ]
  }
}

resource sessionNsg 'Microsoft.Network/networkSecurityGroups@2024-07-01' = {
  name: '${baseName}-session-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: []
  }
}

resource auxiliaryNsg 'Microsoft.Network/networkSecurityGroups@2024-07-01' = {
  name: '${baseName}-aux-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowHealthFromSessionHost'
        properties: {
          priority: 100
          access: 'Allow'
          direction: 'Inbound'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '8080'
          sourceAddressPrefix: '10.89.1.0/24'
          destinationAddressPrefix: '10.89.2.0/24'
        }
      }
      {
        name: 'DenyOtherVnetInbound'
        properties: {
          priority: 200
          access: 'Deny'
          direction: 'Inbound'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: 'VirtualNetwork'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-07-01' = {
  name: '${baseName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.89.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'session-hosts'
        properties: {
          addressPrefix: '10.89.1.0/24'
          defaultOutboundAccess: false
          natGateway: {
            id: natGateway.id
          }
          networkSecurityGroup: {
            id: sessionNsg.id
          }
        }
      }
      {
        name: 'auxiliary'
        properties: {
          addressPrefix: '10.89.2.0/24'
          defaultOutboundAccess: false
          natGateway: {
            id: natGateway.id
          }
          networkSecurityGroup: {
            id: auxiliaryNsg.id
          }
        }
      }
    ]
  }
}

resource avdNic 'Microsoft.Network/networkInterfaces@2024-07-01' = {
  name: '${baseName}-avd-nic'
  location: location
  tags: tags
  properties: {
    enableAcceleratedNetworking: true
    ipConfigurations: [
      {
        name: 'ipconfig'
        properties: {
          privateIPAllocationMethod: 'Static'
          privateIPAddress: '10.89.1.4'
          subnet: {
            id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'session-hosts')
          }
        }
      }
    ]
  }
}

resource auxiliaryNics 'Microsoft.Network/networkInterfaces@2024-07-01' = [
  for index in range(0, 2): {
    name: '${baseName}-aux${index + 1}-nic'
    location: location
    tags: tags
    properties: {
      enableAcceleratedNetworking: false
      ipConfigurations: [
        {
          name: 'ipconfig'
          properties: {
            privateIPAllocationMethod: 'Static'
            privateIPAddress: '10.89.2.${index + 4}'
            subnet: {
              id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'auxiliary')
            }
          }
        }
      ]
    }
  }
]

resource hostPool 'Microsoft.DesktopVirtualization/hostPools@2024-04-03' = {
  name: hostPoolName
  location: location
  tags: tags
  properties: {
    friendlyName: runMarker
    description: 'Disposable AP2 three-VM personal desktop lab'
    hostPoolType: 'Personal'
    personalDesktopAssignmentType: 'Direct'
    preferredAppGroupType: 'Desktop'
    loadBalancerType: 'Persistent'
    maxSessionLimit: 1
    validationEnvironment: false
    startVMOnConnect: false
    publicNetworkAccess: 'Enabled'
    customRdpProperty: 'targetisaadjoined:i:1;enablerdsaadauth:i:1;redirectclipboard:i:1;redirectprinters:i:0;drivestoredirect:s:;audiomode:i:0;'
    registrationInfo: {
      expirationTime: expiryUtc
      registrationTokenOperation: 'Update'
    }
  }
}

resource appGroup 'Microsoft.DesktopVirtualization/applicationGroups@2024-04-03' = {
  name: appGroupName
  location: location
  tags: tags
  properties: {
    applicationGroupType: 'Desktop'
    friendlyName: runMarker
    description: 'Disposable AP2 personal desktop'
    hostPoolArmPath: hostPool.id
  }
}

resource workspace 'Microsoft.DesktopVirtualization/workspaces@2024-04-03' = {
  name: '${baseName}-ws'
  location: location
  tags: tags
  properties: {
    friendlyName: runMarker
    description: 'Disposable AP2 three-VM lab workspace'
    publicNetworkAccess: 'Enabled'
    applicationGroupReferences: [
      appGroup.id
    ]
  }
}

resource learnerDesktop 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: appGroup
  name: guid(appGroup.id, learnerObjectId, desktopVirtualizationUserRoleId)
  properties: {
    roleDefinitionId: desktopVirtualizationUserRoleId
    principalId: learnerObjectId
    principalType: 'User'
  }
}

output hostPoolName string = hostPool.name
output appGroupName string = appGroup.name
output workspaceName string = workspace.name
output avdNicName string = avdNic.name
output auxiliaryNicNames array = [
  for index in range(0, 2): auxiliaryNics[index].name
]
output privateAddresses object = {
  avd: '10.89.1.4'
  auxiliary1: '10.89.2.4'
  auxiliary2: '10.89.2.5'
}
