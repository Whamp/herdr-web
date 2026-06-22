import { describe, expect, it, vi } from "vitest";
import { applyTerminalClipboardShortcut } from "./terminalRenderer";

describe("applyTerminalClipboardShortcut", () => {
  it("should copy selected terminal text to the clipboard", async () => {
    // Arrange
    const terminal = terminalStub({ selection: "selected text" });
    const clipboard = clipboardStub();

    // Act
    await applyTerminalClipboardShortcut("copy", terminal, clipboard);

    // Assert
    expect(clipboard.writeText).toHaveBeenCalledWith("selected text");
    expect(terminal.paste).not.toHaveBeenCalled();
  });

  it("should paste clipboard text through Ghostty paste handling", async () => {
    // Arrange
    const terminal = terminalStub();
    const clipboard = clipboardStub({ text: "hello\nworld" });

    // Act
    await applyTerminalClipboardShortcut("paste", terminal, clipboard);

    // Assert
    expect(terminal.paste).toHaveBeenCalledWith("hello\nworld");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
});

// Helpers

function terminalStub({ selection = "" } = {}) {
  return {
    getSelection: vi.fn(() => selection),
    paste: vi.fn(),
  };
}

function clipboardStub({ text = null }: { text?: string | null } = {}) {
  return {
    readText: vi.fn(async () => text),
    writeText: vi.fn(async () => undefined),
  };
}
