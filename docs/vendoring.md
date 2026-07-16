# Vendoring Herdr Compatibility

`herdr-web` vendors a small Herdr compatibility crate because the bridge depends on private API and
wire protocol details that are not exposed as a stable Herdr library or daemon API.

## What Is Vendored

`vendor/herdr-compat/` is the only vendored Herdr source in this repository. It is a minimal local
Rust crate containing copied or lightly pruned compatibility code needed by `herdr-web-bridge`:

- JSON API client, status, request, response, and event schema types.
- Terminal attach wire protocol messages, framing, protocol constants, and frame data types.
- Local socket connection helpers.
- Client socket path derivation helpers.
- Small dependent model shims needed by copied schema/protocol modules.
- Bridge file logging adapted to accept a bridge-owned log directory.

`bridge/` remains the repo-owned executable:

- `bridge/src/main.rs` exposes the `herdr-web-bridge` command.
- `bridge/src/session.rs` owns active Herdr session, config directory, and socket path selection.
- `bridge/src/web_bridge.rs` owns the HTTP/WebSocket bridge implementation and browser command
  allow-list.
- `bridge/src/workspace.rs` owns web-specific workspace label derivation.

The full upstream Herdr source tree is intentionally not vendored. Do not recreate `vendor/herdr/`
or path-import files from an upstream checkout at build time.

The browser app is not vendored into Herdr. It lives at `web/`, and `herdr-web-bridge` serves
`web/dist` through `--static-dir`.

## Current Reference

- API and schema baseline: upstream Herdr `v0.7.2`
- Terminal wire baseline: `Whamp/herdr` commit
  `048df3876f60099e186a22297938260cae0eb625` (`remote-link-externalization-test`)

The protocol `17` wire baseline is an explicit compatibility exception for the remote-link test
build. Keep API and schema refreshes anchored to a clean upstream release checkout; do not copy
unrelated API or server changes from the experimental fork.

Use the upstream checkout as an external reference for audits and refreshes. It is not required to
build `herdr-web`.

## Why This Shape

The bridge needs private pieces from Herdr:

- `api::client::ApiClient`
- API schema enums and response types
- `protocol::{ClientMessage, ServerMessage, RenderEncoding, ...}`
- local IPC socket helpers
- protocol version constants
- terminal attach launch mode, resize, scroll, and input frames

Vendoring only `vendor/herdr-compat` keeps these dependencies explicit without carrying the full
Herdr app, website, CI, terminal runtime build path, or legacy `herdr web-bridge` overlay. The cost
is that copied private protocol/API code can drift from upstream Herdr, so refreshes must be
intentional and reviewed.

The compatibility crate currently keeps `ratatui` and `crossterm` because upstream
`protocol::wire` includes semantic frame and input conversion types next to the terminal attach
messages used by the bridge. `herdr-web-bridge` requests terminal ANSI rendering, but keeping the
wire module broad makes protocol drift reviewable against upstream. Revisit this tradeoff if the
bridge narrows the drift check to only the terminal attach message regions.

## Refresh Process

Use separate clean checkouts for the stable API/schema baseline and the protocol wire baseline. Do
not copy unrelated API or server changes from the experimental wire checkout.

```bash
HERDR_SRC=/path/to/herdr-v0.7.2
HERDR_WIRE_SRC=/path/to/herdr-remote-link-test
HERDR_WEB=/path/to/herdr-web
```

1. Verify both source checkouts are clean and pinned to the intended revisions:

```bash
git -C "$HERDR_SRC" status --short
git -C "$HERDR_SRC" rev-parse --short HEAD
git -C "$HERDR_WIRE_SRC" status --short
git -C "$HERDR_WIRE_SRC" rev-parse --short HEAD
```

2. Reconcile only the compatibility surface:

```text
src/api/client.rs          -> vendor/herdr-compat/src/api/client.rs
src/api/status.rs          -> vendor/herdr-compat/src/api/status.rs
src/api/schema.rs          -> vendor/herdr-compat/src/api/schema.rs
src/api/schema/*.rs        -> vendor/herdr-compat/src/api/schema/*.rs
$HERDR_WIRE_SRC/src/protocol/wire.rs
                           -> vendor/herdr-compat/src/protocol/wire.rs
src/ipc.rs                 -> vendor/herdr-compat/src/ipc.rs
src/logging.rs             -> vendor/herdr-compat/src/logging.rs
src/server/socket_paths.rs -> vendor/herdr-compat/src/server/socket_paths.rs
```

3. Preserve intentional local adaptations:

- `ApiClient` takes concrete socket paths; it must not know bridge session rules.
- `logging::init_file_logging` takes a concrete directory from the bridge.
- socket path helpers derive paths from supplied overrides/defaults; bridge session resolution stays
  in `bridge/src/session.rs`.
- `tabs.rs` and `workspaces.rs` keep bridge-internal clear-name sentinel fields; the bridge
  substitutes concrete default labels before forwarding rename requests to Herdr.
- `protocol.rs` and schema tests include bridge fixture tests for the reviewed protocol/schema
  baseline.

4. Run layout and optional upstream drift checks:

```bash
scripts/check-vendor.sh
HERDR_SRC="$HERDR_SRC" scripts/check-vendor.sh
HERDR_WIRE_SRC="$HERDR_WIRE_SRC" scripts/check-vendor.sh
HERDR_SRC="$HERDR_SRC" HERDR_WIRE_SRC="$HERDR_WIRE_SRC" scripts/check-vendor.sh
```

`HERDR_SRC` exact-compares unmodified schema files. `HERDR_WIRE_SRC` exact-compares the terminal
wire protocol body. Locally adapted files are intentionally excluded from exact comparison and must
be reviewed manually during refresh.

5. Re-run validation:

```bash
npm run lint
npm run test
npm run build
```

6. Smoke test:

```bash
scripts/run-bridge.sh
```

Open `http://127.0.0.1:8787`, attach multiple browser clients, switch panes, type, scroll, and use
the refit button after changing browser sizes.

## Compatibility Policy

The bridge pings Herdr's status API at startup and accepts daemon protocols `16` and `17`. The
`v0.7.2` baseline provides protocol `16` and the native `session.snapshot` bootstrap API used by
`/api/snapshot`; older daemons are rejected before serving the web app. Protocol `17` adds the
remote-link external-open lifecycle. The bridge uses protocol `17` only for terminal attachment and
sets its external-open fields to `None`; terminal links still open directly in the browser. This is
not a complete stability guarantee because the bridge mirrors private APIs.

When updating Herdr:

- inspect `src/protocol/wire.rs`
- inspect API schema changes under `src/api/schema/`
- inspect terminal attach handling in `src/server/headless.rs`
- rerun `HERDR_SRC=/path/to/herdr scripts/check-vendor.sh`
- rerun bridge tests and a browser smoke test
- update this document if the bridge compatibility surface changes

## Long-Term Removal Condition

Remove `vendor/herdr-compat` when Herdr exposes enough public surface for the bridge to live outside
Herdr:

- public snapshot/events API
- public terminal websocket or stable terminal attach protocol crate
- multi-client terminal fanout or documented attach ownership
- exact pane focus/selection endpoint
- resize ownership model
- browser authentication story
