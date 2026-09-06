// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { installTerminalLinkClickHandler } from "./terminalHyperlinks";

describe("terminal link click ownership", () => {
  it.each([
    { name: "Ctrl", ctrlKey: true, metaKey: false },
    { name: "Meta", ctrlKey: false, metaKey: true },
    { name: "ordinary", ctrlKey: false, metaKey: false },
  ])("consumes $name clicks even when the app rejects the destination", (modifiers) => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    host.append(canvas);
    const dependencyOpener = vi.fn();
    const appHandler = vi.fn();
    const mouseDown = vi.fn();
    host.addEventListener("click", dependencyOpener);
    host.addEventListener("mousedown", mouseDown);
    const removeHandler = installTerminalLinkClickHandler(host, appHandler);
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    canvas.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        ctrlKey: modifiers.ctrlKey,
        metaKey: modifiers.metaKey,
      }),
    );

    expect(appHandler).toHaveBeenCalledOnce();
    expect(dependencyOpener).not.toHaveBeenCalled();
    expect(mouseDown).toHaveBeenCalledOnce();
    removeHandler();
    canvas.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        ctrlKey: modifiers.ctrlKey,
        metaKey: modifiers.metaKey,
      }),
    );
    expect(appHandler).toHaveBeenCalledOnce();
    expect(dependencyOpener).toHaveBeenCalledOnce();
  });
});
