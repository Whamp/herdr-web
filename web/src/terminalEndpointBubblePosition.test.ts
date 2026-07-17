import { describe, expect, it } from "vitest";
import {
  centeredTerminalDragHandleGeometry,
  terminalEndpointBubblePosition,
} from "./terminalEndpointBubblePosition";

describe("terminal endpoint drag handle", () => {
  it("centers the generous touch target on the selected cell", () => {
    const position = terminalEndpointBubblePosition({
      targetClientX: 150,
      targetClientY: 100,
      containerLeft: 0,
      containerTop: 0,
      containerWidth: 390,
      containerHeight: 800,
      bubbleWidth: 72,
      bubbleHeight: 72,
    });

    expect(position).toEqual({ left: 114, top: 64 });
  });

  it("centers a smaller visible ring within the touch target", () => {
    expect(
      centeredTerminalDragHandleGeometry({
        touchTargetWidth: 72,
        touchTargetHeight: 72,
        ringDiameter: 42,
      }),
    ).toEqual({
      ringLeft: 15,
      ringTop: 15,
    });
  });
});
