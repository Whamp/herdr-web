import { describe, expect, it } from "vitest";
import {
  MAX_RECONNECT_DIAGNOSTIC_EVENTS,
  RECONNECT_DIAGNOSTICS_STORAGE_KEY,
  appendReconnectDiagnosticEvent,
  clearReconnectDiagnostics,
  loadReconnectDiagnosticEvents,
  parseReconnectDiagnosticEvents,
  recordReconnectDiagnostic,
  serializeReconnectDiagnostics,
} from "./reconnectDiagnostics";
import type { ReconnectDiagnosticEvent } from "./reconnectDiagnostics";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function eventAt(atMs: number, event = "open"): ReconnectDiagnosticEvent {
  return { atMs, elapsedMs: atMs % 100000, terminalId: "term-1", event, details: null };
}

describe("reconnect diagnostics", () => {
  it("caps recorded events to the ring buffer size, dropping oldest first", () => {
    let events: ReconnectDiagnosticEvent[] = [];
    for (let index = 0; index < MAX_RECONNECT_DIAGNOSTIC_EVENTS + 5; index += 1) {
      events = appendReconnectDiagnosticEvent(events, eventAt(index));
    }
    expect(events).toHaveLength(MAX_RECONNECT_DIAGNOSTIC_EVENTS);
    expect(events[0]?.atMs).toBe(5);
    expect(events.at(-1)?.atMs).toBe(MAX_RECONNECT_DIAGNOSTIC_EVENTS + 4);
  });

  it("persists recorded events across reloads through storage", () => {
    const storage = memoryStorage();
    clearReconnectDiagnostics(storage);
    recordReconnectDiagnostic("term-1", "connect_start", { reason: "initial" }, storage);
    recordReconnectDiagnostic("term-1", "close", {}, storage);

    const reloaded = parseReconnectDiagnosticEvents(
      JSON.parse(storage.getItem(RECONNECT_DIAGNOSTICS_STORAGE_KEY) ?? "null"),
    );
    expect(reloaded.map((entry) => entry.event)).toEqual(["connect_start", "close"]);
    expect(reloaded[0]?.details).toEqual({ reason: "initial" });
    expect(reloaded[0]?.terminalId).toBe("term-1");
  });

  it("omits empty detail objects", () => {
    const storage = memoryStorage();
    clearReconnectDiagnostics(storage);
    const [entry] = recordReconnectDiagnostic(null, "signal", {}, storage);
    expect(entry?.details).toBeNull();
  });

  it("survives corrupt or unexpected stored payloads", () => {
    expect(parseReconnectDiagnosticEvents(null)).toEqual([]);
    expect(parseReconnectDiagnosticEvents({ not: "an array" })).toEqual([]);
    expect(parseReconnectDiagnosticEvents(["junk", 42, { atMs: "no" }])).toEqual([]);
    const parsed = parseReconnectDiagnosticEvents([
      { atMs: 10, event: "stalled", elapsedMs: 5.2, terminalId: "t", details: { a: 1 } },
      { atMs: 20, event: "open" },
    ]);
    expect(parsed).toEqual([
      { atMs: 10, elapsedMs: 5.2, terminalId: "t", event: "stalled", details: { a: 1 } },
      { atMs: 20, elapsedMs: null, terminalId: null, event: "open", details: null },
    ]);
  });

  it("serializes a scannable timeline with relative monotonic times", () => {
    const dump = serializeReconnectDiagnostics(
      [
        { atMs: Date.parse("2026-02-17T10:00:00Z"), elapsedMs: 0, terminalId: "t1", event: "connect_start", details: { reason: "resume" } },
        { atMs: Date.parse("2026-02-17T10:00:01Z"), elapsedMs: 1000.5, terminalId: "t1", event: "open", details: { durationMs: 1000 } },
        { atMs: Date.parse("2026-02-17T10:00:02Z"), elapsedMs: null, terminalId: null, event: "close", details: null },
      ],
      { exportedAtMs: Date.parse("2026-02-17T10:00:03Z"), userAgent: "TestAgent/1.0" },
    );
    const lines = dump.split("\n");
    expect(lines[0]).toBe("# herdr-web reconnect diagnostics");
    expect(lines.some((line) => line.includes("userAgent: TestAgent/1.0"))).toBe(true);
    expect(lines.some((line) => line.includes("# events: 3"))).toBe(true);
    expect(lines.find((line) => line.includes("connect_start"))).toContain("(+0.000s)");
    expect(lines.find((line) => line.includes("connect_start"))).toContain('{"reason":"resume"}');
    expect(lines.find((line) => line.includes(" open "))).toContain("(+1.001s)");
    expect(lines.find((line) => line.includes(" close "))).toContain("terminal=-");
  });

  it("clears both the cache and stored events", () => {
    const storage = memoryStorage();
    recordReconnectDiagnostic("t", "open", {}, storage);
    clearReconnectDiagnostics(storage);
    expect(storage.getItem(RECONNECT_DIAGNOSTICS_STORAGE_KEY)).toBeNull();
    expect(loadReconnectDiagnosticEvents(storage)).toEqual([]);

    recordReconnectDiagnostic("t", "open", {}, storage);
    clearReconnectDiagnostics(storage);
    expect(loadReconnectDiagnosticEvents(storage)).toEqual([]);
  });
});
