/**
 * @vitest-environment jsdom
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MobileTerminalControls } from "./TerminalView";

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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MobileTerminalControls", () => {
  for (const expandingInput of [false, true]) {
    it(`clears and remounts the ${expandingInput ? "textarea" : "input"} after Send`, async () => {
      const { commandInputRef, container, onSubmitCommand } = await renderControls(expandingInput);
      const firstField = commandField(container);

      await setCommandValue(firstField, "first prompt");
      firstField.defaultValue = "first prompt";
      firstField.focus();
      await submitForm(container);

      expect(onSubmitCommand).toHaveBeenLastCalledWith("first prompt");
      expect(firstField.value).toBe("");
      expect(firstField.defaultValue).toBe("");

      const secondField = commandField(container);
      expect(secondField).not.toBe(firstField);
      expect(secondField.value).toBe("");
      expect(secondField.defaultValue).toBe("");
      expect(commandInputRef.current).toBe(secondField);
      expect(document.activeElement).not.toBe(secondField);

      await setCommandValue(secondField, "second prompt");
      expect(secondField.value).toBe("second prompt");
      await submitForm(container);

      expect(onSubmitCommand).toHaveBeenLastCalledWith("second prompt");
      expect(onSubmitCommand).toHaveBeenCalledTimes(2);
    });
  }

  it("clears and remounts after Stage while keeping empty Stage disabled", async () => {
    const { container, onStageCommand } = await renderControls(false);
    const firstField = commandField(container);

    await setCommandValue(firstField, "staged prompt");
    firstField.defaultValue = "staged prompt";
    await clickStage(container);

    expect(onStageCommand).toHaveBeenCalledOnce();
    expect(onStageCommand).toHaveBeenCalledWith("staged prompt");
    expect(firstField.value).toBe("");
    expect(firstField.defaultValue).toBe("");

    const secondField = commandField(container);
    expect(secondField).not.toBe(firstField);
    expect(secondField.value).toBe("");
    expect(secondField.defaultValue).toBe("");
    expect(stageButton(container).disabled).toBe(true);

    await clickStage(container);
    expect(onStageCommand).toHaveBeenCalledOnce();
  });

  it("continues submitting an empty command as Enter", async () => {
    const { container, onSubmitCommand } = await renderControls(false);

    await submitForm(container);

    expect(onSubmitCommand).toHaveBeenCalledWith("");
  });

  it("composes Ctrl+Shift+Up and sends it from the same Compose button", async () => {
    const { container, onInput } = await renderControls(false);

    await clickButton(container, "Compose terminal key");
    expect(composerPanel(container)).not.toBeNull();

    await clickButton(container, "Add Ctrl modifier");
    await clickButton(container, "Add Shift modifier");
    await clickButton(container, "Use Up key");

    expect(composerPanel(container).textContent).toContain("Ctrl + Shift + ↑");
    await clickButton(container, "Send Ctrl + Shift + ↑");

    expect(onInput).toHaveBeenCalledOnce();
    expect(onInput).toHaveBeenCalledWith("\x1B[1;6A");
    expect(container.querySelector(".term-key-composer")).toBeNull();
  });

  it("sends arrows and Backspace directly without opening Compose", async () => {
    const { container, onInput } = await renderControls(false);

    for (const name of ["Left", "Up", "Down", "Right", "Backspace"]) {
      await clickButton(container, `Send ${name}`);
    }

    expect(onInput.mock.calls).toEqual([["\x1B[D"], ["\x1B[A"], ["\x1B[B"], ["\x1B[C"], ["\x7F"]]);
    expect(container.querySelector(".term-key-composer")).toBeNull();
  });

  it("keeps the navigation pad open across direct keys and Compose sends", async () => {
    const { container, onInput } = await renderControls(false);
    await clickButton(container, "Show navigation keys");
    for (const name of ["Home", "End", "Delete", "Page Up", "Page Down", "Delete"]) {
      await clickButton(container, `Send ${name}`);
    }
    expect(onInput.mock.calls).toEqual([
      ["\x1B[H"],
      ["\x1B[F"],
      ["\x1B[3~"],
      ["\x1B[5~"],
      ["\x1B[6~"],
      ["\x1B[3~"],
    ]);

    await clickButton(container, "Compose terminal key");
    await clickButton(container, "Add Shift modifier");
    await clickButton(container, "Use Tab key");
    await clickButton(container, "Send Shift + Tab");
    await clickButton(container, "Send Home");
    expect(onInput.mock.calls.slice(-2)).toEqual([["\x1B[Z"], ["\x1B[H"]]);

    await clickButton(container, "Hide navigation keys");
    expect(container.querySelector('button[aria-label="Send Home"]')).toBeNull();
  });

  it("does not apply or clear composer modifiers when using direct keys", async () => {
    const { container, onInput } = await renderControls(false);
    await clickButton(container, "Compose terminal key");
    await clickButton(container, "Add Ctrl modifier");
    await clickButton(container, "Add Shift modifier");
    await clickButton(container, "Use Up key");
    await clickButton(container, "Send Left");
    await clickButton(container, "Send Backspace");
    await clickButton(container, "Send Ctrl + Shift + ↑");

    expect(onInput.mock.calls).toEqual([["\x1B[D"], ["\x7F"], ["\x1B[1;6A"]]);
  });

  it("repeats only navigation and deletion keys and stops when Nav closes", async () => {
    vi.useFakeTimers();
    const { container, onInput } = await renderControls(false);
    await clickButton(container, "Show navigation keys");
    const cases = [
      ["Backspace", 4],
      ["Left", 4],
      ["Up", 4],
      ["Down", 4],
      ["Right", 4],
      ["Delete", 4],
      ["Page Up", 4],
      ["Page Down", 4],
      ["Home", 1],
      ["End", 1],
    ] as const;
    for (const [name, count] of cases) {
      const button = container.querySelector<HTMLButtonElement>(
        `button[aria-label="Send ${name}"]`,
      );
      if (!button) {
        throw new Error(`Missing direct key: ${name}`);
      }
      button.setPointerCapture = vi.fn();
      onInput.mockClear();
      button.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
        }),
      );
      vi.advanceTimersByTime(520);
      expect(onInput, name).toHaveBeenCalledTimes(count);
      button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
      vi.advanceTimersByTime(1000);
      expect(onInput, name).toHaveBeenCalledTimes(count);
    }

    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Send Delete"]',
    );
    deleteButton?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
      }),
    );
    onInput.mockClear();
    await clickButton(container, "Hide navigation keys");
    vi.advanceTimersByTime(1000);
    expect(onInput).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("captures a printable key for Alt chords", async () => {
    const { container, onInput } = await renderControls(false);

    await clickButton(container, "Compose terminal key");
    await clickButton(container, "Add Alt modifier");
    await setCommandValue(printableKeyField(container), "p");

    expect(composerPanel(container).textContent).toContain("Alt + p");
    await clickButton(container, "Send Alt + p");

    expect(onInput).toHaveBeenCalledOnce();
    expect(onInput).toHaveBeenCalledWith("\x1Bp");
    expect(container.querySelector(".term-key-composer")).toBeNull();
  });
});

async function renderControls(expandingInput: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const commandInputRef = createRef<HTMLInputElement | HTMLTextAreaElement>();
  const onSubmitCommand = vi.fn();
  const onStageCommand = vi.fn();
  const onInput = vi.fn();

  await act(async () => {
    root.render(
      <MobileTerminalControls
        commandInputRef={commandInputRef}
        disabled={false}
        uploadDisabled={false}
        expandingInput={expandingInput}
        enterNewline={false}
        controlsScalePercent={100}
        onControlsHeightChange={vi.fn()}
        onInput={onInput}
        onTerminalFocus={vi.fn()}
        onUpload={vi.fn()}
        onStageCommand={onStageCommand}
        onSubmitCommand={onSubmitCommand}
      />,
    );
  });

  return {
    commandInputRef,
    container,
    onInput,
    onStageCommand,
    onSubmitCommand,
  };
}

function commandField(container: HTMLElement) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    ".term-native-input",
  );
  if (!field) {
    throw new Error("missing mobile command field");
  }
  return field;
}

async function setCommandValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) {
    throw new Error("missing mobile command form");
  }
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function stageButton(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Stage command in terminal"]',
  );
  if (!button) {
    throw new Error("missing Stage button");
  }
  return button;
}

async function clickStage(container: HTMLElement) {
  await act(async () => {
    stageButton(container).click();
  });
}

function composerPanel(container: HTMLElement) {
  const panel = container.querySelector<HTMLElement>(".term-key-composer");
  if (!panel) {
    throw new Error("missing terminal key composer");
  }
  return panel;
}

function printableKeyField(container: HTMLElement) {
  const field = container.querySelector<HTMLInputElement>('input[aria-label="Printable key"]');
  if (!field) {
    throw new Error("missing printable key field");
  }
  return field;
}

async function clickButton(container: HTMLElement, ariaLabel: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
  if (!button) {
    throw new Error(`missing button: ${ariaLabel}`);
  }
  await act(async () => {
    button.click();
  });
}
