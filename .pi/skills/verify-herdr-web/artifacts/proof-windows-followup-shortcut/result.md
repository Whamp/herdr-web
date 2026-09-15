# Windows follow-up shortcut verification

- Feature: `terminal-controls` / direct terminal input
- Lab session: isolated named Firstmate Herdr lab, not the default session
- App: Vite `http://127.0.0.1:15179`
- Bridge: `http://127.0.0.1:18791`
- Browser: isolated headless Chromium profile on Linux

## Result

The pre-fix browser path delivered `Ctrl+Enter` to the page, but Ghostty encoded it as the CSI-u sequence beginning `1b5b` (`ESC [`). The remaining bytes were visible in the terminal transcript as `27;5;13~`. That is not the legacy Alt+Enter follow-up sequence.

The same browser delivered `Alt+Enter` as `1b0a` after the PTY input mapping converted carriage return to line feed. This is the working comparison path. The repository's mobile chord encoder independently defines Alt+Enter as `\x1B\r`.

After the fix, `Ctrl+Enter` produced `CTRL_FOLLOWUP_BYTES=1b0a` through the browser, WebSocket, bridge, isolated Herdr daemon, and PTY. This matches the observed Alt+Enter bytes at the PTY boundary. The accessibility snapshot and screenshot capture the selected lab terminal after the action.

## Limitation

This Linux host cannot reproduce physical Windows/browser interception of Alt+Enter. The browser proof therefore starts at the earliest application-controlled boundary: a Ctrl+Enter key event delivered to the terminal input. It does not claim to reproduce Windows dropping Alt+Enter before the page receives it.
