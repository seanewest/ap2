# Teams calling canary

This isolated service implements one startup-only, non-retried 1:1 Teams audio
call. It exposes only `GET /health` and authenticated
`POST /callbacks/calls`. It has no public call trigger.

All deployment-specific values are required at runtime:

- `TEAMS_CALLING_BOT_TENANT_ID`
- `TEAMS_CALLING_BOT_APP_ID`
- `TEAMS_CALLING_BOT_TARGET_USER_ID`
- `TEAMS_CALLING_BOT_CALLBACK_URI`
- `TEAMS_CALLING_BOT_CERTIFICATE_PATH`
- `TEAMS_CALLING_BOT_JOURNAL_PATH`
- `TEAMS_CALLING_BOT_RUN_MARKER`
- `TEAMS_CALLING_BOT_RUN_CANARY` (`false` for callback/readiness deployment)

The Bicep template accepts the dedicated Azure Bot and Container App inputs. It
expects an existing Container Apps environment, registry, and Azure Files
environment-storage binding for the exclusive journal. It does not create an
Entra application, grant Graph roles, upload the Teams package, or run the
call. Those remain separate reviewed/manual steps.

The separately created app must be single-tenant and have only the Microsoft
Graph application role `Calls.Initiate.All` for this stage. Its short-lived
private certificate is supplied as a secure deployment parameter. The personal
Teams package must be manually uploaded and installed for the fixed simulated
user before the one call; the service uses service-hosted audio and requests no
media-access, meeting, chat, video, or resource-specific permission.

Deploy first with `runCanary=false`. After the manual package install and
read-only readiness checks, deploy the reviewed revision with `runCanary=true`.
Only that startup creates the exclusive journal, acquires one token, and may
place the call. A restart sees the retained journal and fails closed.

Build the rootless image with `teams-calling-bot/Dockerfile`. Create a personal
Teams app package outside Git after the dedicated app and callback hostname
exist:

```sh
TEAMS_CALLING_BOT_APP_ID='<runtime-app-id>' \
TEAMS_CALLING_BOT_HOSTNAME='<runtime-callback-hostname>' \
  npm run package:calling-bot-app -- /absolute/private/output.zip
```
