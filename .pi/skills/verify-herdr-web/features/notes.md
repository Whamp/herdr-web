# Notes

Notes lets a user create pane-linked or detached notes, edit and preview Markdown, attach or detach a note from a pane, archive or restore it, and delete it through the Notes surface backed by the bridge.

## Sub-features

- `notes-open` opens the Notes surface from the stage button or sidebar `Notes` view.
- `note-create` creates a pane note or detached note through the `Add note` dialog.
- `note-edit` autosaves a title/body edit and exposes `Edit` and `Preview` modes.
- `note-attach` attaches a detached note to the current pane or detaches a linked note.
- `note-lifecycle` archives, restores, and deletes a note with the matching filters and confirmation.

## How to get to it (user POV)

- Ensure the Notes client feature is On in Settings → Features.
- Choose the stage `Notes` button for the selected pane, or choose `Notes` in the sidebar view.
- In the Notes surface choose `New pane note` for a note linked to the current pane or `New detached note` for a note in the Other list.
- In `Add note`, enter `Title`, optionally choose `Add body`, enter `Body`, and choose `Create`.
- Select the note from the list, edit its title/body, or choose `Preview` to see rendered Markdown.
- Use `Attach to current pane`, `Detach note`, `Archive note`, `Restore note`, or `Delete note` in the note editor toolbar.

## Driving it with chrome-devtools-axi

Preconditions:

- Doctor reports `notes.version=1` and the Notes feature is enabled.
- The bridge-owned notes list has no title matching the unique verification title.
- The selected pane is disposable for attachment tests, or the detached-note path is used.

- **Open Notes.** Run `npx -y chrome-devtools-axi snapshot`, then run `npx -y chrome-devtools-axi click @<uid for the stage or sidebar button "Notes">`. A Notes region appears with `New pane note` and `New detached note` when the current bridge supports notes.
- **Create a detached note.** Run `npx -y chrome-devtools-axi snapshot`, then `npx -y chrome-devtools-axi click @<uid for "New detached note">`. Take another snapshot, run `npx -y chrome-devtools-axi fill @<uid for textbox "Title"> "herdr-web verify note"`, then run `npx -y chrome-devtools-axi click @<uid for button "Add body">`, take a fresh snapshot, run `npx -y chrome-devtools-axi fill @<uid for textbox "Body"> "herdr-web note proof"`, and run `npx -y chrome-devtools-axi click @<uid for button "Create">`. The note appears in the Other list.
- **Confirm persistence.** Run `npx -y chrome-devtools-axi click @<uid for the note "herdr-web verify note">`, then `npx -y chrome-devtools-axi open "$APP_URL"`, run `npx -y chrome-devtools-axi snapshot`, and run `npx -y chrome-devtools-axi click @<uid for "Notes">` to reopen Notes, then assert the title/body. Also run `curl --fail "http://127.0.0.1:$BRIDGE_PORT/api/notes" >"$ARTIFACT_DIR/notes.json"` and assert the note ID/title is present.
- **Preview and attach.** Run `npx -y chrome-devtools-axi click @<uid for "Preview">` and assert the rendered Markdown. Take a fresh snapshot, run `npx -y chrome-devtools-axi click @<uid for "Edit">`, take another snapshot, then run `npx -y chrome-devtools-axi click @<uid for "Attach to current pane">` and assert the note moves into the pane-note tabs. Use a fresh snapshot and `npx -y chrome-devtools-axi click @<uid for "Detach note">` to restore the detached fixture state.
- **Clean the fixture.** Run `npx -y chrome-devtools-axi click @<uid for "Delete note">`, take a fresh snapshot, and run `npx -y chrome-devtools-axi click @<uid for the visible delete confirmation>`. Run `curl --fail "http://127.0.0.1:$BRIDGE_PORT/api/notes"` again and assert the unique note is absent. Keep the screenshots and API response as evidence.
- **Proof.** Run `npx -y chrome-devtools-axi snapshot >"$ARTIFACT_DIR/notes.aria.txt"` and `npx -y chrome-devtools-axi screenshot "$ARTIFACT_DIR/notes.png"`, and retain the read-only `notes.json` response. A final screen with only an empty editor is not proof of persistence.

## Gotchas

- Note edits autosave after a short delay. Wait for the editor/list state or a read-only list response, not a fixed sleep alone.
- The editor has no ordinary `Save` button. A dirty edit is pending until the autosave request completes.
- Notes are bridge-owned state and can be visible to other clients. Use a unique title and delete it through the UI after evidence capture.
- Archived and deleted notes are hidden from the default list. Enable the matching filter before verifying Restore.
- A note conflict shows `This note changed elsewhere` with `Overwrite` and `Use server`; do not overwrite another user's note during verification.
- The Notes button is absent when the client feature is Off. Enable Notes through the visible Settings → Features control rather than changing storage directly.
