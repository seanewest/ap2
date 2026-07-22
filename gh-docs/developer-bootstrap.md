# Developer bootstrap: Microsoft Entra application

This developer-only workflow creates one minimal, multi-tenant Microsoft Entra
application registration. It does not create a service principal, credential,
redirect URI, identifier URI, API permission, tenant domain, or other Azure
resource.

## 1. Open Cloud Shell and verify the tenant

Open the authenticated browser-based [Azure Cloud Shell](https://shell.azure.com)
and select **Bash**.

The scripts operate on the tenant selected in your Azure CLI context. Check it
before continuing:

```bash
az account show --query '{tenantName:tenantDisplayName, tenantId:tenantId, user:user.name}' --output table
```

If it is not the tenant you intend to modify, select the correct tenant and
verify again:

```bash
az login --tenant '<tenant-id>' --allow-no-subscriptions
az account show --query '{tenantName:tenantDisplayName, tenantId:tenantId, user:user.name}' --output table
```

## 2. Create or verify the application

[Inspect the create script](https://seanewest.github.io/ap2/gh-docs/create-entra-app.sh),
then run:

```bash
curl -fsSL https://seanewest.github.io/ap2/gh-docs/create-entra-app.sh | bash
```

The script prints the selected tenant before doing anything. If there is no
exact-name match, it creates only an application object named
`After Party Exploratory` with `signInAudience` set to
`AzureADMultipleOrgs`. One match is verified and reported without creating a
duplicate. More than one match causes the script to stop.

## 3. Tear down the application

> **Destructive:** this permanently deletes the exact-name application object
> from the selected tenant.

[Inspect the teardown script](https://seanewest.github.io/ap2/gh-docs/delete-entra-app.sh),
then run the explicitly confirmed teardown:

```bash
curl -fsSL https://seanewest.github.io/ap2/gh-docs/delete-entra-app.sh | bash -s -- --confirm-delete
```

No match is a successful no-op. One match is deleted. More than one match
causes the script to stop without deleting anything. The confirmation is a
command-line flag because `curl` occupies standard input in this workflow.

## Test with a different display name

`AP2_APP_DISPLAY_NAME` is supported only to test the workflow without changing
the real registration:

```bash
curl -fsSL https://seanewest.github.io/ap2/gh-docs/create-entra-app.sh | AP2_APP_DISPLAY_NAME='After Party Exploratory test' bash
curl -fsSL https://seanewest.github.io/ap2/gh-docs/delete-entra-app.sh | AP2_APP_DISPLAY_NAME='After Party Exploratory test' bash -s -- --confirm-delete
```
