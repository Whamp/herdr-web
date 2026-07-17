# Mobile drag-handle placement prototype

## Question

Which mobile drag-handle style keeps the anchored character visible, clearly communicates the exact attachment point, and remains easy to grab on Android?

## Evidence leading to this comparison

Android hardware confirmed that the loupe cursor and selection coordinates are correct. The original handle placed a large circle below the selected character and connected it with a thin stem. The stem pointed to the correct location, but it was too subtle: the circle looked accidentally displaced by one row.

A second build centered the circle directly on the selected character. That was precise, but the circle obscured the text. Neither design should be treated as final without a direct comparison.

Screenshots:

- [`mobile-drag-icon-alignment/loupe-cursor-between-u-and-r.png`](mobile-drag-icon-alignment/loupe-cursor-between-u-and-r.png)
- [`mobile-drag-icon-alignment/drag-icon-one-row-below.png`](mobile-drag-icon-alignment/drag-icon-one-row-below.png)

## Variants

The in-app switcher offers three designs. The current choice is also stored in the `drag-handle` URL query parameter.

- **A — Centered:** the circle is centered directly on the selected character. Most precise; covers the text.
- **B — Pinned below:** the circle sits below the text with a thicker, higher-contrast stem and cap marking the exact character.
- **C — Sidecar:** the circle sits to the right with a horizontal leader and cap marking the exact character.

Selection coordinates and endpoint dragging are identical in every variant.

## Phone comparison

For each variant:

1. Place the loupe caret between two recognizable characters.
2. Release and confirm which character the handle appears attached to.
3. Note whether that character remains readable.
4. Grab the handle and extend the selection.
5. Judge whether the visual attachment is obvious before touching it and whether the circle is easy to grab.

The decision should optimize all three needs together: exact attachment, visible text, and a comfortable touch target.

## Verification

- `npm run lint:web`
- `npm run test:web` — 183 tests passed
- `npm run build:web`
- `npm run android:build:debug`

Android artifact:

```text
android/app/build/outputs/apk/debug/app-debug.apk
SHA-256: dedc944ef156e695ceebf1b9137bcbb0c94c588050dbb06e9df6a9f4b446dea3
```

Hardware validation remains required to choose a variant.
