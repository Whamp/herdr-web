#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8787}"
BRIDGE_BIN="${BRIDGE_BIN:-$ROOT/vendor/herdr/target/debug/herdr}"
STATIC_DIR="${STATIC_DIR:-$ROOT/web/dist}"

if [[ ! -x "$BRIDGE_BIN" ]]; then
  echo "bridge binary not found at $BRIDGE_BIN" >&2
  echo "run: npm run bridge:build" >&2
  exit 1
fi

exec "$BRIDGE_BIN" web-bridge --host "$HOST" --port "$PORT" --static-dir "$STATIC_DIR"
