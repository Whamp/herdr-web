/**
 * Machine-readable close causes sent by the bridge in the terminal
 * `closed` frame. The vocabulary and each cause's retry disposition are
 * pinned by `protocol/terminal-close-causes.json`, which the Rust
 * serializer tests also read; do not add or rename a cause without
 * updating that file.
 */
export enum TerminalCloseCause {
  AttachConflict = "attach_conflict",
  TakenOver = "taken_over",
  TerminalGone = "terminal_gone",
  PendingDetach = "pending_detach",
  DaemonClosed = "daemon_closed",
  OutputLagged = "output_lagged",
  TransportFailed = "transport_failed",
}
