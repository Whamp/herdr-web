export type KeybindingProfile = "auto" | "macos" | "windows" | "linux" | "legacy";
export type ResolvedKeybindingProfile = Exclude<KeybindingProfile, "auto">;
export type TerminalClipboardShortcutAction = "copy" | "paste";

export const DEFAULT_KEYBINDING_PROFILE: KeybindingProfile = "auto";
export const KEYBINDING_PROFILE_OPTIONS = ["auto", "macos", "windows", "linux", "legacy"] as const;

export const KEYBINDING_PROFILE_LABELS: Record<KeybindingProfile, string> = {
  auto: "Auto",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  legacy: "Legacy",
};

export const KEYBINDING_PROFILE_DESCRIPTIONS: Record<KeybindingProfile, string> = {
  auto: "Detect this browser's OS and use the matching shortcuts.",
  macos: "Use Command for app shortcuts and macOS terminal clipboard defaults.",
  windows: "Use Alt for app shortcuts and Windows terminal clipboard defaults.",
  linux: "Use Alt for app shortcuts and Linux terminal clipboard defaults.",
  legacy: "Accept either Meta/Super or Alt for app shortcuts, matching older Herdr Web builds.",
};

type PlatformSource = {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
};

type ShortcutEvent = Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">;

export function parseKeybindingProfile(value: unknown): KeybindingProfile {
  return KEYBINDING_PROFILE_OPTIONS.includes(value as KeybindingProfile)
    ? (value as KeybindingProfile)
    : DEFAULT_KEYBINDING_PROFILE;
}

export function resolveKeybindingProfile(
  profile: KeybindingProfile,
  platformSource: PlatformSource = navigator,
): ResolvedKeybindingProfile {
  return profile === "auto" ? detectKeybindingProfile(platformSource) : profile;
}

export function detectKeybindingProfile(platformSource: PlatformSource = navigator): ResolvedKeybindingProfile {
  const platform = [
    platformSource.userAgentData?.platform,
    platformSource.platform,
    platformSource.userAgent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/mac|iphone|ipad|ipod/.test(platform)) {
    return "macos";
  }
  if (/win/.test(platform)) {
    return "windows";
  }
  if (/linux|x11|wayland|android|cros/.test(platform)) {
    return "linux";
  }
  return "linux";
}

export function isAppShortcutModifier(
  event: ShortcutEvent,
  profile: KeybindingProfile,
  platformSource: PlatformSource = navigator,
) {
  const resolved = resolveKeybindingProfile(profile, platformSource);
  if (event.ctrlKey) {
    return false;
  }
  if (resolved === "legacy") {
    return event.metaKey !== event.altKey;
  }
  if (resolved === "macos") {
    return event.metaKey && !event.altKey;
  }
  return event.altKey && !event.metaKey;
}

export function terminalClipboardShortcutAction(
  event: ShortcutEvent,
  profile: KeybindingProfile,
  platformSource: PlatformSource = navigator,
): TerminalClipboardShortcutAction | null {
  if (event.altKey) {
    return null;
  }
  if (event.key === "Insert" && event.ctrlKey && !event.shiftKey && !event.metaKey) {
    return "copy";
  }
  if (event.key === "Insert" && event.shiftKey && !event.ctrlKey && !event.metaKey) {
    return "paste";
  }
  if (event.metaKey && !event.ctrlKey && !event.shiftKey) {
    return terminalClipboardCodeAction(event.code);
  }

  const resolved = resolveKeybindingProfile(profile, platformSource);
  if (resolved !== "macos" && event.ctrlKey && event.shiftKey && !event.metaKey) {
    return terminalClipboardCodeAction(event.code);
  }
  return null;
}

function terminalClipboardCodeAction(code: string): TerminalClipboardShortcutAction | null {
  if (code === "KeyC") {
    return "copy";
  }
  if (code === "KeyV") {
    return "paste";
  }
  return null;
}
