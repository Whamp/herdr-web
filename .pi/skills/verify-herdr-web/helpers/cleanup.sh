#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 RUN_PID ARTIFACT_DIR" >&2
  exit 2
fi

run_pid=$1
artifact_dir=$2
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)

if ! [[ $run_pid =~ ^[0-9]+$ ]]; then
  echo "cleanup: RUN_PID must be an integer" >&2
  exit 2
fi

owned_process() {
  local pid=$1
  local kind=$2
  local args
  local cwd
  args=$(ps -p "$pid" -o args= 2>/dev/null || true)
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  [[ $cwd == "$root_dir" ]] || return 1
  case "$kind" in
    supervisor)
      [[ $args == *"npm run dev"* || $args == *"node scripts/dev.mjs"* ]]
      ;;
    bridge)
      [[ $args == *"$root_dir/bridge/target/debug/herdr-web-bridge"* ]]
      ;;
    vite)
      [[ $args == *"$root_dir/web/node_modules/.bin/vite"* ]]
      ;;
    *)
      return 1
      ;;
  esac
}

stop_pid() {
  local pid=$1
  local label=$2
  local kind=$3
  if ! [[ $pid =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  if ! owned_process "$pid" "$kind"; then
    echo "cleanup: refusing to stop unexpected $label pid $pid" >&2
    return 1
  fi
  echo "cleanup: stopping $label pid $pid"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in {1..30}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.2
  done
  echo "cleanup: $label pid $pid did not exit after SIGTERM; sending SIGKILL" >&2
  kill -KILL "$pid" 2>/dev/null || true
}

# The launch PID is the exact process created by the Launch section. The
# dev supervisor owns graceful shutdown of its bridge and Vite children.
stop_pid "$run_pid" "dev supervisor" supervisor

# The supervisor normally cleans up both children. These recorded PIDs cover a
# supervisor that exits before its detached children finish shutting down.
for record in bridge.pid vite.pid; do
  if [[ -f "$artifact_dir/$record" ]]; then
    child_pid=$(head -n 1 "$artifact_dir/$record")
    stop_pid "$child_pid" "${record%.pid}" "${record%.pid}"
  fi
done

echo "cleanup: evidence retained at $artifact_dir"
