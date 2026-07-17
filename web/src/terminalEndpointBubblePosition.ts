/** Measurements used to align a touch-selection drag bubble to a terminal cell. */
export interface TerminalEndpointBubbleGeometryInput {
  targetClientX: number;
  targetClientY: number;
  containerLeft: number;
  containerTop: number;
  containerWidth: number;
  containerHeight: number;
  bubbleWidth: number;
  bubbleHeight: number;
  attachmentOffsetX: number;
  attachmentOffsetY: number;
}

/** Positions the bubble around its selected terminal cell. */
export function terminalEndpointBubblePosition(input: TerminalEndpointBubbleGeometryInput) {
  return {
    left: clamp(
      input.targetClientX - input.containerLeft - input.attachmentOffsetX,
      4,
      Math.max(4, input.containerWidth - input.bubbleWidth - 4),
    ),
    top: clamp(
      input.targetClientY - input.containerTop - input.attachmentOffsetY,
      4,
      Math.max(4, input.containerHeight - input.bubbleHeight - 4),
    ),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
