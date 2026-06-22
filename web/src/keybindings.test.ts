import { describe, expect, it } from "vitest";
import {
  detectKeybindingProfile,
  isAppShortcutModifier,
  parseKeybindingProfile,
  terminalClipboardShortcutAction,
} from "./keybindings";

describe("keybinding profiles", () => {
  it("should parse persisted profile values", () => {
    expect(parseKeybindingProfile("auto")).toBe("auto");
    expect(parseKeybindingProfile("macos")).toBe("macos");
    expect(parseKeybindingProfile("windows")).toBe("windows");
    expect(parseKeybindingProfile("linux")).toBe("linux");
    expect(parseKeybindingProfile("legacy")).toBe("legacy");
    expect(parseKeybindingProfile("omarchy")).toBe("auto");
  });

  it("should detect common browser OS platform strings", () => {
    expect(detectKeybindingProfile({ platform: "MacIntel" })).toBe("macos");
    expect(detectKeybindingProfile({ platform: "Win32" })).toBe("windows");
    expect(detectKeybindingProfile({ platform: "Linux x86_64" })).toBe("linux");
    expect(detectKeybindingProfile({ userAgentData: { platform: "macOS" } })).toBe("macos");
  });

  it("should use OS-native app shortcut modifiers by default", () => {
    expect(isAppShortcutModifier(keyEvent({ metaKey: true }), "auto", { platform: "MacIntel" })).toBe(true);
    expect(isAppShortcutModifier(keyEvent({ altKey: true }), "auto", { platform: "Linux x86_64" })).toBe(true);
    expect(isAppShortcutModifier(keyEvent({ altKey: true }), "auto", { platform: "Win32" })).toBe(true);
  });

  it("should let the legacy profile accept either Meta/Super or Alt for app shortcuts", () => {
    expect(isAppShortcutModifier(keyEvent({ metaKey: true }), "legacy")).toBe(true);
    expect(isAppShortcutModifier(keyEvent({ altKey: true }), "legacy")).toBe(true);
    expect(isAppShortcutModifier(keyEvent({ metaKey: true, altKey: true }), "legacy")).toBe(false);
  });
});

describe("terminal clipboard shortcuts", () => {
  it("should support traditional terminal Insert clipboard shortcuts on every profile", () => {
    expect(terminalClipboardShortcutAction(keyEvent({ key: "Insert", ctrlKey: true }), "macos")).toBe("copy");
    expect(terminalClipboardShortcutAction(keyEvent({ key: "Insert", shiftKey: true }), "linux")).toBe("paste");
  });

  it("should support direct Super or Command copy and paste when the browser receives them", () => {
    expect(terminalClipboardShortcutAction(keyEvent({ code: "KeyC", key: "c", metaKey: true }), "linux")).toBe("copy");
    expect(terminalClipboardShortcutAction(keyEvent({ code: "KeyV", key: "v", metaKey: true }), "windows")).toBe("paste");
  });

  it("should support Ctrl+Shift copy and paste on non-macOS terminal profiles", () => {
    expect(terminalClipboardShortcutAction(keyEvent({ code: "KeyC", key: "C", ctrlKey: true, shiftKey: true }), "linux")).toBe("copy");
    expect(terminalClipboardShortcutAction(keyEvent({ code: "KeyV", key: "V", ctrlKey: true, shiftKey: true }), "windows")).toBe("paste");
    expect(terminalClipboardShortcutAction(keyEvent({ code: "KeyV", key: "V", ctrlKey: true, shiftKey: true }), "macos")).toBeNull();
  });

  it("should not steal shell control keys or app split shortcuts", () => {
    expect(terminalClipboardShortcutAction(keyEvent({ code: "KeyC", key: "c", ctrlKey: true }), "linux")).toBeNull();
    expect(terminalClipboardShortcutAction(keyEvent({ code: "KeyV", key: "v", ctrlKey: true }), "windows")).toBeNull();
    expect(terminalClipboardShortcutAction(keyEvent({ code: "KeyV", key: "V", metaKey: true, shiftKey: true }), "linux")).toBeNull();
    expect(terminalClipboardShortcutAction(keyEvent({ key: "Insert", ctrlKey: true, shiftKey: true }), "legacy")).toBeNull();
  });
});

// Helpers

type TestKeyEvent = Parameters<typeof terminalClipboardShortcutAction>[0];

function keyEvent(overrides: Partial<TestKeyEvent>): TestKeyEvent {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}
