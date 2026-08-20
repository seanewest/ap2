#!/bin/sh
set -eu

runtime_root=${AP2_RUNTIME_ROOT:-${XDG_DATA_HOME:-${HOME:?HOME is required}/.local/share}/ap2/runtime}
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
container_root=${AP2_CONTAINER_ROOT:-${XDG_CACHE_HOME:-${HOME}/.cache}/ap2/containers}
storage_root="$container_root/storage"
run_root="$container_root/run"
image='mcr.microsoft.com/playwright:v1.61.1-noble@sha256:cf0daee9b994042e011bc29f20cdff1a9f682a039b43fcd738f7d8a9d3bcd9d6'

install -d -m 700 "$runtime_root" "$runtime_root/secrets" "$runtime_root/runs"
install -d -m 700 "$container_root" "$storage_root" "$run_root"

podman_args="--storage-driver=overlay --storage-opt overlay.ignore_chown_errors=true --runtime /usr/bin/crun --root $storage_root --runroot $run_root --cgroup-manager=cgroupfs"

# shellcheck disable=SC2086
podman $podman_args image exists "$image" || {
  printf '%s\n' "Pinned Playwright image is absent. Pull it once with:" >&2
  printf 'podman %s pull %s\n' "$podman_args" "$image" >&2
  exit 1
}

# The test has no reason to reach Microsoft. Loopback networking remains
# available inside the namespace for the fake-microphone page.
# shellcheck disable=SC2086
exec podman $podman_args run --rm --network=none --user 0 \
  --security-opt label=disable \
  -e AP2_RUNTIME_ROOT=/runtime \
  -e AP2_RUNTIME_RECORD_ROOT="$runtime_root" \
  -v "$repo_root:/work:ro" \
  -v "$runtime_root:/runtime:rw" \
  -w /work \
  "$image" node scripts/check-ap2-durable-runtime.mjs "$@"
