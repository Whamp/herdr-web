import { describe, expect, it } from "vitest";
import {
  createBridgeWebSocketSlot,
  parseBridgeWebSocketControlMessage,
} from "./bridgeWebSocketConnection";

describe("bridge WebSocket connection slots", () => {
  it("keeps a session-scoped slot and sends the exact predecessor handle", () => {
    const slot = createBridgeWebSocketSlot("terminal", () => "session-id");

    expect(slot.connectionUrl("ws://bridge/ws/terminal?terminal_id=term-1")).toBe(
      "ws://bridge/ws/terminal?terminal_id=term-1&connection_slot=terminal%3Asession-id",
    );

    slot.observeControlMessage({
      type: "ready",
      connectionHandle: "0123456789abcdef0123456789abcdef",
    });

    expect(slot.connectionUrl("ws://bridge/ws/terminal?terminal_id=term-1")).toBe(
      "ws://bridge/ws/terminal?terminal_id=term-1&connection_slot=terminal%3Asession-id&replace_connection=0123456789abcdef0123456789abcdef",
    );
  });

  it("rotates to a fresh slot after the bridge loses predecessor state", () => {
    const sessionIds = ["page-session-a", "page-session-b"];
    const slot = createBridgeWebSocketSlot("terminal", () => sessionIds.shift() ?? "unexpected");
    slot.observeControlMessage({
      type: "ready",
      connectionHandle: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    slot.observeControlMessage({ type: "active" });

    expect(slot.connectionUrl("ws://bridge.test/ws/terminal")).toContain(
      "replace_connection=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    slot.resetConnectionIdentity();
    const recoveredUrl = slot.connectionUrl("ws://bridge.test/ws/terminal");

    expect(recoveredUrl).toContain("connection_slot=terminal%3Apage-session-b");
    expect(recoveredUrl).not.toContain("replace_connection");
  });

  it("updates the predecessor only from a server-issued ready message", () => {
    const slot = createBridgeWebSocketSlot("events", () => "page-run");
    slot.observeControlMessage({
      type: "ready",
      connectionHandle: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    slot.observeControlMessage({ type: "active" });
    slot.observeControlMessage({ type: "replaced" });
    slot.observeControlMessage({ type: "rejected", reason: "stale_predecessor" });

    expect(slot.connectionUrl("ws://bridge/ws/events")).toContain(
      "replace_connection=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });
});

describe("bridge WebSocket control messages", () => {
  it("parses connection ready, replaced, and rejected messages", () => {
    expect(
      parseBridgeWebSocketControlMessage(
        '{"type":"herdr_web.connection_ready","connection_handle":"0123456789abcdef0123456789abcdef"}',
      ),
    ).toEqual({
      type: "ready",
      connectionHandle: "0123456789abcdef0123456789abcdef",
    });
    expect(
      parseBridgeWebSocketControlMessage('{"type":"herdr_web.connection_active"}'),
    ).toEqual({ type: "active" });
    expect(
      parseBridgeWebSocketControlMessage('{"type":"herdr_web.connection_replaced"}'),
    ).toEqual({ type: "replaced" });
    expect(
      parseBridgeWebSocketControlMessage(
        '{"type":"herdr_web.connection_rejected","reason":"stale_predecessor"}',
      ),
    ).toEqual({ type: "rejected", reason: "stale_predecessor" });
  });

  it("turns an application liveness probe into an exact acknowledgement", () => {
    expect(
      parseBridgeWebSocketControlMessage(
        '{"type":"herdr_web.liveness_probe","nonce":"probe-7"}',
      ),
    ).toEqual({
      type: "livenessProbe",
      acknowledgement: '{"type":"herdr_web.liveness_ack","nonce":"probe-7"}',
    });
  });

  it("ignores ordinary stream payloads and malformed controls", () => {
    expect(parseBridgeWebSocketControlMessage('{"type":"pane.created"}')).toBeNull();
    expect(parseBridgeWebSocketControlMessage("not json")).toBeNull();
    expect(
      parseBridgeWebSocketControlMessage(
        '{"type":"herdr_web.connection_ready","connection_handle":"not-a-handle"}',
      ),
    ).toBeNull();
  });
});
