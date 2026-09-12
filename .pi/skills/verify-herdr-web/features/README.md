# herdr-web feature map

This directory is the maintained verification map for the herdr-web browser client. Read the index before a drive, then use the feature file that matches the user path. The bridge and UI are local; the backend must be a running Herdr `v0.9.0` or newer daemon reporting terminal protocol `22`.

## Baseline preconditions

- Build from the repository root with `npm run build`.
- Launch the verification bridge and Vite server on disposable loopback ports using the parent skill's Launch section. Keep `ARTIFACT_DIR`, `APP_URL`, `BRIDGE_PORT`, and `DEV_PORT` available in the terminal that runs the recipes.
- Run `helpers/doctor.sh` and require `doctor: OK` before opening the page.
- Open the Vite URL with `chrome-devtools-axi` and use a disposable browser profile.
- Never drive a bridge whose listener PID was not recorded by this verification run.
- Restore local settings and delete or archive any bridge-owned notes, panes, tabs, or spaces created by a recipe. Keep proof artifacts.

## Driving conventions

- Prefer the ARIA labels and roles in the live page: `Settings`, `Agents`, `Tabs`, `Notes`, `New tab`, `New space`, `Selected pane actions`, `Split right`, `Split down`, and the `Terminal` region.
- AXI `uid` values expire after a render. Take a fresh `snapshot` immediately before using a printed ref. In the recipes below, replace each `@<uid ...>` marker with the exact `@g<generation>:<ref>` printed by that snapshot.
- For stable repeated actions, use `chrome-devtools-axi run` with a DOM query for the visible button's ARIA label or role and text. The query must click the actual rendered control, not call a React or bridge function.
- Wait for an observable state: a dialog, a selected tab, an updated heading or breadcrumb, a status, a new list item, or a read-only API response. Do not use a fixed sleep as the assertion.
- Record the feature ID and entry point in the proof artifact. A result reached through one entry point does not verify another entry point.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- Verify side effects through a second user-facing view or a read-only endpoint. Notes and layout changes cross the bridge; settings changes use browser storage.
- Keep screenshots and ARIA snapshots under `.pi/skills/verify-herdr-web/artifacts/<run-id>/` so Cleanup cannot remove them.
- If an entry point cannot be reached, record the attempted command and unmet precondition. Do not call another path equivalent.

## Features

- [Workspace navigation](./workspace-navigation.md) covers host and space scope, Agents/Tabs/Notes views, workspace selection, and sidebar grouping.
- [Tabs and splits](./tabs-and-splits.md) covers new tabs, split panes, launcher presets, labels, and close/move menus.
- [Terminal controls](./terminal-controls.md) covers terminal attach, input, stage/send, refit, mobile keys, URL selection, and uploads.
- [Notes](./notes.md) covers pane and detached notes, autosave, preview, attach/detach, archive, restore, and delete.
- [Settings and bridges](./settings-and-bridges.md) covers bridge profiles and client Display, Features, Terminal, and Mobile preferences. The parent skill proves Navigation synchronization here.
