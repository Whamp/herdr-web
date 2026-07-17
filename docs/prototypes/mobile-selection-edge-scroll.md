# Mobile selection edge-scroll prototype

## Question

What should happen when the moving selection endpoint reaches the top or bottom edge, and which scroll response keeps the committed start and moving endpoint stable enough on a real phone?

## Prototype

This throwaway prototype extends the anchored mobile-selection branch and runs inside the live Ghostty Web terminal. The selector at the bottom chooses among three behaviors and updates the `edge-scroll` URL parameter:

- **A · dwell + steady** — wait 320 ms in a 72 px edge zone, then scroll at 4 rows per second.
- **B · proportional** — scroll immediately from 2 to 12 rows per second according to how deeply the finger enters the 72 px edge zone.
- **C · single steps** — scroll one row each time the finger enters an edge zone; leave and re-enter to move another row.

The selector hides during endpoint dragging so it does not obstruct the bottom edge. The prototype HUD reports the mode, gesture phase, fixed start, moving endpoint, finger displacement, active edge/depth, and cumulative requested scroll rows.

During scrolling, the start remains in the original absolute row coordinate. The viewport projection moves that start by the cumulative scroll offset, while the endpoint remains under the finger and accumulates the same offset in its absolute row coordinate. This is a prototype of gesture feel and coordinate stability, not the production absolute-buffer selection implementation.

## Run

```bash
npm run dev:web
```

Android artifact:

```text
android/app/build/outputs/apk/debug/app-debug.apk
SHA-256: 902f9361643c5e61c843afd42b146c48dba502d2ce924ed1f545bf1bed8fb8e1
```

## Real-phone comparison

For each mode, place a start near the middle of a terminal containing enough scrollback, grab the drag bubble, then:

1. Hold just inside the top zone for three seconds, return to the middle, and confirm the HUD's start coordinate never changes.
2. Repeat at the bottom edge.
3. Move in and out of each edge zone several times and note accidental starts/stops or overshoot.
4. Try to extend by exactly one row, then by roughly ten rows.
5. While scrolling, move horizontally and confirm the selected column still follows the finger.
6. Rank the modes for control, speed, predictability, and fatigue. Note whether the preferred mode needs a different zone, delay, or speed.

The browser automation check could not run because this host has no Chrome executable at the path required by `chrome-devtools-axi`. The TypeScript build, ESLint, complete Vitest suite, and Android debug build did run successfully.
