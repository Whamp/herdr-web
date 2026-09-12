# Verification run: settings navigation sync

Run date: 2026-09-12

- Launch: `npm run dev` with `HERDR_WEB_BRIDGE_PORT=18787` and `HERDR_WEB_DEV_PORT=15173`.
- Doctor: `helpers/doctor.sh` reported `doctor: OK`, the expected bridge and Vite listeners, a populated snapshot, launcher presets, notes, and Herdr protocol 22 compatibility.
- Drive: `chrome-devtools-axi` opened the app, opened Settings, selected Display, confirmed Navigation synchronization started On, changed it to Off, read the stored value, reloaded the app, and reopened Display.
- Action evidence: `drive.txt` reports `selected: Off` and `stored: independent` after the click.
- Persistence evidence: `drive.txt` reports `selectedAfterReload: Off` and `stored: independent`; the post-reload ARIA snapshot and screenshot show Off selected.
- Cleanup: the final command used the ownership-checking `helpers/cleanup.sh`, which stopped the recorded dev supervisor and retained this directory. The proof files were checked after cleanup and still existed.
- Restoration: the browser setting was returned to On before the browser and temporary profile were removed. The verification ports were free afterward.
- `launch.log` contains transient Vite WebSocket reset errors from AXI reload/teardown. The bridge, page, Doctor, and drive assertions all passed.
