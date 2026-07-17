# Mobile loupe cursor-alignment prototype

## Question

Does drawing the magnifier cursor immediately before the selected character, within that character's row, make the cursor and Ghostty Web highlight agree on Android?

## Change

The previous cursor was a T-shaped marker centered beneath the selected character. It began at the bottom of the selected row and extended to the bottom of the magnifier. On the phone, that tail appeared to point into a lower visual row even though the selected text was in the magnifier's middle row.

This focused prototype changes only the marker:

- a vertical caret immediately before the selected character;
- top and bottom aligned to that character's row;
- no underline or tail extending toward another row;
- a visible `CURSOR TEST · vertical caret` label so the phone build cannot be confused with the earlier A/B/C prototype.

Touch-to-cell calculations and selection range calculations are unchanged.

## Verification

A focused geometry test reproduced the old mismatch: the old marker was centered under the character and extended below its row. The same test now confirms that the caret sits before the character and remains within its row.

Automated checks:

- `npm run lint:web`
- `npm run test:web` — 182 tests passed
- `npm run build:web`
- `npm run android:build:debug`

Android artifact:

```text
android/app/build/outputs/apk/debug/app-debug.apk
SHA-256: 0c93fcd256fe5424e5bb6cd43e79a97dff55e191e884116da9867789610a4c46
```

## Phone check

1. Long-press and move the magnifier until the caret is immediately before a distinctive character.
2. Release, grab the drag handle, and extend the selection by a few characters on the same row.
3. Confirm that the first highlighted character is the one immediately after the caret.
4. Repeat on several rows and near the top and bottom of the terminal.

If the highlighted row still differs, capture one screenshot during start placement and one during endpoint dragging. That would falsify the cursor-only explanation and move the investigation back to touch-to-cell or selection-rendering coordinates.
