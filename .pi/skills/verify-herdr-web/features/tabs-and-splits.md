# Tabs and splits

Tabs and splits let a user create a terminal tab, split the selected pane right or down, launch a configured shell or agent preset, rename entries, and close or move layout items through the visible menus.

## Sub-features

- `tab-create` opens the `New tab` launch dialog for the active Space.
- `split-create` opens `Split right` or `Split down` for the selected pane.
- `preset-select` chooses a built-in or custom launcher preset from the `Launch type` radio group.
- `entry-label` renames a Space, tab, or pane through its action menu.
- `entry-close-move` closes or moves a tab/pane through a confirmation dialog or action menu.

## How to get to it (user POV)

- Choose `New tab` in the active sidebar section or the tab bar.
- Choose `Split right` or `Split down` beside the selected pane title in the terminal stage.
- Choose a visible Space or pane action menu and then `New tab`, `Rename`, `Move to new tab`, or `Move to new space`.
- In the launch dialog, choose a radio option such as `Shell`, `Codex`, `Claude`, `pi`, `Grok`, or `OpenCode` when the connected bridge advertises it, edit `title`, and choose `Create`.
- To close an item, choose `Close tab`, `Close pane`, or `Close space`, then confirm with the matching visible confirmation button.

## Driving it with chrome-devtools-axi

Preconditions:

- Doctor reports `tab.create` and `pane.split` in `/api/capabilities`.
- A selected pane and active Space appear in the accessibility snapshot.
- The recipe has a disposable title and a recorded baseline snapshot so every created tab or split can be removed after proof.

- **Open the launch dialog.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for "New tab", "Split right", or "Split down">`. A dialog named `New tab`, `Split right`, or `Split down` appears with a `Launch type` radiogroup, a `title` textbox, `Cancel`, and `Create`.
- **Choose a preset.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for a radio in "Launch type">`. Its `aria-checked` value becomes true and the title field contains the preset label until the user edits it.
- **Cancel safely.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for button "Cancel">`. The dialog closes and the tab/pane count in the sidebar is unchanged. Use this path when only checking the dialog.
- **Create a disposable shell.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi fill @<uid for textbox "title"> "herdr-web verify tab"` followed by `npx -y chrome-devtools-axi click @<uid for button "Create">`. Wait for the new tab or split title to appear in the `Tabs`/`Agents` view and record its tab and pane labels from a fresh snapshot.
- **Rename and close.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for the recorded entry menu>`, where the fresh snapshot identifies `Selected pane actions` or the row menu. Take another snapshot and run `npx -y chrome-devtools-axi click @<uid for "Rename">`. Assert the new label, then use fresh snapshots and `npx -y chrome-devtools-axi click @<uid for "Close tab" or "Close pane">` followed by `npx -y chrome-devtools-axi click @<uid for the matching confirmation>`. Re-run `curl --fail "http://127.0.0.1:$BRIDGE_PORT/api/snapshot"` read-only and assert the recorded ID no longer appears.
- **Proof.** Run `npx -y chrome-devtools-axi snapshot >"$ARTIFACT_DIR/tabs-and-splits.aria.txt"` and `npx -y chrome-devtools-axi screenshot "$ARTIFACT_DIR/tabs-and-splits.png"` before cleanup. A final `curl --fail "http://127.0.0.1:$BRIDGE_PORT/api/snapshot" >"$ARTIFACT_DIR/tabs-and-splits.final.json"` must show the created entry was removed during fixture cleanup.

## Gotchas

- The launch option uses `role="radio"` and `aria-checked`, not a native input. Re-snapshot after choosing a different preset.
- `Create` launches through the bridge's `/api/launcher-presets/launch` route. The frontend does not construct the Herdr command itself.
- Built-in agents and custom presets have different launch semantics. Prove the visible preset label and resulting pane, not only that the dialog closed.
- Closing a Space closes every tab and pane in it. Closing a pane ends its terminal session. Require the exact confirmation text before mutating either one.
- A label is user-visible state but not a stable identifier. Use IDs from the read-only bridge snapshot for cleanup, never a process-name search.
