# Settings and bridges

Settings lets a user select the same-origin bridge, save and test additional bridge profiles, enable Notes, choose navigation and display behavior, and tune terminal and mobile controls without leaving the web app.

## Sub-features

- `settings-open` opens the modal from the `Settings` button.
- `bridge-profile` adds, tests, enables, edits, and deletes a saved bridge profile.
- `feature-toggle` enables or disables the Notes client feature.
- `navigation-sync` switches pane selection between shared and independent browser state.
- `terminal-preferences` changes terminal cursor, composer, input transport, batching, screen-reader text, and upload preferences.
- `mobile-preferences` changes touch terminal controls when the device uses a coarse pointer.

## How to get to it (user POV)

- Choose the sidebar `Settings` button. The modal is a `Settings` dialog with `Bridge`, `Features`, `Display`, `Terminal`, and, on mobile, `Mobile` tabs.
- In `Bridge`, select `Add bridge`, enter `Display name`, `Bridge URL`, and `Bridge color`, then choose `Test` or `Save`.
- In `Features`, choose `On` or `Off` in the `Notes feature` group.
- In `Display`, choose `Off` or `On` in `Navigation synchronization`, `Agent features in Tabs`, `Combine matching workspace names`, or `Multi-host Space selection`.
- In `Terminal` and `Mobile`, choose the labeled segmented controls or edit the labeled numeric inputs. Use each `Reset` button to return a changed numeric preference.

## Driving it with chrome-devtools-axi

Preconditions:

- The verification page is loaded from the Vite URL and Doctor is green.
- Use a disposable browser profile. The proven settings run starts with Navigation synchronization `On` and restores it to `On` before cleanup.
- Never save a real bridge URL or disable another user's same-origin bridge as part of a proof.

- **Open Settings.** Run `npx -y chrome-devtools-axi snapshot`, then `npx -y chrome-devtools-axi click @<uid for button "Settings">`. A dialog named `Settings` appears.
- **Change a display preference.** Run `npx -y chrome-devtools-axi click @<uid for tab "Display">`, take a fresh snapshot, then run `npx -y chrome-devtools-axi click @<uid for "Off" in group "Navigation synchronization">`. Assert `aria-pressed="true"` on Off and run `npx -y chrome-devtools-axi eval "localStorage.getItem('herdrWeb.navigationSyncMode.v1')"` as the read-only side-effect check.
- **Confirm persistence.** Run `npx -y chrome-devtools-axi open "$APP_URL"`, take a fresh snapshot, run `npx -y chrome-devtools-axi click @<uid for button "Settings">`, take another snapshot, run `npx -y chrome-devtools-axi click @<uid for tab "Display">`, and assert Off remains selected and the stored value is `independent`.
- **Restore state.** Run `npx -y chrome-devtools-axi click @<uid for "On" in group "Navigation synchronization">`, take a fresh snapshot, and assert its pressed state before closing the dialog.
- **Test a bridge profile only with a disposable endpoint.** Run `npx -y chrome-devtools-axi click @<uid for "Add bridge">`, run `npx -y chrome-devtools-axi fill @<uid for "Display name"> "herdr-web verify bridge"` and `npx -y chrome-devtools-axi fill @<uid for "Bridge URL"> "http://127.0.0.1:$BRIDGE_PORT"`, then run `npx -y chrome-devtools-axi click @<uid for "Test">` and assert the visible result. Delete the profile through `npx -y chrome-devtools-axi click @<uid for "Delete">` before Cleanup.
- **Proof.** Run `npx -y chrome-devtools-axi snapshot >"$ARTIFACT_DIR/settings-and-bridges.aria.txt"` and `npx -y chrome-devtools-axi screenshot "$ARTIFACT_DIR/settings-and-bridges.png"`. Keep the before/action/after-reload snapshots and the `drive.txt` state lines. The reference proof lives at `artifacts/proof-settings-sync/`.

## Gotchas

- The same-origin row uses a `switch` named `Disable Same origin bridge`; its checked state means the bridge is currently enabled.
- Settings changes are browser-local except bridge profiles, which are stored in browser preferences and may trigger connection probes. Do not use a shared browser profile for verification.
- Navigation synchronization uses the exact storage key `herdrWeb.navigationSyncMode.v1`; observe it only after the visible click.
- `Test` on a saved bridge performs a network request. A test result is not proof that the bridge is safe to use until its host, origin policy, and ownership are checked.
- On a compact viewport, the Settings modal can scroll. Use its visible tab and label, not a coordinate.
- This bridge has no browser authentication yet. Keep verification servers on loopback and do not turn a local recipe into a LAN launch.
