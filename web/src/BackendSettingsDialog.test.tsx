/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendSettingsDialog } from "./BackendSettingsDialog";
import type { DisplayPrefs } from "./appPreferences";

const bridge = vi.hoisted(() => ({
  store: {
    backends: [],
    enabledBridgeIds: [],
  },
  lastSelectedBridgeId: null,
  sameOriginAvailable: true,
  addBackend: vi.fn(),
  deleteBackend: vi.fn(),
  probeBackend: vi.fn(),
  setBridgeEnabled: vi.fn(),
  updateBackend: vi.fn(),
}));

vi.mock("./bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bridge")>();
  return {
    ...actual,
    useBridge: () => bridge,
  };
});

const roots: Root[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("BackendSettingsDialog terminal accessibility", () => {
  it("exposes a persisted-style opt-in control in the Terminal area", async () => {
    const onChange = vi.fn();
    const { container } = await render(<SettingsHarness onChange={onChange} />);
    const terminalTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("Terminal"));
    if (!terminalTab) {
      throw new Error("missing Terminal settings tab");
    }

    await act(async () => terminalTab.click());
    const group = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Terminal screen-reader text"]',
    );
    const [off, on] = Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
    expect(off?.getAttribute("aria-pressed")).toBe("true");
    expect(on?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => on?.click());
    expect(onChange).toHaveBeenCalledWith(true);
    expect(off?.getAttribute("aria-pressed")).toBe("false");
    expect(on?.getAttribute("aria-pressed")).toBe("true");
  });
});

function SettingsHarness({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => ({
    ...settingsProps().preferences,
    terminalScreenReaderText: false,
  }));
  return (
    <BackendSettingsDialog
      showMobileTerminalSettings
      showMobileKeyboardHideRefit
      preferences={prefs}
      onUpdatePrefs={(patch) =>
        setPrefs((current) => {
          const resolved = typeof patch === "function" ? patch(current) : patch;
          if ("terminalScreenReaderText" in resolved) {
            onChange(resolved.terminalScreenReaderText as boolean);
          }
          return { ...current, ...resolved };
        })
      }
      navigationSyncMode="shared"
      onNavigationSyncMode={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

function settingsProps(): { preferences: DisplayPrefs } {
  return {
    preferences: {
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
      agentFeaturesInTabs: true,
      multiHostSpaceSelection: true,
      sidebarWidth: 320,
      notesPanelWidth: 560,
      notesListPaneWidth: 240,
      notesListPaneCollapsed: false,
      notesEnabled: true,
      notesPanelOpen: true,
      sidebarOpen: true,
      terminalFontSizePx: 13,
      terminalScreenReaderText: false,
      terminalInputTransport: "json",
      terminalInputBatchDelayMs: 0,
      terminalOutputCoalesceMs: 16,
      contentInsetTopPx: 0,
      contentInsetBottomPx: 0,
      mobileControlsScalePercent: 100,
      mobileTerminalTapTarget: "command-input",
      mobileLongPressBehavior: "copy",
      mobileTouchSelectionEndpointTimeoutMs: 1500,
      mobileKeyboardHideRefit: true,
      mobileCommandExpandingInput: true,
      mobileCommandEnterNewline: false,
    },
  }
}

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { container, root };
}

function requiredElement<T extends Element = HTMLElement>(
  container: ParentNode,
  selector: string,
) {
  const element = container.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing element: ${selector}`);
  }
  return element;
}
