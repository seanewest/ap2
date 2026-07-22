#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

readonly DEFAULT_DISPLAY_NAME='After Party Exploratory'
readonly APP_DISPLAY_NAME="${AP2_APP_DISPLAY_NAME:-$DEFAULT_DISPLAY_NAME}"

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

main() {
  local confirmed='false'
  local apps_json count object_id app_id remaining attempt

  if [[ "${1:-}" == '--confirm-delete' ]]; then
    confirmed='true'
    shift
  fi
  [[ "$#" == '0' ]] || die 'Usage: bash -s -- --confirm-delete'

  require_command az
  require_command jq
  [[ -n "${APP_DISPLAY_NAME//[[:space:]]/}" ]] || die 'The application display name cannot be empty.'

  print_target_tenant
  printf 'Application selected for deletion: %s\n' "$APP_DISPLAY_NAME"

  apps_json="$(list_exact_apps)" || die 'Could not search Microsoft Entra applications.'
  count="$(jq 'length' <<<"$apps_json")"

  case "$count" in
    0)
      printf 'No exact-name application exists; nothing to delete.\n'
      exit 0
      ;;
    1)
      ;;
    *)
      die "Found $count applications named '$APP_DISPLAY_NAME'; refusing to choose or delete one."
      ;;
  esac

  [[ "$confirmed" == 'true' ]] ||
    die "Deletion is destructive. Re-run with --confirm-delete to delete '$APP_DISPLAY_NAME'."

  object_id="$(jq -er '.[0].id' <<<"$apps_json")" || die 'Application has no object ID.'
  app_id="$(jq -er '.[0].appId' <<<"$apps_json")" || die 'Application has no client ID.'

  printf 'Deleting application object %s (client ID %s).\n' "$object_id" "$app_id"
  az ad app delete --id "$object_id" --only-show-errors || die 'Microsoft Entra application deletion failed.'

  for attempt in 1 2 3 4 5; do
    remaining="$(list_exact_apps)" || die 'Could not verify deletion.'
    if [[ "$(jq 'length' <<<"$remaining")" == '0' ]]; then
      printf 'Result: deleted and verified absent.\n'
      exit 0
    fi
    sleep 2
  done

  die 'Deletion returned successfully, but the application still appears in Microsoft Graph.'
}

main "$@"
