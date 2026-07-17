import { describe, expect, it } from "vitest";
import { terminalEndpointBubblePosition } from "./terminalEndpointBubblePosition";

describe("terminal endpoint drag bubble", () => {
  it("places the drag icon center on the selected cell center", () => {
    const position = terminalEndpointBubblePosition({
      targetClientX: 150,
      targetClientY: 100,
      containerLeft: 0,
      containerTop: 0,
      containerWidth: 390,
      containerHeight: 800,
      bubbleWidth: 72,
      bubbleHeight: 72,
      attachmentOffsetX: 36,
      attachmentOffsetY: 36,
    });

    expect(position).toEqual({ left: 114, top: 64 });
  });
});
