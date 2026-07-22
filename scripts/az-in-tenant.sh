#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: scripts/az-in-tenant.sh <expected-tenant-id> -- <az arguments...>

Example:
  scripts/az-in-tenant.sh 00000000-0000-0000-0000-000000000000 -- account show

The wrapper never changes the active Azure CLI tenant. It refuses to run the
requested command unless both the selected account and a fresh access token
belong to the expected tenant.
EOF
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

main() {
  [[ "$#" -ge 3 ]] || usage

  local expected_tenant_id="${1,,}"
  shift
  [[ "${1:-}" == '--' ]] || usage
  shift
  [[ "$#" -gt 0 ]] || usage

  [[ "$expected_tenant_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
    die "Expected tenant ID is not a UUID: $expected_tenant_id"

  require_command az
  require_command jq
  require_command flock

  local lock_directory="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
  local lock_path="$lock_directory/ap2-azure-cli.lock"
  exec 9>"$lock_path"
  flock 9

  local account_json actual_tenant_id tenant_name signed_in_user token_tenant_id
  account_json="$(az account show --output json --only-show-errors 2>/dev/null)" ||
    die 'Azure CLI is not signed in.'

  actual_tenant_id="$(jq -er '.tenantId | ascii_downcase' <<<"$account_json")" ||
    die 'Azure CLI did not report a tenant ID.'
  tenant_name="$(jq -r '.tenantDisplayName // "(name unavailable)"' <<<"$account_json")"
  signed_in_user="$(jq -r '.user.name // "(user unavailable)"' <<<"$account_json")"

  [[ "$actual_tenant_id" == "$expected_tenant_id" ]] ||
    die "Tenant mismatch: expected $expected_tenant_id, but Azure CLI selected $tenant_name ($actual_tenant_id)."

  token_tenant_id="$(
    az account get-access-token \
      --tenant "$expected_tenant_id" \
      --query tenant \
      --output tsv \
      --only-show-errors
  )" || die "Could not acquire an access token for tenant $expected_tenant_id."
  token_tenant_id="${token_tenant_id,,}"

  [[ "$token_tenant_id" == "$expected_tenant_id" ]] ||
    die "Token tenant mismatch: expected $expected_tenant_id, but Azure CLI returned $token_tenant_id."

  printf 'Azure tenant asserted: %s (%s)\n' "$tenant_name" "$expected_tenant_id" >&2
  printf 'Signed-in account: %s\n' "$signed_in_user" >&2

  az "$@"
}

main "$@"
