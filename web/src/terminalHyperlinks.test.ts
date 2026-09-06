import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Ghostty } from "ghostty-web";
import type { GhosttyTerminal } from "ghostty-web";
import { terminalHyperlinkAt, terminalHyperlinkInSelection } from "./terminalHyperlinks";

const DOWNLOAD_URL = "http://100.112.72.93:5189/herdr-web-v18-c0055e9-debug.apk";

let wasmUrl: string;
let terminal: GhosttyTerminal;

beforeAll(async () => {
  // Use the installed package's real WASM, not a fake returning the expected URI.
  const wasm = await readFile(
    new URL("../node_modules/ghostty-web/ghostty-vt.wasm", import.meta.url),
  );
  wasmUrl = `data:application/wasm;base64,${wasm.toString("base64")}`;
});

beforeEach(async () => {
  const ghostty = await Ghostty.load(wasmUrl);
  terminal = ghostty.createTerminal(80, 3);
});

afterEach(() => {
  terminal.free();
});

function writeTerminalHyperlink(url: string, label: string) {
  terminal.write(`\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`);
}

describe("terminal hyperlinks with real Ghostty WASM", () => {
  it("resolves the hidden destination of a labelled download link", () => {
    writeTerminalHyperlink(DOWNLOAD_URL, "Download APK");

    expect(terminal.getLine(0)?.[0].hyperlink_id).toBeGreaterThan(0);
    expect(terminalHyperlinkAt(terminal, 0, 5)).toBe(DOWNLOAD_URL);
    expect(terminalHyperlinkInSelection(terminal, { row: 0, col: 0 }, { row: 0, col: 11 })).toBe(
      DOWNLOAD_URL,
    );
    expect(terminalHyperlinkAt(terminal, 0, 20)).toBeNull();
  });

  it("uses the selected cell's destination rather than matching its visible label", () => {
    writeTerminalHyperlink("https://first.example/", "Download");
    terminal.write(" ");
    writeTerminalHyperlink(DOWNLOAD_URL, "Download");

    expect(terminalHyperlinkAt(terminal, 0, 2)).toBe("https://first.example/");
    expect(terminalHyperlinkAt(terminal, 0, 12)).toBe(DOWNLOAD_URL);
    expect(terminalHyperlinkInSelection(terminal, { row: 0, col: 10 }, { row: 0, col: 14 })).toBe(
      DOWNLOAD_URL,
    );
  });

  it("resolves both scrollback and active rows using absolute buffer positions", () => {
    writeTerminalHyperlink(DOWNLOAD_URL, "Download");
    terminal.write("\r\nsecond\r\nthird\r\n");
    writeTerminalHyperlink("https://active.example/", "Current");

    expect(terminal.getScrollbackLength()).toBe(1);
    expect(terminalHyperlinkAt(terminal, 0, 0)).toBe(DOWNLOAD_URL);
    expect(terminalHyperlinkAt(terminal, 3, 0)).toBe("https://active.example/");
    expect(terminalHyperlinkInSelection(terminal, { row: 0, col: 1 }, { row: 0, col: 4 })).toBe(
      DOWNLOAD_URL,
    );
  });

  it("keeps alternate-screen links separate from normal-screen history", () => {
    writeTerminalHyperlink(DOWNLOAD_URL, "Normal");
    terminal.write("\r\na\r\nb\r\nc\x1b[?1049h\x1b[H");
    writeTerminalHyperlink("https://alternate.example/", "Alternate");

    expect(terminal.getScrollbackLength()).toBe(0);
    expect(terminalHyperlinkAt(terminal, 0, 2)).toBe("https://alternate.example/");
    terminal.write("\x1b[?1049l");
    expect(terminalHyperlinkAt(terminal, 0, 2)).toBe(DOWNLOAD_URL);
  });

  it("finds partial and reversed selections of a wrapped label", () => {
    terminal.resize(12, 6);
    writeTerminalHyperlink(DOWNLOAD_URL, "Download the new Android app");

    expect(terminalHyperlinkInSelection(terminal, { row: 1, col: 3 }, { row: 0, col: 10 })).toBe(
      DOWNLOAD_URL,
    );
    expect(terminalHyperlinkAt(terminal, 2, 1)).toBe(DOWNLOAD_URL);
  });

  it("does not infer a destination from plain text", () => {
    terminal.write("Download APK or https://example.com");

    expect(
      terminalHyperlinkInSelection(terminal, { row: 0, col: 0 }, { row: 0, col: 40 }),
    ).toBeNull();
  });

  it("does not retain stale destinations after erasure or replacement", () => {
    writeTerminalHyperlink(DOWNLOAD_URL, "Download");
    terminal.write("\x1b[H\x1b[2KPlain");
    expect(terminalHyperlinkAt(terminal, 0, 2)).toBeNull();
    terminal.write("\x1b[H");
    writeTerminalHyperlink("https://replacement.example/", "New");
    expect(terminalHyperlinkAt(terminal, 0, 2)).toBe("https://replacement.example/");
  });

  it("preserves hyperlink metadata across fragmented terminal writes", () => {
    const bytes = new TextEncoder().encode(`\x1b]8;;${DOWNLOAD_URL}\x07Download\x1b]8;;\x07`);
    for (const byte of bytes) {
      terminal.write(Uint8Array.of(byte));
    }
    expect(terminalHyperlinkAt(terminal, 0, 2)).toBe(DOWNLOAD_URL);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///etc/passwd",
    "mailto:x@example.com",
    "/tmp/file",
    "http://",
  ])("does not offer an unsafe or invalid destination: %s", (url) => {
    writeTerminalHyperlink(url, "Download APK");
    expect(terminalHyperlinkAt(terminal, 0, 2)).toBeNull();
    expect(
      terminalHyperlinkInSelection(terminal, { row: 0, col: 0 }, { row: 0, col: 11 }),
    ).toBeNull();
  });

  it("does not expose concealed hyperlink cells through selection", () => {
    terminal.write("\x1b[8m");
    writeTerminalHyperlink(DOWNLOAD_URL, "Hidden");
    expect(
      terminalHyperlinkInSelection(terminal, { row: 0, col: 0 }, { row: 0, col: 5 }),
    ).toBeNull();
  });
});
