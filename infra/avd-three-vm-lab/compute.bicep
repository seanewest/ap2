@description('Azure region for the disposable lab.')
param location string = resourceGroup().location

@minLength(6)
@maxLength(11)
@description('Short unique name shared with the control-plane deployment.')
param baseName string

@description('Globally unique AP2 ownership marker.')
param runMarker string

@description('Absolute UTC cleanup deadline.')
param expiryUtc string

@description('Object ID of the one fixed learner.')
param learnerObjectId string

@secure()
@description('Ephemeral local Windows administrator password. Never persist it.')
param windowsAdminPassword string

@description('Ephemeral local Windows administrator name.')
param windowsAdminUsername string = 'ap2localadmin'

@secure()
@description('Fresh token retrieved from the exact run host pool.')
param registrationToken string

@description('Ephemeral SSH public key. No inbound SSH rule is created.')
param linuxSshPublicKey string

@description('Ephemeral local Linux administrator name.')
param linuxAdminUsername string = 'ap2runner'

@description('Previously read and frozen Windows 11 Enterprise image version.')
param windowsImageVersion string

@description('Previously read and frozen Canonical Ubuntu 24.04 image version.')
param linuxImageVersion string

var tags = {
  ap2Run: runMarker
  expiresUtc: expiryUtc
  purpose: 'avd-three-vm-lab'
}
var hostPoolName = '${baseName}-hp'
var vmUserLoginRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '1c0163c0-47e6-4577-8991-ea5c82e286e4'
)

resource avdNic 'Microsoft.Network/networkInterfaces@2024-07-01' existing = {
  name: '${baseName}-avd-nic'
}

resource auxiliaryNics 'Microsoft.Network/networkInterfaces@2024-07-01' existing = [
  for index in range(0, 2): {
    name: '${baseName}-aux${index + 1}-nic'
  }
]

resource hostPool 'Microsoft.DesktopVirtualization/hostPools@2024-04-03' existing = {
  name: hostPoolName
}

resource avdVm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${baseName}-avd'
  location: location
  zones: [
    '2'
  ]
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    licenseType: 'Windows_Client'
    hardwareProfile: {
      vmSize: 'Standard_D2as_v7'
    }
    storageProfile: {
      imageReference: {
        publisher: 'MicrosoftWindowsDesktop'
        offer: 'windows-11'
        sku: 'win11-24h2-ent'
        version: windowsImageVersion
      }
      osDisk: {
        name: '${baseName}-avd-os'
        createOption: 'FromImage'
        diskSizeGB: 128
        deleteOption: 'Delete'
        managedDisk: {
          storageAccountType: 'StandardSSD_LRS'
        }
      }
    }
    osProfile: {
      computerName: replace('${baseName}avd', '-', '')
      adminUsername: windowsAdminUsername
      adminPassword: windowsAdminPassword
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: avdNic.id
          properties: {
            deleteOption: 'Delete'
          }
        }
      ]
    }
    securityProfile: {
      securityType: 'TrustedLaunch'
      uefiSettings: {
        secureBootEnabled: true
        vTpmEnabled: true
      }
    }
  }
}

resource entraJoin 'Microsoft.Compute/virtualMachines/extensions@2024-07-01' = {
  parent: avdVm
  name: 'AADLoginForWindows'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.ActiveDirectory'
    type: 'AADLoginForWindows'
    typeHandlerVersion: '2.0'
    autoUpgradeMinorVersion: true
    enableAutomaticUpgrade: false
    settings: {
      mdmId: '0000000a-0000-0000-c000-000000000000'
    }
  }
}

resource registerSessionHost 'Microsoft.Compute/virtualMachines/extensions@2024-07-01' = {
  parent: avdVm
  name: 'MicrosoftPowershellDSC'
  location: location
  properties: {
    publisher: 'Microsoft.Powershell'
    type: 'DSC'
    typeHandlerVersion: '2.73'
    autoUpgradeMinorVersion: true
    settings: {
      modulesUrl: 'https://wvdportalstorageblob.blob.${environment().suffixes.storage}/galleryartifacts/Configuration_1.0.02774.414.zip'
      configurationFunction: 'Configuration.ps1\\AddSessionHost'
      properties: {
        hostPoolName: hostPool.name
        aadJoin: true
      }
    }
    protectedSettings: {
      properties: {
        registrationInfoToken: registrationToken
      }
    }
  }
  dependsOn: [
    entraJoin
  ]
}

resource learnerVmLogin 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: avdVm
  name: guid(avdVm.id, learnerObjectId, vmUserLoginRoleId)
  properties: {
    roleDefinitionId: vmUserLoginRoleId
    principalId: learnerObjectId
    principalType: 'User'
  }
}

var auxiliaryCloudInitTemplate = '''
#cloud-config
write_files:
  - path: /opt/ap2/health.json
    permissions: '0644'
    content: |
      {"runMarker":"__RUN_MARKER__","node":"aux__NODE_NUMBER__","privateAddress":"10.89.2.__IP_SUFFIX__"}
  - path: /etc/systemd/system/ap2-health.service
    permissions: '0644'
    content: |
      [Unit]
      Description=AP2 fixed private health endpoint
      After=network-online.target
      Wants=network-online.target
      [Service]
      ExecStart=/usr/bin/python3 -m http.server 8080 --bind 10.89.2.__IP_SUFFIX__ --directory /opt/ap2
      Restart=on-failure
      [Install]
      WantedBy=multi-user.target
runcmd:
  - [systemctl, daemon-reload]
  - [systemctl, enable, --now, ap2-health.service]
'''
var auxiliaryCloudInit = [
  for index in range(0, 2): replace(
    replace(
      replace(auxiliaryCloudInitTemplate, '__RUN_MARKER__', runMarker),
      '__NODE_NUMBER__',
      string(index + 1)
    ),
    '__IP_SUFFIX__',
    string(index + 4)
  )
]

resource auxiliaryVms 'Microsoft.Compute/virtualMachines@2024-07-01' = [
  for index in range(0, 2): {
    name: '${baseName}-aux${index + 1}'
    location: location
    zones: [
      '2'
    ]
    tags: tags
    properties: {
      hardwareProfile: {
        vmSize: 'Standard_F1als_v7'
      }
      storageProfile: {
        imageReference: {
          publisher: 'Canonical'
          offer: 'ubuntu-24_04-lts'
          sku: 'server'
          version: linuxImageVersion
        }
        osDisk: {
          name: '${baseName}-aux${index + 1}-os'
          createOption: 'FromImage'
          diskSizeGB: 32
          deleteOption: 'Delete'
          managedDisk: {
            storageAccountType: 'StandardSSD_LRS'
          }
        }
      }
      osProfile: {
        computerName: '${baseName}-aux${index + 1}'
        adminUsername: linuxAdminUsername
        customData: base64(auxiliaryCloudInit[index])
        linuxConfiguration: {
          disablePasswordAuthentication: true
          provisionVMAgent: true
          patchSettings: {
            patchMode: 'ImageDefault'
          }
          ssh: {
            publicKeys: [
              {
                path: '/home/${linuxAdminUsername}/.ssh/authorized_keys'
                keyData: linuxSshPublicKey
              }
            ]
          }
        }
      }
      networkProfile: {
        networkInterfaces: [
          {
            id: auxiliaryNics[index].id
            properties: {
              deleteOption: 'Delete'
            }
          }
        ]
      }
      securityProfile: {
        securityType: 'TrustedLaunch'
        uefiSettings: {
          secureBootEnabled: true
          vTpmEnabled: true
        }
      }
    }
  }
]

output avdVmName string = avdVm.name
output auxiliaryVmNames array = [
  for index in range(0, 2): auxiliaryVms[index].name
]
output submittedVmCount int = 3
