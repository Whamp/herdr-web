# Papercuts

## 2026-09-06T16:17:24.953710961Z — medium

- Reporter: "pi"

> Ghostty Web real-WASM test discovery: after creating/writing/reading/freeing an 80x3 terminal, creating another terminal from the same Ghostty instance, resizing it to 12x6, and writing a wrapping OSC 8 label hangs synchronously. Expected the write to return. Confirmed identical timeout exit 124 in original ghostty-web 0.4.0 and candidate 0.4.0-next.20.g1858a59, so this is not introduced by the hyperlink fix. Reproducer: timeout 6s node /tmp/herdr-ghostty-resize-repro.mjs /absolute/path/to/node_modules/ghostty-web; last output is write 1. New hyperlink tests instantiate separate WASM memory per test for isolation; production sharing is unchanged. Root cause and browser reachability remain unverified. Next check: reproduce this create/free/resize sequence in a browser and minimize native allocator/resize behavior before proposing an upstream fix.
