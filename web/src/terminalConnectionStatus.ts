import { TerminalCloseCause } from "./enums";

export { TerminalCloseCause };

export type TerminalConnectionState = "idle" | "connecting" | "attached" | "closed" | "error";

export const TERMINAL_CONNECTION_OVERLAY_DELAY_MS = 500;

const KNOWN_TERMINAL_CLOSE_CAUSES: ReadonlySet<string> = new Set<string>(
  Object.values(TerminalCloseCause),
);

/** What the client should do after a close with a given cause. */
export type TerminalCloseDisposition = "attach-conflict" | "reconnect" | "stop";

export interface TerminalCloseMessage {
  /** `"unknown"` for causes from a newer bridge this build does not know. */
  cause: TerminalCloseCause | "unknown";
  detail: string;
}

export function parseTerminalCloseMessage(message: string): TerminalCloseMessage | null {
  try {
    const parsed = JSON.parse(message) as {
      type?: unknown;
      cause?: unknown;
      detail?: unknown;
    };
    if (parsed.type !== "closed") {
      return null;
    }
    const cause =
      typeof parsed.cause === "string" && KNOWN_TERMINAL_CLOSE_CAUSES.has(parsed.cause)
        ? (parsed.cause as TerminalCloseCause)
        : "unknown";
    return { cause, detail: typeof parsed.detail === "string" ? parsed.detail : "" };
  } catch {
    return null;
  }
}

/**
 * "Already attached" rejections are usually transient — a bridge restart or
 * reattach can race the daemon's cleanup of the previous connection — so the
 * client retries them a few times before treating them as a genuine external
 * attach conflict.
 */
export const MAX_TERMINAL_ATTACH_CONFLICT_RETRIES = 3;

export function terminalCloseDisposition(cause: TerminalCloseMessage["cause"]) {
  switch (cause) {
    case TerminalCloseCause.AttachConflict:
      return "attach-conflict" as const;
    case TerminalCloseCause.TakenOver:
    case TerminalCloseCause.TerminalGone:
      // A takeover or a vanished terminal is final for this attach; only a
      // human starting a new session should bring the terminal back.
      return "stop" as const;
    default:
      // Everything else — including unknown future causes — follows the
      // normal reconnection path with backoff.
      return "reconnect" as const;
  }
}

export function isNonRetryableTerminalClose(close: TerminalCloseMessage | null) {
  return close !== null && terminalCloseDisposition(close.cause) === "stop";
}

export function terminalConnectionCopy(
  state: TerminalConnectionState,
  close: TerminalCloseMessage | null,
  hasAttachedForTerminal = false,
) {
  if (close?.cause === TerminalCloseCause.AttachConflict) {
    return "Attached elsewhere";
  }
  if (close?.cause === TerminalCloseCause.TakenOver) {
    return "Detached elsewhere";
  }
  switch (state) {
    case "connecting":
      return hasAttachedForTerminal ? "Reconnecting" : "Connecting";
    case "closed":
      return "Detached";
    case "error":
      return "Connection failed";
    case "idle":
    case "attached":
      return "";
  }
}

export function terminalConnectionOverlayDelayMs(
  state: TerminalConnectionState,
  delayConnecting: boolean,
) {
  return state === "connecting" && delayConnecting ? TERMINAL_CONNECTION_OVERLAY_DELAY_MS : 0;
}
