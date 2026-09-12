---
name: verify-herdr-web
description: "Verify herdr-web's browser UI through its local bridge and Vite server; use when proving workspace navigation, tabs, terminal controls, notes, or settings behavior."
---

# Verify herdr-web

Drive the real herdr-web browser UI through a local bridge connected to a running Herdr daemon. Read [`features/README.md`](features/README.md) first and choose a mapped user path. This skill does not start or stop Herdr itself.

## Launch

The primary surface is the React/Vite browser app at `web/`. The bridge serves the built app and proxies the browser's HTTP and WebSocket requests to the Herdr daemon. Source verification needs Node.js 22+, npm, Rust stable, `curl`, `jq`, `ss`, and a running Herdr `v0.9.0` or newer daemon with terminal protocol `22` on the active socket, normally `$HOME/.config/herdr/herdr.sock`.

Install dependencies and build once from the repository root:

```bash
npm install
npm install --prefix web
npm run build
```

Use disposable verification ports so this run does not attach to another web or bridge process. Run the server in a dedicated terminal and keep that terminal alive:

```bash
RUN_ID="herdr-web-verify-$(date +%Y%m%d-%H%M%S)"
ARTIFACT_DIR="$PWD/.pi/skills/verify-herdr-web/artifacts/$RUN_ID"
mkdir -p "$ARTIFACT_DIR"
BRIDGE_PORT="${HERDR_WEB_VERIFY_BRIDGE_PORT:-18787}"
DEV_PORT="${HERDR_WEB_VERIFY_DEV_PORT:-15173}"
APP_URL="http://127.0.0.1:$DEV_PORT"
export RUN_ID ARTIFACT_DIR BRIDGE_PORT DEV_PORT APP_URL
HERDR_SOCKET_PATH="${HERDR_SOCKET_PATH:-$HOME/.config/herdr/herdr.sock}" \
HERDR_WEB_BRIDGE_PORT="$BRIDGE_PORT" \
HERDR_WEB_DEV_PORT="$DEV_PORT" \
npm run dev >"$ARTIFACT_DIR/launch.log" 2>&1 &
RUN_PID=$!
printf '%s\n' "$RUN_PID" >"$ARTIFACT_DIR/run.pid"
printf '%s\n' "$BRIDGE_PORT" >"$ARTIFACT_DIR/bridge.port"
printf '%s\n' "$DEV_PORT" >"$ARTIFACT_DIR/dev.port"
```

`npm run dev` starts `scripts/dev.mjs`, which starts `herdr-web-bridge` on `127.0.0.1:$BRIDGE_PORT` and Vite on `127.0.0.1:$DEV_PORT`. Readiness is the `open the Vite URL` line in `launch.log` plus a successful Doctor check. Do not drive an instance that another process owns. If either port is occupied, choose different verification ports and pass the same values to every command below.

The bridge rejects an incompatible daemon before it serves requests. A failed startup mentioning the Herdr version or protocol is an environment compatibility failure, not a reason to change product code. Teardown for every launch, including failed attempts, is the Cleanup section below.

## Doctor

Run Doctor before driving the page and after any launch or connection problem:

```bash
RUN_PID="$(cat "$ARTIFACT_DIR/run.pid")"
"$PWD/.pi/skills/verify-herdr-web/helpers/doctor.sh" \
  "$BRIDGE_PORT" "$DEV_PORT" "$RUN_PID" "$ARTIFACT_DIR/launch.log" \
  | tee "$ARTIFACT_DIR/doctor.txt"
```

Doctor is read-only with respect to the app. It checks that the recorded launch process is alive, that the bridge and Vite ports are owned by this checkout's exact binaries, that `web/dist/index.html` and the debug bridge exist, that `/api/capabilities` answers with the allow-listed layout commands plus notes and launcher capabilities, that `/api/snapshot` has workspace/tab/pane arrays, and that the dev URL serves herdr-web HTML. The bridge's successful startup is the daemon version/protocol check. This bridge has no browser authentication yet, so a successful capabilities request is the access check; keep the server loopback-only.

If Doctor fails, run Cleanup before retrying. Do not click through a partially connected page.

## Drive

Use `chrome-devtools-axi` for every browser action. On a host with Google Chrome, open the page directly:

```bash
npx -y chrome-devtools-axi open "$APP_URL"
```

On this Chromium-only host, start an isolated Chromium profile in a disposable terminal before opening the page:

```bash
rm -rf /tmp/herdr-web-axi-profile
chromium --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/tmp/herdr-web-axi-profile \
  --no-first-run --no-default-browser-check about:blank
```

Then set the connection variables in the browser-driving terminal and use the same browser session for all actions:

```bash
export CHROME_DEVTOOLS_AXI_BROWSER_URL=http://127.0.0.1:9222
export CHROME_DEVTOOLS_AXI_SESSION=herdr-web-verify
npx -y chrome-devtools-axi open "$APP_URL"
```

The stable handles in the UI are ARIA labels and roles. For the mapped settings proof, run this real UI path. The DOM clicks select the same visible buttons a user selects; they do not call an application setter or bridge endpoint.

First open Settings → Display and record the fresh-profile precondition before changing it:

```bash
npx -y chrome-devtools-axi run <<EOF | tee "$ARTIFACT_DIR/drive.txt"
await page.open("$APP_URL");
await page.eval("document.querySelector('button[aria-label=Settings]').click()");
await page.eval("Array.from(document.querySelectorAll('button[role=tab]')).find(function(node){ return node.textContent.trim() === 'Display'; }).click()");
const before = await page.eval("document.querySelector('[aria-label=\"Navigation synchronization\"] button[aria-pressed=\"true\"]').textContent.trim()");
if (before !== "On") throw new Error("fresh verification profile started with Navigation synchronization " + before);
console.log(JSON.stringify({selected: before}));
EOF
npx -y chrome-devtools-axi snapshot >"$ARTIFACT_DIR/01-display-before.aria.txt"
npx -y chrome-devtools-axi screenshot "$ARTIFACT_DIR/01-display-before.png"
```

Click Off, observe the browser storage value, reload the page, and observe the persisted state. Append these results to the same drive transcript:

```bash
npx -y chrome-devtools-axi run <<EOF | tee -a "$ARTIFACT_DIR/drive.txt"
await page.eval("Array.from(document.querySelector('[aria-label=\"Navigation synchronization\"]').querySelectorAll('button')).find(function(node){ return node.textContent.trim() === 'Off'; }).click()");
const afterClick = await page.eval("document.querySelector('[aria-label=\"Navigation synchronization\"] button[aria-pressed=\"true\"]').textContent.trim()");
const stored = await page.eval("localStorage.getItem('herdrWeb.navigationSyncMode.v1')");
if (afterClick !== "Off" || stored !== "independent") throw new Error("Navigation synchronization did not persist independent mode: " + afterClick + ", " + stored);
console.log(JSON.stringify({selected: afterClick, stored}));
await page.open("$APP_URL");
await page.eval("document.querySelector('button[aria-label=Settings]').click()");
await page.eval("Array.from(document.querySelectorAll('button[role=tab]')).find(function(node){ return node.textContent.trim() === 'Display'; }).click()");
const afterReload = await page.eval("document.querySelector('[aria-label=\"Navigation synchronization\"] button[aria-pressed=\"true\"]').textContent.trim()");
const storedAfterReload = await page.eval("localStorage.getItem('herdrWeb.navigationSyncMode.v1')");
if (afterReload !== "Off" || storedAfterReload !== "independent") throw new Error("Navigation synchronization did not survive reload: " + afterReload + ", " + storedAfterReload);
console.log(JSON.stringify({selectedAfterReload: afterReload, stored: storedAfterReload}));
EOF
npx -y chrome-devtools-axi snapshot >"$ARTIFACT_DIR/03-display-off-after-reload.aria.txt"
npx -y chrome-devtools-axi screenshot "$ARTIFACT_DIR/03-display-off-after-reload.png"
```

The page snapshots must show the `Settings` dialog, the `Display` tab, and the selected `Off` button; the screenshots must show the same app identity and control state.

The feature map names the other user paths and their stable handles. Use a fresh accessibility snapshot after every state-changing action when driving those paths. Never reuse an old AXI `uid` after a page re-render.

## Evidence

A proof must exercise a real user path through the browser, capture both the action and resulting state, and verify a side effect alongside what is visible. For the settings path, the action is the `Off` button click, the visible result is `aria-pressed` on the `Off` button, and the side effect is `herdrWeb.navigationSyncMode.v1=independent` surviving a reload. The `chrome-devtools-axi run` script observes local storage; it does not write it directly.

Keep proof artifacts under `$PWD/.pi/skills/verify-herdr-web/artifacts/<run-id>/`. Cleanup must never remove that directory. A completed run contains:

- `launch.log`, `doctor.txt`, and `drive.txt` for launch and terminal evidence;
- ARIA snapshots and PNG screenshots with the app identity visible;
- any read-only side-effect observation such as the stored navigation mode;
- `result.md` describing the run and its final assertions.

The committed proof at [`artifacts/proof-settings-sync/`](artifacts/proof-settings-sync/) is the reference shape. It records a launch on ports `18787` and `15173`, a successful Doctor check against Herdr protocol `22`, the settings action, the persisted `independent` value after reload, and evidence that remained after Cleanup. Do not replace browser proof with an internal React call, a direct `/api/command` mutation, a test-only endpoint, or a screenshot of only the final screen. This app has no dry-run mode for the mapped path.

## Cleanup

Run Cleanup after every attempt, including a failed launch or failed browser step:

```bash
"$PWD/.pi/skills/verify-herdr-web/helpers/cleanup.sh" \
  "$(cat "$ARTIFACT_DIR/run.pid")" "$ARTIFACT_DIR"
```

The helper sends signals only to the exact launch PID recorded by this run, then to the exact bridge and Vite PIDs recorded by Doctor if a detached child remains. It never kills by process name. Stop the AXI bridge with `npx -y chrome-devtools-axi stop`; stop the Chromium process started for this run through its terminal's normal `Ctrl-C` path, then remove `/tmp/herdr-web-axi-profile`. Do not stop or restart the shared Herdr daemon. Do not delete `$ARTIFACT_DIR` or its evidence.

After Cleanup, confirm the proof survived:

```bash
test -s "$ARTIFACT_DIR/doctor.txt"
test -s "$ARTIFACT_DIR/drive.txt"
test -s "$ARTIFACT_DIR/03-display-off-after-reload.aria.txt"
test -s "$ARTIFACT_DIR/03-display-off-after-reload.png"
grep -Fq 'selectedAfterReload' "$ARTIFACT_DIR/drive.txt"
```

## Helpers

The skill ships two executable helpers. Their full invocations are shown above:

- `helpers/doctor.sh BRIDGE_PORT DEV_PORT RUN_PID LAUNCH_LOG` checks process ownership, build assets, bridge capabilities, snapshot shape, and the dev page.
- `helpers/cleanup.sh RUN_PID ARTIFACT_DIR` stops the exact recorded launch and child PIDs while retaining evidence.

Use `/skill:maintain-verification-skill` when the app's routes, controls, bridge capabilities, or user-facing features change.
