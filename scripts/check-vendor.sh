#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPAT="$ROOT/vendor/herdr-compat"

required=(
  "$COMPAT/Cargo.toml"
  "$COMPAT/src/lib.rs"
  "$COMPAT/src/api/client.rs"
  "$COMPAT/src/api/status.rs"
  "$COMPAT/src/api/schema.rs"
  "$COMPAT/src/api/schema"
  "$COMPAT/src/ipc.rs"
  "$COMPAT/src/logging.rs"
  "$COMPAT/src/protocol.rs"
  "$COMPAT/src/protocol/wire.rs"
  "$COMPAT/src/server/socket_paths.rs"
)

for path in "${required[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "missing Herdr compatibility vendor file: $path" >&2
    exit 1
  fi
done

if [[ -d "$ROOT/vendor/herdr" ]]; then
  echo "full vendor/herdr snapshot is not allowed; keep only vendor/herdr-compat" >&2
  exit 1
fi

forbidden_vendor_ref='(#\[path[[:space:]]*=[[:space:]]*"[^"]*vendor/herdr/|vendor/herdr/src)'
if rg -n "$forbidden_vendor_ref" "$ROOT/bridge" "$ROOT/vendor/herdr-compat" >/dev/null; then
  echo "build-time imports from vendor/herdr are not allowed" >&2
  rg -n "$forbidden_vendor_ref" "$ROOT/bridge" "$ROOT/vendor/herdr-compat" >&2
  exit 1
fi

if [[ -n "${HERDR_SRC:-}" ]]; then
  if [[ ! -d "$HERDR_SRC/src" ]]; then
    echo "HERDR_SRC must point at a Herdr checkout containing src/" >&2
    exit 1
  fi

  compare_exact() {
    local upstream_rel="$1"
    local compat_rel="$2"
    if ! diff -q "$HERDR_SRC/$upstream_rel" "$COMPAT/$compat_rel" >/dev/null; then
      echo "Herdr compatibility copy drifted from HERDR_SRC: $compat_rel" >&2
      diff -u "$HERDR_SRC/$upstream_rel" "$COMPAT/$compat_rel" | sed -n '1,120p' >&2
      exit 1
    fi
  }

  compare_wire_body() {
    if ! diff -q \
      <(awk 'seen || /^use std::collections::HashMap;/{seen=1} seen {print}' "$HERDR_SRC/src/protocol/wire.rs") \
      <(awk 'seen || /^use std::collections::HashMap;/{seen=1} seen {print}' "$COMPAT/src/protocol/wire.rs") \
      >/dev/null; then
      echo "Herdr protocol wire copy drifted from HERDR_SRC" >&2
      diff -u \
        <(awk 'seen || /^use std::collections::HashMap;/{seen=1} seen {print}' "$HERDR_SRC/src/protocol/wire.rs") \
        <(awk 'seen || /^use std::collections::HashMap;/{seen=1} seen {print}' "$COMPAT/src/protocol/wire.rs") \
        | sed -n '1,120p' >&2
      exit 1
    fi
  }

  compare_exact "src/api/schema.rs" "src/api/schema.rs"
  while IFS= read -r -d '' upstream_schema_file; do
    file_name="$(basename "$upstream_schema_file")"
    case "$file_name" in
      tests.rs|tabs.rs|workspaces.rs)
        continue
        ;;
    esac
    compare_exact "src/api/schema/$file_name" "src/api/schema/$file_name"
  done < <(find "$HERDR_SRC/src/api/schema" -maxdepth 1 -type f -name '*.rs' -print0)
  compare_wire_body

  echo "Herdr compatibility vendor layout and HERDR_SRC drift checks passed"
else
  echo "Herdr compatibility vendor layout looks clean"
  echo "Set HERDR_SRC=/path/to/herdr to compare exact upstream schema/wire copies"
fi
