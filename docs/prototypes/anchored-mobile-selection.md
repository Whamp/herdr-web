# Anchored mobile selection prototype

## Decision

Keep the committed magnifier cell as the fixed selection start. When endpoint dragging begins, set the endpoint to that same cell. Move the endpoint only by the finger's displacement from its initial contact with the drag handle, converted through the terminal's cell width and height.

The previous model jumped at the `waiting-endpoint` to `dragging-endpoint` transition. It converted the finger's first contact inside the 72 px handle into an absolute terminal cell after applying a fixed 48 px vertical offset. Different contact points inside the handle therefore produced different endpoints before the finger moved.

## Browser evidence

The prototype ran against the application's live Ghostty Web canvas in Chromium 148 with a 390 × 844 CSS-pixel mobile viewport, device scale factor 3, and touch emulation enabled.

The placed start was cell `(23,17)`.

| Check | Finger input | Observed endpoint |
| --- | --- | --- |
| Handle contact at top-left | no displacement | `(23,17)` |
| Handle contact at center | no displacement | `(23,17)` |
| Handle contact at bottom-right | no displacement | `(23,17)` |
| Same-row forward | `(+40, 0)` px | `(28,17)` |
| Same-row backward | `(-40, 0)` px | `(18,17)` |
| Same-column down | `(0, +36)` px | `(23,20)` |
| Same-column up | `(0, -36)` px | `(23,14)` |
| Cross-row forward | `(+40, +36)` px | `(28,20)` |
| Cross-row backward | `(-40, -36)` px | `(18,14)` |

Every initial handle contact preserved the start with a reported displacement of `(0,0)`. Horizontal movement changed only the column, vertical movement changed only the row, and combined movement changed both in the expected direction. Chromium reported no console errors during the gesture checks.

The pure touch-selection tests also enforce that entering endpoint drag preserves the committed start. The complete web suite passed with 180 tests.

## Limit

Browser touch emulation validates the state transition, canvas hit testing, device-pixel-ratio handling, and cell displacement model. It does not validate Android WebView differences or physical ergonomics such as finger occlusion, vibration, target comfort, and timing. Validate those together with edge scrolling in one later real-device tuning pass.
