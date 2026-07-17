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
}

/** Measurements used to center a visible drag ring within its touch target. */
export interface CenteredTerminalDragHandleGeometryInput {
  touchTargetWidth: number;
  touchTargetHeight: number;
  ringDiameter: number;
}

/** Geometry for a visible ring centered within a larger touch target. */
export function centeredTerminalDragHandleGeometry(
  input: CenteredTerminalDragHandleGeometryInput,
) {
  return {
    ringLeft: (input.touchTargetWidth - input.ringDiameter) / 2,
    ringTop: (input.touchTargetHeight - input.ringDiameter) / 2,
  };
}

/** Centers the touch target on its selected terminal cell. */
export function terminalEndpointBubblePosition(input: TerminalEndpointBubbleGeometryInput) {
  return {
    left: clamp(
      input.targetClientX - input.containerLeft - input.bubbleWidth / 2,
      4,
      Math.max(4, input.containerWidth - input.bubbleWidth - 4),
    ),
    top: clamp(
      input.targetClientY - input.containerTop - input.bubbleHeight / 2,
      4,
      Math.max(4, input.containerHeight - input.bubbleHeight - 4),
    ),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
