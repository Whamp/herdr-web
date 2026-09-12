# Terminal controls

Terminal controls attach the selected pane to the browser, show its rendered screen, accept command text, support stage/send behavior, refit the terminal, expose mobile key controls, open selected URLs, and upload files into the active terminal input.

## Sub-features

- `terminal-attach` connects the selected pane's terminal to the `Terminal` region.
- `command-send` sends text with `Send command` or sends Enter with `Send enter`.
- `command-stage` stages text with `Stage command in terminal` before sending it.
- `terminal-refit` sends a fresh fit/resize request through `Refit terminal`.
- `mobile-keys` exposes quick keys, more keys, and the composed-key controls on compact/touch layouts.
- `url-actions` opens a selected terminal URL through `Selected URL actions`.
- `upload-insert` uploads a file through `Upload file` and inserts the returned path into the command input.

## How to get to it (user POV)

- Select a pane from `Agents` or `Tabs`; the app opens its terminal in the `Terminal` region.
- Focus the native command input at the bottom of the terminal. It is `.term-native-input`; its rendered control is an input or textarea depending on the composer preference.
- Enter a command and choose `Send command`, or leave the input empty and choose `Send enter`.
- Enter text and choose `Stage command in terminal` to stage it without sending.
- Choose `Refit terminal` beside the selected pane title.
- On a compact/touch viewport, choose `Upload file`, `Show more keys`, `Focus terminal keyboard`, or `Compose terminal key`.
- Select a terminal hyperlink to open `Selected URL actions`, then choose `Open` or `Close`.

## Driving it with chrome-devtools-axi

Preconditions:

- Doctor is green and the selected pane has a terminal ID in the bridge snapshot.
- The `Terminal` region reports a connected screen rather than a connection error.
- Command input is enabled. Use a harmless command such as `printf herdr-web-verify` and capture its visible output.

- **Attach and inspect.** Run `npx -y chrome-devtools-axi snapshot` after selecting the pane. Require the `Terminal` region and a connected screen status before typing.
- **Send a command.** Run `npx -y chrome-devtools-axi eval "() => { document.querySelector('.term-native-input').focus(); return 'focused'; }"`, then `npx -y chrome-devtools-axi type "printf herdr-web-verify"` and a fresh `npx -y chrome-devtools-axi click @<uid for "Send command">`. The terminal screen contains `herdr-web-verify`; capture the action and output, not only the final screen.
- **Stage a command.** Run `npx -y chrome-devtools-axi eval "() => { document.querySelector('.term-native-input').focus(); return 'focused'; }"`, then `npx -y chrome-devtools-axi type "printf herdr-web-stage"` and a fresh `npx -y chrome-devtools-axi click @<uid for "Stage command in terminal">`. The command remains in the input while the terminal screen has not received it. Restore the input with a fresh `Send command` click or clear it before cleanup.
- **Refit.** Run `npx -y chrome-devtools-axi snapshot`, then `npx -y chrome-devtools-axi click @<uid for "Refit terminal">` and capture the terminal screen plus any resize/network evidence. A valid click is not proof if the terminal is disconnected.
- **Use a mobile control.** Run `npx -y chrome-devtools-axi resize 390 844`, take a fresh `npx -y chrome-devtools-axi snapshot`, and run `npx -y chrome-devtools-axi click @<uid for "Show more keys">`. The `Direct terminal keys` or `More terminal keys` group appears. Take another snapshot, then run `npx -y chrome-devtools-axi click @<uid for "Hide more keys">`.
- **Upload.** Create a disposable fixture with `printf upload-herdr-web-verify > /tmp/herdr-web-upload-verify.txt`, take a fresh snapshot, and run `npx -y chrome-devtools-axi upload @<uid for "Upload file"> /tmp/herdr-web-upload-verify.txt`. Assert the bridge response path appears in the command input, then verify the file exists in the configured upload directory before deleting the fixture.
- **Proof.** Run `npx -y chrome-devtools-axi snapshot >"$ARTIFACT_DIR/terminal-controls.aria.txt"`, `npx -y chrome-devtools-axi screenshot "$ARTIFACT_DIR/terminal-controls.png"`, and `curl --fail "http://127.0.0.1:$BRIDGE_PORT/api/snapshot" >"$ARTIFACT_DIR/terminal-controls.snapshot.json"`. Keep the command/output transcript and any upload-directory listing with those files.

## Gotchas

- Terminal attach is shared per `terminal_id`; multiple browser clients observe the same session. Do not send commands to a pane owned by another verification run.
- `Send command` and `Send enter` have different accessible names. The name changes with whether the input contains text.
- The stage button is disabled for an empty input and does not send text. Assert the staged value before clearing it.
- Mobile key buttons preserve terminal input focus on touch but may be hidden until `Show more keys` is selected.
- Upload conflicts can ask whether to replace a path unless the Terminal setting `Automatically rename conflicting uploads` is enabled. Use a unique fixture filename.
- A terminal screen rendered by Ghostty is not an independent side effect. Pair visible output with the command action and, when relevant, the bridge/upload result.
