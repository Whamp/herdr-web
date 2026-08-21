import { useCallback, type Dispatch, type SetStateAction, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import {
  DEFAULT_AGENT_FEATURES_IN_TABS,
  DEFAULT_CONTENT_INSET_BOTTOM_PX,
  DEFAULT_CONTENT_INSET_TOP_PX,
  DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT,
  DEFAULT_MULTI_HOST_SPACE_SELECTION,
  parseAgentFeaturesInTabs,
  parseContentInsetBottomPx,
  parseContentInsetTopPx,
  parseMobileControlsScalePercent,
  parseMultiHostSpaceSelection,
} from "./displayPrefs";
import {
  DEFAULT_MOBILE_COMMAND_ENTER_NEWLINE,
  DEFAULT_MOBILE_COMMAND_EXPANDING_INPUT,
  DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT,
  DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR,
  DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
  DEFAULT_MOBILE_TERMINAL_TAP_TARGET,
  parseMobileCommandEnterNewline,
  parseMobileCommandExpandingInput,
  parseMobileKeyboardHideRefit,
  parseMobileLongPressBehavior,
  parseMobileTouchSelectionEndpointTimeoutMs,
  parseMobileTerminalTapTarget,
} from "./mobileTerminalPrefs";
import type {
  MobileLongPressBehavior,
  MobileTerminalTapTarget,
  MobileTouchSelectionEndpointTimeoutMs,
} from "./mobileTerminalPrefs";
import {
  DEFAULT_TERMINAL_INPUT_BATCH_DELAY_MS,
  DEFAULT_TERMINAL_INPUT_TRANSPORT,
  parseTerminalInputBatchDelayMs,
  parseTerminalInputTransport,
  type TerminalInputTransport,
} from "./terminalInputTransport";
import {
  DEFAULT_TERMINAL_OUTPUT_COALESCE_MS,
  parseTerminalOutputCoalesceMs,
} from "./terminalOutputCoalescing";
import {
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  parseTerminalFontSizePx,
} from "./terminalPrefs";
import {
  DEFAULT_TERMINAL_SCREEN_READER_TEXT,
  parseTerminalScreenReaderText,
} from "./terminalAccessibleText";

/**
 * The app preferences module: owns the stored schema, its migrations, the
 * browser and Capacitor storage adapters, and the live preference state.
 * Consumers read grouped values and update through one action; storage
 * details never leak past this file. The pure parsers in displayPrefs.ts /
 * mobileTerminalPrefs.ts / terminalPrefs.ts / terminalInputTransport.ts are
 * internal validation helpers behind this module's interface.
 */

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export type Scope = "space" | "all";
export type HostScope = "selected" | "all";
export type SidebarView = "agents" | "tabs" | "notes";
export type AgentSort = "attention" | "status" | "workspace" | "lastStatusChange";
export type AgentGroup = "none" | "host" | "workspace" | "hostWorkspace";
export type SpaceGroup = "none" | "host";

export type DisplayPrefs = {
  hostScope: HostScope;
  scope: Scope;
  sidebarView: SidebarView;
  agentSort: AgentSort;
  agentGroup: AgentGroup;
  combineMatchingWorkspaceNames: boolean;
  collapsedSidebarGroups: string[];
  spaceGroup: SpaceGroup;
  agentPinnedOnly: boolean;
  agentActiveOnly: boolean;
  agentFeaturesInTabs: boolean;
  multiHostSpaceSelection: boolean;
  sidebarWidth: number;
  notesPanelWidth: number;
  notesListPaneWidth: number;
  notesListPaneCollapsed: boolean;
  notesEnabled: boolean;
  notesPanelOpen: boolean;
  sidebarOpen: boolean;
  terminalFontSizePx: number;
  terminalScreenReaderText: boolean;
  terminalInputTransport: TerminalInputTransport;
  terminalInputBatchDelayMs: number;
  terminalOutputCoalesceMs: number;
  contentInsetTopPx: number;
  contentInsetBottomPx: number;
  mobileControlsScalePercent: number;
  mobileTerminalTapTarget: MobileTerminalTapTarget;
  mobileLongPressBehavior: MobileLongPressBehavior;
  mobileTouchSelectionEndpointTimeoutMs: MobileTouchSelectionEndpointTimeoutMs;
  mobileKeyboardHideRefit: boolean;
  mobileCommandExpandingInput: boolean;
  mobileCommandEnterNewline: boolean;
};

export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 260;
export const MAX_SIDEBAR_WIDTH = 560;
export const DEFAULT_NOTES_PANEL_WIDTH = 560;
export const MIN_NOTES_PANEL_WIDTH = 420;
export const MAX_NOTES_PANEL_WIDTH = 840;
export const DEFAULT_NOTES_LIST_PANE_WIDTH = 240;
export const MIN_NOTES_LIST_PANE_WIDTH = 200;
export const MAX_NOTES_LIST_PANE_WIDTH = 420;
const DISPLAY_PREFS_KEY = "herdr.mobileWeb.displayPrefs.v2";
const LEGACY_DISPLAY_PREFS_KEY = "herdr.mobileWeb.displayPrefs.v1";

export const MAX_COLLAPSED_SIDEBAR_GROUPS = 4096;

function readDisplayPrefs(): DisplayPrefs {
  const fallback: DisplayPrefs = {
    hostScope: "selected",
    scope: "space",
    sidebarView: "agents",
    agentSort: "attention",
    agentGroup: "none",
    combineMatchingWorkspaceNames: false,
    collapsedSidebarGroups: [],
    spaceGroup: "none",
    agentPinnedOnly: false,
    agentActiveOnly: false,
    agentFeaturesInTabs: DEFAULT_AGENT_FEATURES_IN_TABS,
    multiHostSpaceSelection: DEFAULT_MULTI_HOST_SPACE_SELECTION,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    notesPanelWidth: DEFAULT_NOTES_PANEL_WIDTH,
    notesListPaneWidth: DEFAULT_NOTES_LIST_PANE_WIDTH,
    notesListPaneCollapsed: true,
    notesEnabled: true,
    notesPanelOpen: false,
    sidebarOpen: true,
    terminalFontSizePx: DEFAULT_TERMINAL_FONT_SIZE_PX,
    terminalScreenReaderText: DEFAULT_TERMINAL_SCREEN_READER_TEXT,
    terminalInputTransport: DEFAULT_TERMINAL_INPUT_TRANSPORT,
    terminalInputBatchDelayMs: DEFAULT_TERMINAL_INPUT_BATCH_DELAY_MS,
    terminalOutputCoalesceMs: DEFAULT_TERMINAL_OUTPUT_COALESCE_MS,
    contentInsetTopPx: DEFAULT_CONTENT_INSET_TOP_PX,
    contentInsetBottomPx: DEFAULT_CONTENT_INSET_BOTTOM_PX,
    mobileControlsScalePercent: DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT,
    mobileTerminalTapTarget: DEFAULT_MOBILE_TERMINAL_TAP_TARGET,
    mobileLongPressBehavior: DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR,
    mobileTouchSelectionEndpointTimeoutMs: DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
    mobileKeyboardHideRefit: DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT,
    mobileCommandExpandingInput: DEFAULT_MOBILE_COMMAND_EXPANDING_INPUT,
    mobileCommandEnterNewline: DEFAULT_MOBILE_COMMAND_ENTER_NEWLINE,
  };
  try {
    const raw = window.localStorage.getItem(DISPLAY_PREFS_KEY);
    if (!raw) {
      return readLegacyDisplayPrefs(fallback);
    }
    const parsed = JSON.parse(raw) as Partial<DisplayPrefs> & {
      mobileTouchSelection?: unknown;
    };
    return parseDisplayPrefsValue(parsed, fallback);
  } catch {
    return fallback;
  }
}


export async function loadDisplayPrefs(): Promise<DisplayPrefs> {
  const localPrefs = readDisplayPrefs();
  if (!isNativeApp()) {
    return localPrefs;
  }
  try {
    const { value } = await Preferences.get({ key: DISPLAY_PREFS_KEY });
    if (value) {
      return parseDisplayPrefsValue(JSON.parse(value) as Partial<DisplayPrefs>, localPrefs);
    }
  } catch {
    // Fall back to browser storage backup.
  }
  return localPrefs;
}


function parseDisplayPrefsValue(
  parsed: Partial<DisplayPrefs> & { mobileTouchSelection?: unknown },
  fallback: DisplayPrefs,
): DisplayPrefs {
  const sidebarWidth =
    typeof parsed.sidebarWidth === "number"
      ? clampSidebarWidth(parsed.sidebarWidth)
      : fallback.sidebarWidth;
  const sidebarOpen =
    typeof parsed.sidebarOpen === "boolean" ? parsed.sidebarOpen : fallback.sidebarOpen;
  const notesPanelWidth =
    typeof parsed.notesPanelWidth === "number"
      ? clampNotesPanelWidth(parsed.notesPanelWidth, sidebarWidth, sidebarOpen)
      : fallback.notesPanelWidth;
  return {
    hostScope:
      parsed.hostScope === "selected" || parsed.hostScope === "all"
        ? parsed.hostScope
        : fallback.hostScope,
    scope: parsed.scope === "all" || parsed.scope === "space" ? parsed.scope : fallback.scope,
    sidebarView:
      parsed.sidebarView === "agents" ||
      parsed.sidebarView === "tabs" ||
      parsed.sidebarView === "notes"
        ? parsed.sidebarView
        : fallback.sidebarView,
    agentSort:
      parsed.agentSort === "attention" ||
      parsed.agentSort === "status" ||
      parsed.agentSort === "workspace" ||
      parsed.agentSort === "lastStatusChange"
        ? parsed.agentSort
        : fallback.agentSort,
    agentGroup:
      parsed.agentGroup === "none" ||
      parsed.agentGroup === "host" ||
      parsed.agentGroup === "workspace" ||
      parsed.agentGroup === "hostWorkspace"
        ? parsed.agentGroup
        : fallback.agentGroup,
    combineMatchingWorkspaceNames: parseCombineMatchingWorkspaceNames(
      parsed.combineMatchingWorkspaceNames,
      fallback.combineMatchingWorkspaceNames,
    ),
    collapsedSidebarGroups: parseCollapsedSidebarGroups(
      parsed.collapsedSidebarGroups,
      fallback.collapsedSidebarGroups,
    ),
    spaceGroup:
      parsed.spaceGroup === "none" || parsed.spaceGroup === "host"
        ? parsed.spaceGroup
        : fallback.spaceGroup,
    agentPinnedOnly:
      typeof parsed.agentPinnedOnly === "boolean"
        ? parsed.agentPinnedOnly
        : fallback.agentPinnedOnly,
    agentActiveOnly:
      typeof parsed.agentActiveOnly === "boolean"
        ? parsed.agentActiveOnly
        : fallback.agentActiveOnly,
    agentFeaturesInTabs: parseAgentFeaturesInTabs(
      parsed.agentFeaturesInTabs,
      fallback.agentFeaturesInTabs,
    ),
    multiHostSpaceSelection: parseMultiHostSpaceSelection(
      parsed.multiHostSpaceSelection,
      fallback.multiHostSpaceSelection,
    ),
    sidebarWidth,
    notesPanelWidth,
    notesListPaneWidth:
      typeof parsed.notesListPaneWidth === "number"
        ? clampNotesListPaneWidth(parsed.notesListPaneWidth, notesPanelWidth)
        : fallback.notesListPaneWidth,
    notesListPaneCollapsed:
      typeof parsed.notesListPaneCollapsed === "boolean"
        ? parsed.notesListPaneCollapsed
        : fallback.notesListPaneCollapsed,
    notesEnabled:
      typeof parsed.notesEnabled === "boolean" ? parsed.notesEnabled : fallback.notesEnabled,
    notesPanelOpen:
      typeof parsed.notesPanelOpen === "boolean" ? parsed.notesPanelOpen : fallback.notesPanelOpen,
    sidebarOpen,
    terminalFontSizePx: parseTerminalFontSizePx(parsed.terminalFontSizePx),
    terminalScreenReaderText: parseTerminalScreenReaderText(
      parsed.terminalScreenReaderText,
      fallback.terminalScreenReaderText,
    ),
    terminalInputTransport: parseTerminalInputTransport(parsed.terminalInputTransport),
    terminalInputBatchDelayMs: parseTerminalInputBatchDelayMs(parsed.terminalInputBatchDelayMs),
    terminalOutputCoalesceMs: parseTerminalOutputCoalesceMs(
      parsed.terminalOutputCoalesceMs,
    ),
    contentInsetTopPx: parseContentInsetTopPx(parsed.contentInsetTopPx),
    contentInsetBottomPx: parseContentInsetBottomPx(parsed.contentInsetBottomPx),
    mobileControlsScalePercent: parseMobileControlsScalePercent(
      parsed.mobileControlsScalePercent,
    ),
    mobileTerminalTapTarget: parseMobileTerminalTapTarget(parsed.mobileTerminalTapTarget),
    mobileLongPressBehavior: parseStoredMobileLongPressBehavior(parsed),
    mobileTouchSelectionEndpointTimeoutMs: parseMobileTouchSelectionEndpointTimeoutMs(
      parsed.mobileTouchSelectionEndpointTimeoutMs,
    ),
    mobileKeyboardHideRefit: parseMobileKeyboardHideRefit(parsed.mobileKeyboardHideRefit),
    mobileCommandExpandingInput: parseMobileCommandExpandingInput(
      parsed.mobileCommandExpandingInput,
    ),
    mobileCommandEnterNewline: parseMobileCommandEnterNewline(
      parsed.mobileCommandEnterNewline,
    ),
  };
}

function readLegacyDisplayPrefs(fallback: DisplayPrefs): DisplayPrefs {
  try {
    const raw = window.localStorage.getItem(LEGACY_DISPLAY_PREFS_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as {
      activeSpaceId?: unknown;
      selectedPaneId?: unknown;
      mobileTouchSelection?: unknown;
    } & Partial<DisplayPrefs>;
    return parseDisplayPrefsValue(parsed, fallback);
  } catch {
    return fallback;
  }
}


export function clampSidebarWidth(width: number) {
  const viewportMax =
    typeof window === "undefined"
      ? MAX_SIDEBAR_WIDTH
      : Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 360));
  return Math.round(Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), viewportMax));
}


export function clampNotesPanelWidth(
  width: number,
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  sidebarOpen = true,
) {
  const reservedWidth = sidebarOpen ? sidebarWidth : 0;
  const viewportMax =
    typeof window === "undefined"
      ? MAX_NOTES_PANEL_WIDTH
      : Math.max(
          MIN_NOTES_PANEL_WIDTH,
          Math.min(MAX_NOTES_PANEL_WIDTH, window.innerWidth - reservedWidth - 320),
        );
  return Math.round(Math.min(Math.max(width, MIN_NOTES_PANEL_WIDTH), viewportMax));
}


export function clampNotesListPaneWidth(width: number, notesPanelWidth = DEFAULT_NOTES_PANEL_WIDTH) {
  const maxWidth = Math.max(
    MIN_NOTES_LIST_PANE_WIDTH,
    Math.min(MAX_NOTES_LIST_PANE_WIDTH, notesPanelWidth - 260),
  );
  return Math.round(Math.min(Math.max(width, MIN_NOTES_LIST_PANE_WIDTH), maxWidth));
}


export async function writeDisplayPrefs(prefs: DisplayPrefs) {
  const value = JSON.stringify(prefs);
  if (isNativeApp()) {
    try {
      await Preferences.set({ key: DISPLAY_PREFS_KEY, value });
    } catch {
      // Browser storage below remains a best-effort backup.
    }
  }
  try {
    window.localStorage.setItem(DISPLAY_PREFS_KEY, value);
    window.localStorage.removeItem(LEGACY_DISPLAY_PREFS_KEY);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}


function parseStoredMobileLongPressBehavior(
  parsed: Partial<DisplayPrefs> & { mobileTouchSelection?: unknown },
): MobileLongPressBehavior {
  if (parsed.mobileLongPressBehavior !== undefined) {
    return parseMobileLongPressBehavior(parsed.mobileLongPressBehavior);
  }
  if (parsed.mobileTouchSelection === true) {
    return "copy";
  }
  if (parsed.mobileTouchSelection === false) {
    return "off";
  }
  return DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR;
}

export function parseCombineMatchingWorkspaceNames(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}


export function parseCollapsedSidebarGroups(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string" && item.length > 0),
    ),
  ].slice(-MAX_COLLAPSED_SIDEBAR_GROUPS);
}



export function useAppPreferences(): {
  prefs: DisplayPrefs;
  prefsLoaded: boolean;
  setPrefs: Dispatch<SetStateAction<DisplayPrefs>>;
  setPrefsLoaded: Dispatch<SetStateAction<boolean>>;
  updatePrefs(
    patch: Partial<DisplayPrefs> | ((current: DisplayPrefs) => Partial<DisplayPrefs>),
  ): void;
} {
  const [prefs, setPrefs] = useState<DisplayPrefs>(readDisplayPrefs);
  const [prefsLoaded, setPrefsLoaded] = useState(() => !isNativeApp());

  const updatePrefs = useCallback(
    (
      patch: Partial<DisplayPrefs> | ((current: DisplayPrefs) => Partial<DisplayPrefs>),
    ) => {
      setPrefs((current) => ({
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      }));
    },
    [],
  );

  return { prefs, prefsLoaded, setPrefs, setPrefsLoaded, updatePrefs };
}
