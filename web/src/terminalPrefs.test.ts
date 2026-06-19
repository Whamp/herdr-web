import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  MAX_TERMINAL_FONT_SIZE_PX,
  MIN_TERMINAL_FONT_SIZE_PX,
  parseTerminalFontSizePx,
} from "./terminalPrefs";

describe("terminal preferences", () => {
  it("parses and clamps the terminal font size", () => {
    expect(parseTerminalFontSizePx(13)).toBe(13);
    expect(parseTerminalFontSizePx(16.7)).toBe(17);
    expect(parseTerminalFontSizePx(4)).toBe(MIN_TERMINAL_FONT_SIZE_PX);
    expect(parseTerminalFontSizePx(999)).toBe(MAX_TERMINAL_FONT_SIZE_PX);
  });

  it("falls back for invalid terminal font sizes", () => {
    expect(parseTerminalFontSizePx(null)).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
    expect(parseTerminalFontSizePx("13")).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
    expect(parseTerminalFontSizePx(Number.NaN)).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });
});
