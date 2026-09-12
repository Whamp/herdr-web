#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 BRIDGE_PORT DEV_PORT RUN_PID LAUNCH_LOG" >&2
  exit 2
fi

bridge_port=$1
dev_port=$2
run_pid=$3
launch_log=$4
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
bridge_url="http://127.0.0.1:${bridge_port}"
dev_url="http://127.0.0.1:${dev_port}"
run_dir=$(dirname "$launch_log")

is_integer() {
  [[ $1 =~ ^[0-9]+$ ]]
}

if ! is_integer "$bridge_port" || ! is_integer "$dev_port" || ! is_integer "$run_pid"; then
  echo "doctor: ports and RUN_PID must be integers" >&2
  exit 2
fi

if ! kill -0 "$run_pid" 2>/dev/null; then
  echo "doctor: launch process $run_pid is not running" >&2
  exit 1
fi

listener_pid() {
  ss -ltnpH "sport = :$1" 2>/dev/null |
    grep -o 'pid=[0-9][0-9]*' |
    head -n 1 |
    cut -d= -f2
}

bridge_pid=$(listener_pid "$bridge_port")
vite_pid=$(listener_pid "$dev_port")
if [[ -z $bridge_pid || -z $vite_pid ]]; then
  echo "doctor: expected listeners are missing (bridge=$bridge_pid, dev=$vite_pid)" >&2
  exit 1
fi

bridge_command=$(ps -p "$bridge_pid" -o args=)
vite_command=$(ps -p "$vite_pid" -o args=)
if [[ $bridge_command != *"$root_dir/bridge/target/debug/herdr-web-bridge"* ]]; then
  echo "doctor: bridge port $bridge_port is owned by an unexpected process: $bridge_command" >&2
  exit 1
fi
if [[ $vite_command != *"$root_dir/web/node_modules/.bin/vite"* ]]; then
  echo "doctor: dev port $dev_port is owned by an unexpected process: $vite_command" >&2
  exit 1
fi

mkdir -p "$run_dir"
printf '%s\n' "$bridge_pid" > "$run_dir/bridge.pid"
printf '%s\n' "$vite_pid" > "$run_dir/vite.pid"

if [[ ! -x "$root_dir/bridge/target/debug/herdr-web-bridge" ]]; then
  echo "doctor: debug bridge binary is missing" >&2
  exit 1
fi
if [[ ! -f "$root_dir/web/dist/index.html" ]]; then
  echo "doctor: web/dist/index.html is missing; run npm run build:web" >&2
  exit 1
fi

capabilities=$(curl --fail --silent --show-error --max-time 5 "$bridge_url/api/capabilities")
jq -e '
  (.commands | index("pane.split")) and
  (.commands | index("workspace.create")) and
  (.commands | index("tab.create")) and
  (.notes.version == 1) and
  (.launcher_presets.version == 1)
' <<<"$capabilities" >/dev/null

snapshot=$(curl --fail --silent --show-error --max-time 5 "$bridge_url/api/snapshot")
jq -e '(.workspaces | type == "array") and (.tabs | type == "array") and (.panes | type == "array")' <<<"$snapshot" >/dev/null

page=$(curl --fail --silent --show-error --max-time 5 "$dev_url/")
grep -Fq 'herdr-web' <<<"$page"

printf 'doctor: OK\n'
printf 'repo: %s\n' "$(git -C "$root_dir" rev-parse --short HEAD)"
printf 'bridge: %s (pid %s)\n' "$bridge_url" "$bridge_pid"
printf 'dev: %s (pid %s)\n' "$dev_url" "$vite_pid"
printf 'daemon compatibility: Herdr 0.9.0+ with terminal protocol 22 (enforced before bridge startup)\n'
printf 'capabilities: pane/layout commands, launcher presets, and notes available\n'
printf 'snapshot: workspaces=%s tabs=%s panes=%s\n' \
  "$(jq '.workspaces | length' <<<"$snapshot")" \
  "$(jq '.tabs | length' <<<"$snapshot")" \
  "$(jq '.panes | length' <<<"$snapshot")"
