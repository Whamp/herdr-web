#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor/herdr"

required=(
  "$VENDOR/Cargo.toml"
  "$VENDOR/Cargo.lock"
  "$VENDOR/src/main.rs"
  "$VENDOR/src/api/client.rs"
  "$VENDOR/src/api/status.rs"
  "$VENDOR/src/api/schema.rs"
  "$VENDOR/src/api/schema"
  "$VENDOR/src/ipc.rs"
  "$VENDOR/src/logging.rs"
  "$VENDOR/src/protocol/wire.rs"
  "$VENDOR/src/server/socket_paths.rs"
  "$VENDOR/vendor/libghostty-vt.vendor.json"
)

for path in "${required[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "missing vendored Herdr file: $path" >&2
    exit 1
  fi
done

if [[ -d "$VENDOR/target" ]]; then
  echo "warning: vendor/herdr/target is generated and should not be committed or archived" >&2
fi

if [[ -d "$VENDOR/vendor/libghostty-vt/.zig-cache" || -d "$VENDOR/vendor/libghostty-vt/zig-out" ]]; then
  echo "warning: vendored libghostty-vt build output should not be committed or archived" >&2
fi

echo "vendored Herdr layout looks clean"
