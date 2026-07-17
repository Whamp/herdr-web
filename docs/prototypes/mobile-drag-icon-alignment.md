# Hollow centered mobile drag handle

## Focused design

Android comparison testing rejected the pinned-below handle as visually displaced. The sidecar made its attachment clear, but introduced an unfamiliar control. The focused design keeps the familiar centered placement while preserving the anchored glyph's readability:

- center the drag handle precisely on the anchored terminal character;
- draw a hollow, lightly tinted 42px ring inside a 72px touch target;
- hide the handle while the endpoint is actively dragged;
- leave the validated loupe offset, caret geometry, selection coordinates, anchored endpoint behavior, and copy behavior unchanged.

The on-screen prototype label is `HOLLOW CENTERED HANDLE TEST`.

Earlier Android evidence remains available in:

- [`mobile-drag-icon-alignment/loupe-cursor-between-u-and-r.png`](mobile-drag-icon-alignment/loupe-cursor-between-u-and-r.png)
- [`mobile-drag-icon-alignment/drag-icon-one-row-below.png`](mobile-drag-icon-alignment/drag-icon-one-row-below.png)

## Android validation

1. Long-press between two recognizable characters and use the loupe to anchor the selection.
2. Release and confirm the ring is centered on the anchored character while the glyph remains readable.
3. Touch anywhere within the generous handle target and drag to extend the selection.
4. Confirm the ring disappears during the drag, the loupe/caret remain offset and accurate, and copying returns the expected text.
5. Repeat near the terminal edges to confirm the handle remains reachable.

Hardware validation of this focused ring treatment remains required.
