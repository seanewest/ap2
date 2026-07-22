#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

readonly DEFAULT_DISPLAY_NAME='After Party Exploratory'
readonly APP_DISPLAY_NAME="${AP2_APP_DISPLAY_NAME:-$DEFAULT_DISPLAY_NAME}"
readonly LOCAL_SPA_REDIRECT_URI='http://localhost:5173/'
readonly PRODUCTION_SPA_REDIRECT_URI='https://seanewest.github.io/ap2/'

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

list_exact_apps() {
  az ad app list \
    --display-name "$APP_DISPLAY_NAME" \
    --output json \
    --only-show-errors |
    jq -c --arg name "$APP_DISPLAY_NAME" \
      '[.[] | select(.displayName == $name)]'
}

print_target_tenant() {
  local account_json tenant_id tenant_name signed_in_user

  account_json="$(az account show --output json --only-show-errors 2>/dev/null)" ||
    die 'Azure CLI is not signed in. In Azure Cloud Shell, run: az login'

  tenant_id="$(jq -er '.tenantId | select(type == "string" and length > 0)' <<<"$account_json")" ||
    die 'Azure CLI did not report a tenant ID.'
  tenant_name="$(jq -r '.tenantDisplayName // "(name unavailable)"' <<<"$account_json")"
  signed_in_user="$(jq -r '.user.name // "(user unavailable)"' <<<"$account_json")"

  printf 'Target Azure tenant: %s (%s)\n' "$tenant_name" "$tenant_id"
  printf 'Signed-in account: %s\n' "$signed_in_user"
}

verify_application() {
  local app_id="$1"
  local app_json service_principals exact_apps exact_count

  app_json="$(az ad app show --id "$app_id" --output json --only-show-errors)" ||
    die "Could not read application $app_id after creation or lookup."

  jq -e \
    --arg name "$APP_DISPLAY_NAME" \
    --arg localRedirect "$LOCAL_SPA_REDIRECT_URI" \
    --arg productionRedirect "$PRODUCTION_SPA_REDIRECT_URI" '
    .displayName == $name and
    .signInAudience == "AzureADMultipleOrgs" and
    ((.identifierUris // []) | length) == 0 and
    ((.keyCredentials // []) | length) == 0 and
    ((.passwordCredentials // []) | length) == 0 and
    ((.requiredResourceAccess // []) | length) == 0 and
    ((.appRoles // []) | length) == 0 and
    ((.api.oauth2PermissionScopes // []) | length) == 0 and
    ((.spa.redirectUris // []) | sort) == ([$localRedirect, $productionRedirect] | sort) and
    ((.web.redirectUris // []) | length) == 0 and
    ((.publicClient.redirectUris // []) | length) == 0
  ' <<<"$app_json" >/dev/null ||
    die 'The application exists but does not match the expected minimal multi-tenant configuration.'

  service_principals="$(
    az ad sp list \
      --filter "appId eq '$app_id'" \
      --output json \
      --only-show-errors
  )" || die 'Could not verify that no service principal exists.'

  if [[ "$(jq 'length' <<<"$service_principals")" != '0' ]]; then
    die 'A service principal exists for this application; the bootstrap did not create or modify it.'
  fi

  exact_apps="$(list_exact_apps)" || die 'Could not verify the application after lookup.'
  exact_count="$(jq 'length' <<<"$exact_apps")"
  [[ "$exact_count" == '1' ]] ||
    die "Expected one exact-name application after verification; found $exact_count."

  printf 'Display name: %s\n' "$(jq -r '.displayName' <<<"$app_json")"
  printf 'Application/client ID: %s\n' "$(jq -r '.appId' <<<"$app_json")"
  printf 'Application object ID: %s\n' "$(jq -r '.id' <<<"$app_json")"
  printf 'signInAudience: %s\n' "$(jq -r '.signInAudience' <<<"$app_json")"
}

main() {
  local apps_json count create_body created_json app_id status

  require_command az
  require_command jq
  [[ -n "${APP_DISPLAY_NAME//[[:space:]]/}" ]] || die 'The application display name cannot be empty.'

  print_target_tenant
  printf 'Requested application: %s\n' "$APP_DISPLAY_NAME"

  apps_json="$(list_exact_apps)" || die 'Could not search Microsoft Entra applications.'
  count="$(jq 'length' <<<"$apps_json")"

  case "$count" in
    0)
      printf 'No exact-name application exists; creating the application object only.\n'
      create_body="$(
        jq -cn \
          --arg displayName "$APP_DISPLAY_NAME" \
          --arg localRedirect "$LOCAL_SPA_REDIRECT_URI" \
          --arg productionRedirect "$PRODUCTION_SPA_REDIRECT_URI" \
          '{
            displayName: $displayName,
            signInAudience: "AzureADMultipleOrgs",
            spa: {redirectUris: [$localRedirect, $productionRedirect]}
          }'
      )"
      created_json="$(
        az rest \
          --method post \
          --url 'https://graph.microsoft.com/v1.0/applications' \
          --headers 'Content-Type=application/json' \
          --body "$create_body" \
          --output json \
          --only-show-errors
      )" || die 'Microsoft Entra application creation failed.'
      app_id="$(jq -er '.appId' <<<"$created_json")" || die 'Creation did not return an application ID.'
      status='created'
      ;;
    1)
      app_id="$(jq -er '.[0].appId' <<<"$apps_json")" || die 'Existing application has no application ID.'
      status='already existed'
      ;;
    *)
      die "Found $count applications named '$APP_DISPLAY_NAME'; refusing to choose or create another."
      ;;
  esac

  verify_application "$app_id"
  printf 'Result: %s and verified.\n' "$status"
}

main "$@"
