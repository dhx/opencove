#!/bin/sh
# Release check: the server bundle's worker, used without a network, tries to reach nothing but loopback.
# Run in a container without a network (docker run --network none …); the guard records every attempt.
#
#   egress-smoke.sh <opencove-server-linux-x64.tar.gz>
set -eu
ASSET="$1"
ROOT="$(mktemp -d)"
LOG="${ROOT}/egress.log"
: >"${LOG}"
tar -xzf "${ASSET}" -C "${ROOT}"
BUNDLE="$(find "${ROOT}" -maxdepth 2 -type d -name app -printf '%h\n' | head -n1)"
NODE="${BUNDLE}/runtime/node/bin/node"
CLI="${BUNDLE}/app/src/app/cli/opencove.mjs"
DATA="${ROOT}/user-data"
export OPENCOVE_USER_DATA_DIR="${DATA}" OPENCOVE_EGRESS_LOG="${LOG}"
export NODE_OPTIONS="--require $(cd "$(dirname "$0")" && pwd)/egress-guard.cjs"

"${NODE}" "${CLI}" worker start --hostname 127.0.0.1 --port 0 --user-data "${DATA}" >"${ROOT}/worker.log" 2>&1 &
LAUNCHER=$!
trap 'kill ${LAUNCHER} 2>/dev/null || true' EXIT
i=0
until [ -s "${DATA}/worker-control-surface.json" ]; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then cat "${ROOT}/worker.log" >&2; echo 'egress smoke: worker did not start' >&2; exit 1; fi
  sleep 0.25
done

# What a person does with the UI that should stay local: look around, open the Web UI, list things.
for args in "ping" "project list" "plugin list" "space list"; do
  # shellcheck disable=SC2086
  "${NODE}" "${CLI}" ${args} >/dev/null 2>&1 || true
done
"${NODE}" -e '
  const c = require(process.argv[1])
  const base = `http://127.0.0.1:${c.port}`
  const h = { authorization: `Bearer ${c.token}`, "content-type": "application/json" }
  const invoke = (kind, id, payload = null) => fetch(`${base}/invoke`, { method: "POST", headers: h, body: JSON.stringify({ kind, id, payload }) })
  ;(async () => {
    await fetch(`${base}/`, { headers: h })
    for (const id of ["sync.state", "session.list"]) await invoke("query", id)
  })().catch(() => {})
' "${DATA}/worker-control-surface.json"
# Background timers (update checks, polling) get time to fire.
sleep "${OPENCOVE_EGRESS_IDLE_SECONDS:-30}"

if [ -s "${LOG}" ]; then
  echo 'egress smoke: the worker tried to reach the network:' >&2
  sort -u "${LOG}" >&2
  exit 1
fi
echo 'egress smoke: no connection attempts beyond loopback'
