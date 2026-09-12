# Workspace navigation

Workspace navigation lets a user choose a bridge host, scope the sidebar to one Space or all Spaces, switch between Agents, Tabs, and Notes, and select a workspace or pane without leaving the terminal view.

## Sub-features

- `host-scope` selects the `Same origin` bridge or the `All` host view when more than one bridge is enabled.
- `space-scope` switches between the `Space` and `All` sidebar scopes.
- `sidebar-view` switches between `Agents`, `Tabs`, and `Notes` when Notes is enabled.
- `workspace-select` selects a workspace button and updates its active tab and pane list.
- `pane-select` selects a pane row and updates the `Terminal` region and selected-pane breadcrumb.

## How to get to it (user POV)

- Open the app at the Vite URL. The sidebar is the `Switcher` complementary region.
- Choose `Same origin` or `All` in the `Host` group when multiple bridge profiles are enabled.
- Choose `Space` or `All` in the sidebar scope group.
- Choose `Agents`, `Tabs`, or `Notes` in the sidebar view group.
- Choose a visible Space/workspace button under `SPACES`, then choose a pane or tab row.
- On a compact viewport, choose `Back to switcher` to return from the terminal detail view.

## Driving it with chrome-devtools-axi

Preconditions:

- Doctor reports the expected bridge and Vite ports.
- The accessibility snapshot contains the `Switcher` region, at least one workspace button, and the `Terminal` region.
- If testing `Notes`, the Features setting `Notes` is On and the bridge capabilities report `notes.version=1`.

- **Select the Agents view.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for button "Agents">`. The button is pressed and the sidebar section reads `space agents` or `all agents`.
- **Select the Tabs view.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for button "Tabs">`. The sidebar section reads `tabs` and exposes tab rows and the `New tab` button.
- **Select a workspace.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for the visible workspace button under "SPACES">`. The button becomes active and the workspace's tabs/panes remain in the list.
- **Select a pane.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for the visible pane row>`. The `Terminal` region's selected tab or pane title changes, and the stage exposes `Selected pane actions`.
- **Change scope.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for button "All" in group "Sidebar scope">`. The section changes from the active Space to all enabled Spaces. Take a new snapshot and run `npx -y chrome-devtools-axi click @<uid for button "Space" in group "Sidebar scope">` to restore the baseline.
- **Proof.** Run `npx -y chrome-devtools-axi snapshot >"$ARTIFACT_DIR/workspace-navigation.aria.txt"` and `npx -y chrome-devtools-axi screenshot "$ARTIFACT_DIR/workspace-navigation.png"` after the selection. The artifacts must contain `herdr-web`, the selected workspace or pane, and the resulting `Terminal` region.

## Gotchas

- `All` is used both for host scope and sidebar scope. Use the group name in the snapshot before clicking.
- Workspace and pane labels come from the live Herdr snapshot. Do not hard-code labels from another session.
- A disconnected bridge can still leave its chip visible. Require Doctor and a live snapshot before treating a row as selectable.
- Shared navigation is controlled by Settings → Display. When it is On, another client can change the selected pane while the current page is open.
- Do not create or close a Space merely to prove navigation. If a recipe needs a mutation, record the created ID and restore the layout through the user-facing menu.
