# Mobile drag-icon alignment

## Result

Android hardware confirmed that the loupe cursor and selected text were correct, but the drag icon appeared below the anchored starting character.

The first attempted correction aligned the thin stem above the icon with the selected character. Android screenshots showed that the stem was already correct while the large circular drag icon still hung one terminal row below it.

The corrected design removes the stem and centers the circular drag icon itself on the selected character. Selection coordinates and endpoint dragging are unchanged.

The on-screen test label is `CURSOR + ICON TEST · centered drag icon`.

## Verification

- focused drag-bubble position test passed
- `npm run lint:web`
- `npm run test:web` — 183 tests passed
- `npm run build:web`
- `npm run android:build:debug`

Android artifact:

```text
android/app/build/outputs/apk/debug/app-debug.apk
SHA-256: 9770aba716648ec63e5516ed9afff06986c0206250c4a66f003892e9a3132a9a
```

Hardware validation remains required to confirm that the icon now visually attaches to the selected character without affecting the already-correct selection behavior.
