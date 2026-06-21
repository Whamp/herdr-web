import { describe, expect, it } from "vitest";
import {
  isNonRetryableTerminalClose,
  parseTerminalCloseReason,
  terminalConnectionCopy,
} from "./terminalConnectionStatus";

describe("terminalConnectionStatus", () => {
  it("parses terminal close reason messages", () => {
    expect(
      parseTerminalCloseReason(
        JSON.stringify({ type: "closed", reason: "terminal attach taken over" }),
      ),
    ).toBe("terminal attach taken over");
    expect(
      parseTerminalCloseReason(JSON.stringify({ type: "notice", reason: "ignored" })),
    ).toBeNull();
    expect(parseTerminalCloseReason("not json")).toBeNull();
  });

  it("classifies non-retryable terminal attach close reasons", () => {
    expect(isNonRetryableTerminalClose("terminal already has an attached client")).toBe(true);
    expect(isNonRetryableTerminalClose("terminal attach taken over")).toBe(true);
    expect(isNonRetryableTerminalClose("terminal attach failed: terminal abc missing")).toBe(true);
    expect(isNonRetryableTerminalClose("temporary network close")).toBe(false);
    expect(isNonRetryableTerminalClose(null)).toBe(false);
  });

  it("maps terminal connection states to status copy", () => {
    expect(terminalConnectionCopy("connecting", null)).toBe("Connecting");
    expect(terminalConnectionCopy("connecting", null, true)).toBe("Reconnecting");
    expect(terminalConnectionCopy("closed", "terminal already has an attached client")).toBe(
      "Attached elsewhere",
    );
    expect(terminalConnectionCopy("closed", "terminal attach taken over")).toBe(
      "Detached elsewhere",
    );
    expect(terminalConnectionCopy("error", null)).toBe("Connection failed");
  });
});
