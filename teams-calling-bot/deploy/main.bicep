@description('Dedicated single-tenant calling bot application ID.')
param botAppId string

@description('Dedicated disposable lab tenant ID.')
param tenantId string

@description('Fixed simulated-user object ID.')
param targetUserId string

@description('Globally unique DNS label for the public Container App.')
param containerAppName string

@description('Dedicated Azure Bot resource name.')
param botResourceName string

@description('Existing Container Apps environment resource ID.')
param managedEnvironmentId string

@description('Existing Container Apps environment default DNS domain.')
param managedEnvironmentDefaultDomain string

@description('Existing environment storage name backed by Azure Files for the exclusive journal.')
param journalStorageName string

@description('Fully qualified calling-bot container image.')
param containerImage string

@description('Container registry server hostname.')
param registryServer string

@description('Container registry pull username.')
param registryUsername string

@secure()
@description('Container registry pull password.')
param registryPassword string

@secure()
@description('Short-lived calling-bot private certificate in PEM form.')
param certificatePem string

@description('Unique safe label for this one call attempt.')
param runMarker string

@description('Enable only in the reviewed post-readiness revision that may place the one call.')
param runCanary bool = false

param location string = resourceGroup().location

var callbackUri = 'https://${containerAppName}.${managedEnvironmentDefaultDomain}/callbacks/calls'

resource callingBot 'Microsoft.BotService/botServices@2022-09-15' = {
  name: botResourceName
  location: 'global'
  kind: 'azurebot'
  sku: {
    name: 'F0'
  }
  properties: {
    displayName: 'AP2 Calling Canary'
    endpoint: callbackUri
    msaAppId: botAppId
    msaAppTenantId: tenantId
    msaAppType: 'SingleTenant'
    publicNetworkAccess: 'Enabled'
  }
}

resource teamsChannel 'Microsoft.BotService/botServices/channels@2022-09-15' = {
  parent: callingBot
  name: 'MsTeamsChannel'
  location: 'global'
  kind: 'azurebot'
  properties: {
    channelName: 'MsTeamsChannel'
    properties: {
      isEnabled: true
      enableCalling: true
      callingWebhook: callbackUri
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 1
      ingress: {
        external: true
        targetPort: 3001
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: [
        {
          name: 'registry-password'
          value: registryPassword
        }
        {
          name: 'calling-certificate'
          value: certificatePem
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'calling-bot'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3001
                scheme: 'HTTP'
              }
              initialDelaySeconds: 3
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3001
                scheme: 'HTTP'
              }
              initialDelaySeconds: 1
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 3
            }
          ]
          env: [
            {
              name: 'PORT'
              value: '3001'
            }
            {
              name: 'TEAMS_CALLING_BOT_TENANT_ID'
              value: tenantId
            }
            {
              name: 'TEAMS_CALLING_BOT_APP_ID'
              value: botAppId
            }
            {
              name: 'TEAMS_CALLING_BOT_TARGET_USER_ID'
              value: targetUserId
            }
            {
              name: 'TEAMS_CALLING_BOT_CALLBACK_URI'
              value: callbackUri
            }
            {
              name: 'TEAMS_CALLING_BOT_CERTIFICATE_PATH'
              value: '/run/calling-bot-secrets/certificate.pem'
            }
            {
              name: 'TEAMS_CALLING_BOT_JOURNAL_PATH'
              value: '/var/lib/ap2-calling/call.jsonl'
            }
            {
              name: 'TEAMS_CALLING_BOT_RUN_MARKER'
              value: runMarker
            }
            {
              name: 'TEAMS_CALLING_BOT_RUN_CANARY'
              value: string(runCanary)
            }
          ]
          volumeMounts: [
            {
              volumeName: 'calling-secrets'
              mountPath: '/run/calling-bot-secrets'
            }
            {
              volumeName: 'calling-journal'
              mountPath: '/var/lib/ap2-calling'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
      volumes: [
        {
          name: 'calling-secrets'
          storageType: 'Secret'
          secrets: [
            {
              secretRef: 'calling-certificate'
              path: 'certificate.pem'
            }
          ]
        }
        {
          name: 'calling-journal'
          storageType: 'AzureFile'
          storageName: journalStorageName
          mountOptions: 'dir_mode=0700,file_mode=0600,uid=1000,gid=1000'
        }
      ]
    }
  }
}

output deployedCallbackHostname string = app.properties.configuration.ingress.fqdn
