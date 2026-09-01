import { describe, expect, it } from "vitest";
import { openBridgePersistentSocket } from "./bridgePersistentSocket";
import type { BridgePersistentSocketTimers } from "./bridgePersistentSocket";
import { createBridgeWebSocketSlot } from "./bridgeWebSocketConnection";

class FakeSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.emit("close");
  }

  message(data: string) {
    this.emit("message", { data } as MessageEvent);
  }

  serverClose() {
    this.emit("close");
  }

  private emit(type: string, event = {} as MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeTimers implements BridgePersistentSocketTimers {
  private nextId = 1;
  private pending = new Map<number, () => void>();

  setTimeout(handler: () => void) {
    const timerId = this.nextId;
    this.nextId += 1;
    this.pending.set(timerId, handler);
    return timerId;
  }

  clearTimeout(timerId: number) {
    this.pending.delete(timerId);
  }

  runAll() {
    const handlers = [...this.pending.values()];
    this.pending.clear();
    for (const handler of handlers) {
      handler();
    }
  }

  get pendingCount() {
    return this.pending.size;
  }
}

function createHarness() {
  const urls: string[] = [];
  const sockets: FakeSocket[] = [];
  const events: string[] = [];
  const timers = new FakeTimers();
  let sessionGeneration = 0;
  const connectionSlot = createBridgeWebSocketSlot(
    "events",
    () => `page-session-${sessionGeneration++}`,
  );
  const connection = openBridgePersistentSocket(
    (path) => `ws://bridge${path}`,
    "/ws/events",
    (event) => events.push(String(event.data)),
    {
      connectionSlot,
      timers,
      socketFactory: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    },
  );
  return { connection, events, sockets, timers, urls };
}

describe("persistent bridge WebSocket", () => {
  it("reconnects with the exact active predecessor handle", () => {
    const h = createHarness();
    h.sockets[0].message(
      JSON.stringify({
        type: "herdr_web.connection_ready",
        connection_handle: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    h.sockets[0].message(JSON.stringify({ type: "herdr_web.connection_active" }));

    h.sockets[0].serverClose();
    h.timers.runAll();

    expect(h.urls).toHaveLength(2);
    expect(h.urls[1]).toContain("replace_connection=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("rotates its slot and retries when the bridge lost predecessor state", () => {
    const h = createHarness();
    h.sockets[0].message(
      JSON.stringify({
        type: "herdr_web.connection_ready",
        connection_handle: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    h.sockets[0].message(JSON.stringify({ type: "herdr_web.connection_active" }));
    h.sockets[0].serverClose();
    h.timers.runAll();

    h.sockets[1].message(
      JSON.stringify({
        type: "herdr_web.connection_rejected",
        reason: "stale_predecessor",
      }),
    );
    h.timers.runAll();

    expect(h.urls).toHaveLength(3);
    expect(h.urls[2]).toContain("connection_slot=events%3Apage-session-1");
    expect(h.urls[2]).not.toContain("replace_connection");
  });

  it("acknowledges liveness probes without forwarding them as domain events", () => {
    const h = createHarness();
    h.sockets[0].message(
      JSON.stringify({ type: "herdr_web.liveness_probe", nonce: "events-probe" }),
    );

    expect(h.sockets[0].sent).toEqual([
      JSON.stringify({ type: "herdr_web.liveness_ack", nonce: "events-probe" }),
    ]);
    expect(h.events).toEqual([]);
  });

  it("stops a replaced connection without entering the reconnect loop", () => {
    const h = createHarness();
    h.sockets[0].message(JSON.stringify({ type: "herdr_web.connection_replaced" }));

    expect(h.sockets[0].closed).toBe(true);
    expect(h.timers.pendingCount).toBe(0);
    h.timers.runAll();
    expect(h.sockets).toHaveLength(1);
  });

  it("close cancels a pending retry", () => {
    const h = createHarness();
    h.sockets[0].serverClose();
    expect(h.timers.pendingCount).toBe(1);

    h.connection.close();
    h.timers.runAll();

    expect(h.sockets).toHaveLength(1);
  });
});
