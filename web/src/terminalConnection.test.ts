import { describe, expect, it } from "vitest";
import { createTerminalConnection } from "./terminalConnection";
import type { TerminalConnectionTimers } from "./terminalConnection";
import type { TerminalCloseMessage, TerminalConnectionState } from "./terminalConnectionStatus";

class FakeSocket {
  readyState = 0; // CONNECTING
  binaryType = "";
  sent: string[] = [];
  closedByClient = false;
  private listeners = new Map<string, Array<(event?: unknown) => void>>();

  addEventListener(type: string, listener: (event?: unknown) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener() {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.closedByClient) {
      return;
    }
    this.closedByClient = true;
    this.readyState = 3; // CLOSED
    this.emit("close");
  }

  open() {
    this.readyState = 1; // OPEN
    this.emit("open");
  }

  messageText(data: string) {
    this.emit("message", { data });
  }

  messageBytes(data: ArrayBuffer) {
    this.emit("message", { data });
  }

  serverCloses() {
    this.readyState = 3;
    this.emit("close");
  }

  private emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeClock implements TerminalConnectionTimers {
  nowMs = 0;
  private nextId = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.pending.set(id, { at: this.nowMs + ms, fn });
    return id;
  }

  clearTimeout(id: number): void {
    this.pending.delete(id);
  }

  now(): number {
    return this.nowMs;
  }

  /** Runs every timer due within `ms`, in schedule order. */
  advance(ms: number): void {
    const horizon = this.nowMs + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, task]) => task.at <= horizon)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        break;
      }
      const [id, task] = due;
      this.pending.delete(id);
      this.nowMs = Math.max(this.nowMs, task.at);
      task.fn();
    }
    this.nowMs = horizon;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

function createHarness(overrides?: {
  measureSize?: (refresh?: boolean) => { cols: number; rows: number } | null;
}) {
  const clock = new FakeClock();
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const states: TerminalConnectionState[] = [];
  const stopped: TerminalCloseMessage[] = [];
  const opened: number[] = [];
  const outputChunks: Uint8Array[] = [];
  let liveSocket: FakeSocket | null = null;

  const connection = createTerminalConnection({
    terminalId: "term_test",
    wsUrl: (path, query) =>
      `ws://bridge.test${path}?${query ? query.toString() : ""}`,
    terminalOutputCoalesceMs: 16,
    measureSize:
      overrides?.measureSize ??
      (() => ({ cols: 80, rows: 24 })),
    hooks: {
      onState: (state) => states.push(state),
      onStopped: (close) => stopped.push(close),
      onSocket: (socket) => {
        liveSocket = socket ? (socket as unknown as FakeSocket) : null;
      },
      onOpen: () => opened.push(opened.length + 1),
      onOutput: (bytes) => outputChunks.push(bytes),
    },
    socketFactory: (url) => {
      const socket = new FakeSocket();
      urls.push(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    timers: clock,
    now: () => clock.now(),
    recordEvent: () => {},
  });

  function lastSocket(): FakeSocket {
    const socket = sockets[sockets.length - 1];
    if (!socket) {
      throw new Error("no socket created");
    }
    return socket;
  }

  /** Open the newest socket like a bridge would accept it. */
  function accept() {
    lastSocket().open();
  }

  return { clock, urls, sockets, states, stopped, opened, outputChunks, connection, lastSocket, accept, get live() { return liveSocket; } };
}

describe("terminalConnection", () => {
  it("connects on start and reports attach with an initial resize frame", () => {
    const h = createHarness();
    h.connection.start();

    expect(h.states.at(-1)).toBe("connecting");
    expect(h.states).not.toContain("attached");
    expect(h.sockets).toHaveLength(1);
    expect(h.lastSocket().sent).toEqual([]);

    h.accept();
    expect(h.states.at(-1)).toBe("attached");
    expect(h.opened).toEqual([1]);
    expect(JSON.parse(h.lastSocket().sent[0])).toEqual({ type: "resize", cols: 80, rows: 24 });
  });

  it("encodes the terminal identity and size into the socket URL", () => {
    const h = createHarness();
    h.connection.start();
    expect(h.urls[0]).toContain("terminal_id=term_test");
    expect(h.urls[0]).toContain("cols=80");
    expect(h.urls[0]).toContain("rows=24");
    expect(h.urls[0]).toContain("takeover=false");
  });

  it("reconnects with backoff after a close without a cause", () => {
    const h = createHarness();
    h.connection.start();
    h.accept();
    const first = h.lastSocket();
    first.serverCloses();

    // First retry is scheduled after the base delay.
    expect(h.sockets).toHaveLength(1);
    h.clock.advance(500);
    expect(h.sockets).toHaveLength(2);
    expect(h.states.at(-1)).toBe("connecting");
  });

  it("retries attach conflicts only within the bounded budget, then stops", () => {
    const h = createHarness();
    h.connection.start();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      // Advance past the capped retry delay (<=2000ms) but short of a full
      // stall cycle (delay + 2500ms timeout) so exactly one attempt spawns.
      h.clock.advance(2200);
      h.accept();
      h.lastSocket().messageText(
        JSON.stringify({ type: "closed", cause: "attach_conflict", detail: "busy" }),
      );
      h.lastSocket().serverCloses();
      expect(h.stopped).toEqual([]);
    }

    // Fourth conflict exceeds the budget: stop, no further connections.
    h.clock.advance(2200);
    h.accept();
    h.lastSocket().messageText(
      JSON.stringify({ type: "closed", cause: "attach_conflict", detail: "busy" }),
    );
    h.lastSocket().serverCloses();
    expect(h.stopped).toEqual([{ cause: "attach_conflict", detail: "busy" }]);
    const socketCount = h.sockets.length;
    h.clock.advance(60000);
    expect(h.sockets).toHaveLength(socketCount);
  });

  it("stops immediately when taken over elsewhere", () => {
    const h = createHarness();
    h.connection.start();
    h.accept();
    h.lastSocket().messageText(
      JSON.stringify({ type: "closed", cause: "taken_over", detail: "another client" }),
    );
    h.lastSocket().serverCloses();

    expect(h.stopped).toEqual([{ cause: "taken_over", detail: "another client" }]);
    const socketCount = h.sockets.length;
    h.clock.advance(60000);
    expect(h.sockets).toHaveLength(socketCount);
  });

  it("keeps reconnecting for output-lagged, unknown, and daemon closes", () => {
    for (const cause of ["output_lagged", "daemon_closed", "something_new"]) {
      const h = createHarness();
      h.connection.start();
      h.accept();
      h.lastSocket().messageText(JSON.stringify({ type: "closed", cause, detail: "" }));
      h.lastSocket().serverCloses();
      expect(h.stopped, `cause ${cause}`).toEqual([]);
      h.clock.advance(500);
      expect(h.sockets, `cause ${cause}`).toHaveLength(2);
    }
  });

  it("coalesces rapid foreground signals into one replacement of an open socket", () => {
    const h = createHarness();
    h.connection.start();
    h.accept();
    const predecessor = h.lastSocket();
    predecessor.messageText(
      JSON.stringify({
        type: "herdr_web.connection_ready",
        connection_handle: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );

    h.connection.signal("resume");
    h.connection.signal("visible");

    expect(h.sockets).toHaveLength(2);
    expect(predecessor.closedByClient).toBe(false);
    expect(h.urls[1]).toContain("replace_connection=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("preserves a fresh connecting socket when a foreground signal arrives", () => {
    const h = createHarness();
    h.connection.start();
    const pending = h.lastSocket();
    h.clock.advance(300);

    h.connection.signal("visible");

    expect(h.sockets).toHaveLength(1);
    expect(pending.closedByClient).toBe(false);
    h.clock.advance(9999);
    expect(pending.closedByClient).toBe(false);
    h.clock.advance(1);
    expect(pending.closedByClient).toBe(true);
  });

  it("suspend closes the socket and blocks reconnect work until resume", () => {
    const h = createHarness();
    h.connection.start();
    h.accept();
    const active = h.lastSocket();

    h.connection.setSuspended(true);
    expect(active.closedByClient).toBe(true);
    expect(h.live).toBeNull();
    h.clock.advance(60000);
    expect(h.sockets).toHaveLength(1);

    h.connection.setSuspended(false);
    expect(h.sockets).toHaveLength(2);
    expect(h.states.at(-1)).toBe("connecting");

    const resumeAttempt = h.lastSocket();
    h.clock.advance(1200);
    expect(resumeAttempt.closedByClient).toBe(false);
    expect(h.sockets).toHaveLength(2);

    h.clock.advance(8800);
    expect(resumeAttempt.closedByClient).toBe(true);
    h.clock.advance(500);
    expect(h.sockets).toHaveLength(3);
  });

  it("same-slot replacement never reports the terminal as taken over", () => {
    const h = createHarness();
    h.connection.start();
    h.accept();

    const replaced = h.lastSocket();
    replaced.messageText(JSON.stringify({ type: "herdr_web.connection_replaced" }));

    expect(replaced.closedByClient).toBe(true);
    expect(h.stopped).toEqual([]);
    h.clock.advance(60000);
    expect(h.sockets).toHaveLength(1);
  });

  it("rotates its slot after a stale predecessor rejection", () => {
    const h = createHarness();
    h.connection.start();
    h.accept();
    h.lastSocket().messageText(
      JSON.stringify({
        type: "herdr_web.connection_ready",
        connection_handle: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    h.lastSocket().messageText(JSON.stringify({ type: "herdr_web.connection_active" }));
    h.lastSocket().serverCloses();
    h.clock.advance(500);

    const rejected = h.lastSocket();
    rejected.open();
    rejected.messageText(
      JSON.stringify({
        type: "herdr_web.connection_rejected",
        reason: "stale_predecessor",
      }),
    );

    expect(h.urls).toHaveLength(3);
    expect(h.urls[2]).not.toContain("replace_connection");
    expect(new URL(h.urls[2]).searchParams.get("connection_slot")).not.toBe(
      new URL(h.urls[1]).searchParams.get("connection_slot"),
    );
  });

  it("acknowledges application liveness probes from JavaScript", () => {
    const h = createHarness();
    h.connection.start();
    h.accept();

    h.lastSocket().messageText(
      JSON.stringify({ type: "herdr_web.liveness_probe", nonce: "terminal-probe" }),
    );

    expect(h.lastSocket().sent).toContain(
      JSON.stringify({ type: "herdr_web.liveness_ack", nonce: "terminal-probe" }),
    );
  });

  it("takes the fast foreground path after signals while detached", () => {
    const h = createHarness();
    h.connection.start();
    const stale = h.lastSocket();
    stale.serverCloses();
    h.clock.advance(50);

    h.connection.signal("online");
    // Foreground mode connects without waiting for the normal backoff tail.
    expect(h.sockets.length).toBeGreaterThanOrEqual(2);
    expect(h.states.at(-1)).toBe("connecting");
  });

  it("abandons a stalled connect and reschedules", () => {
    const h = createHarness();
    h.connection.start();
    const stalled = h.lastSocket();
    h.clock.advance(4200);

    expect(stalled.closedByClient).toBe(true);
    expect(h.sockets).toHaveLength(2);
    expect(h.live).not.toBe(stalled);
  });

  it("delivers decoded binary output frames to the consumer", () => {
    const h = createHarness();
    h.connection.start();
    h.accept();

    const payload = new TextEncoder().encode("$ ls\n").buffer as ArrayBuffer;
    h.lastSocket().messageBytes(payload);
    expect(new TextDecoder().decode(h.outputChunks[0])).toBe("$ ls\n");
  });

  it("dispose closes the socket, cancels timers, and stops all activity", () => {
    const h = createHarness();
    h.connection.start();
    h.connection.dispose();

    expect(h.lastSocket().closedByClient).toBe(true);
    expect(h.live).toBeNull();
    const socketCount = h.sockets.length;
    h.clock.advance(60000);
    h.connection.signal("manual");
    expect(h.sockets).toHaveLength(socketCount);
    expect(h.clock.pendingCount).toBe(0);
  });

  it("gives a platform-triggered foreground handshake the full wake budget", () => {
    const h = createHarness();
    h.connection.signal("visible");
    const wakeAttempt = h.lastSocket();

    h.clock.advance(1200);
    expect(wakeAttempt.closedByClient).toBe(false);
    h.clock.advance(8800);
    expect(wakeAttempt.closedByClient).toBe(true);
  });
});
