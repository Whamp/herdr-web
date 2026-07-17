# Mobile drag-icon alignment

## Result

Android hardware confirmed that the loupe cursor and selected text were correct, but the drag icon appeared below the anchored starting character.

The drag bubble was positioned with its top edge at the selected cell center. Its visible attachment mark begins seven pixels inside the bubble, so the mark appeared seven pixels too low. The corrected position subtracts that internal offset, placing the attachment mark on the selected cell center. Selection coordinates and endpoint dragging are unchanged.

The on-screen test label is `CURSOR + ICON TEST · aligned markers`.

## Verification

- focused drag-bubble position test passed
- `npm run lint:web`
- `npm run test:web` — 183 tests passed
- `npm run build:web`
- `npm run android:build:debug`

Android artifact:

```text
android/app/build/outputs/apk/debug/app-debug.apk
SHA-256: e4d8d2721b8c53e3af2270a45ef3617d3d48613d20903afa19c6131698180f10
```

Hardware validation remains required to confirm that the icon now visually attaches to the selected character without affecting the already-correct selection behavior.
