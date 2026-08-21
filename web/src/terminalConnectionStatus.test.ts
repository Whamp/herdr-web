import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_TERMINAL_ATTACH_CONFLICT_RETRIES,
  TERMINAL_CONNECTION_OVERLAY_DELAY_MS,
  isNonRetryableTerminalClose,
  parseTerminalCloseMessage,
  terminalCloseDisposition,
  terminalConnectionCopy,
  terminalConnectionOverlayDelayMs,
} from "./terminalConnectionStatus";
import type { TerminalCloseMessage } from "./terminalConnectionStatus";
import { TerminalCloseCause } from "./enums";

interface FixtureCause {
  cause: string;
  origin: string;
  retry: string;
  example_daemon_prose: string | null;
}

function closeFixture(): { causes: FixtureCause[] } {
  // The same contract file the Rust serializer tests read; if this file and
  // Rust disagree, one of these tests goes red.
  return JSON.parse(
    readFileSync(new URL("../../protocol/terminal-close-causes.json", import.meta.url), "utf8"),
  ) as { causes: FixtureCause[] };
}

describe("terminalConnectionStatus", () => {
  it("parses typed close messages", () => {
    expect(parseTerminalCloseMessage('{"type":"closed","cause":"taken_over","detail":"x"}')).toEqual({
      cause: "taken_over",
      detail: "x",
    });
    expect(
      parseTerminalCloseMessage(JSON.stringify({ type: "notice", reason: "ignored" })),
    ).toBeNull();
    expect(parseTerminalCloseMessage("not json")).toBeNull();
    expect(parseTerminalCloseMessage('{"type":"closed"}')).toEqual({
      cause: "unknown",
      detail: "",
    });
  });

  it("maps every fixture cause to the disposition recorded in the fixture", () => {
    for (const entry of closeFixture().causes) {
      const disposition = terminalCloseDisposition(entry.cause as TerminalCloseCause);
      expect(disposition, `cause ${entry.cause}`).toBe(entry.retry);
    }
  });

  it("serializes every fixture cause through a bridge-shaped frame", () => {
    for (const entry of closeFixture().causes) {
      const frame = JSON.stringify({
        type: "closed",
        cause: entry.cause,
        detail: `detail for ${entry.cause}`,
      });
      expect(parseTerminalCloseMessage(frame), `frame for ${entry.cause}`).toEqual({
        cause: entry.cause,
        detail: `detail for ${entry.cause}`,
      });
    }
  });

  it("degrades unknown future causes to the normal reconnect path", () => {
    const close = parseTerminalCloseMessage(
      '{"type":"closed","cause":"something_new_from_a_newer_bridge","detail":""}',
    );
    expect(close).toEqual({ cause: "unknown", detail: "" });
    expect(terminalCloseDisposition(close!.cause)).toBe("reconnect");
    expect(isNonRetryableTerminalClose(close)).toBe(false);
  });

  it("stops reconnection only for stop-disposition causes", () => {
    const stops = closeFixture()
      .causes.filter((entry) => entry.retry === "stop")
      .map((entry) => entry.cause as TerminalCloseCause);
    expect(stops.length).toBeGreaterThan(0);
    for (const cause of stops) {
      expect(isNonRetryableTerminalClose({ cause, detail: "" })).toBe(true);
    }
    expect(isNonRetryableTerminalClose({ cause: TerminalCloseCause.DaemonClosed, detail: "" })).toBe(false);
    expect(isNonRetryableTerminalClose({ cause: TerminalCloseCause.OutputLagged, detail: "" })).toBe(false);
    expect(isNonRetryableTerminalClose({ cause: TerminalCloseCause.TransportFailed, detail: "" })).toBe(false);
    expect(isNonRetryableTerminalClose(null)).toBe(false);
  });

  it("keeps the attach-conflict retry budget positive", () => {
    expect(terminalCloseDisposition(TerminalCloseCause.AttachConflict)).toBe("attach-conflict");
    expect(MAX_TERMINAL_ATTACH_CONFLICT_RETRIES).toBeGreaterThan(0);
  });

  it("maps terminal connection states and close causes to status copy", () => {
    const conflict: TerminalCloseMessage = { cause: TerminalCloseCause.AttachConflict, detail: "" };
    const takeover: TerminalCloseMessage = { cause: TerminalCloseCause.TakenOver, detail: "someone else" };
    expect(terminalConnectionCopy("connecting", null)).toBe("Connecting");
    expect(terminalConnectionCopy("connecting", null, true)).toBe("Reconnecting");
    expect(terminalConnectionCopy("closed", conflict)).toBe("Attached elsewhere");
    expect(terminalConnectionCopy("closed", takeover)).toBe("Detached elsewhere");
    expect(terminalConnectionCopy("closed", { cause: TerminalCloseCause.TerminalGone, detail: "" })).toBe(
      "Detached",
    );
    expect(terminalConnectionCopy("closed", null)).toBe("Detached");
    expect(terminalConnectionCopy("error", null)).toBe("Connection failed");
  });

  it("delays only transient connecting overlays", () => {
    expect(terminalConnectionOverlayDelayMs("connecting", true)).toBe(
      TERMINAL_CONNECTION_OVERLAY_DELAY_MS,
    );
    expect(terminalConnectionOverlayDelayMs("connecting", false)).toBe(0);
    expect(terminalConnectionOverlayDelayMs("closed", true)).toBe(0);
    expect(terminalConnectionOverlayDelayMs("error", true)).toBe(0);
    expect(terminalConnectionOverlayDelayMs("attached", true)).toBe(0);
    expect(terminalConnectionOverlayDelayMs("idle", true)).toBe(0);
  });
});
