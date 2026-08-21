export type ReconnectDiagnosticEvent = {
  /** Wall-clock time in milliseconds since the Unix epoch. */
  atMs: number;
  /** Monotonic milliseconds since page load, when available. */
  elapsedMs: number | null;
  terminalId: string | null;
  event: string;
  details: ReconnectDiagnosticDetails | null;
};

/**
 * Diagnostic detail values are JSON scalars or flat arrays of them — enough
 * to carry reconnect evidence (reasons, socket states, timings) without an
 * open `unknown` dictionary in the stored contract.
 */
export type ReconnectDiagnosticDetailValue =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];

export type ReconnectDiagnosticDetails = Record<string, ReconnectDiagnosticDetailValue>;

export const RECONNECT_DIAGNOSTICS_STORAGE_KEY = "herdrWeb.reconnectDiagnostics.v1";
export const MAX_RECONNECT_DIAGNOSTIC_EVENTS = 400;

let cachedEvents: ReconnectDiagnosticEvent[] | null = null;

/**
 * Records a terminal reconnection event into a capped ring buffer that
 * survives page reloads, so reconnect storms on mobile can be diagnosed after
 * the fact instead of only through a live debugger.
 */
export function recordReconnectDiagnostic(
  terminalId: string | null,
  event: string,
  details: ReconnectDiagnosticDetails = {},
  storage: Pick<Storage, "getItem" | "setItem"> | null = browserLocalStorage(),
): ReconnectDiagnosticEvent[] {
  const entry: ReconnectDiagnosticEvent = {
    atMs: Date.now(),
    elapsedMs: monotonicMs(),
    terminalId,
    event,
    details: Object.keys(details).length > 0 ? details : null,
  };
  const events = appendReconnectDiagnosticEvent(loadReconnectDiagnosticEvents(storage), entry);
  cachedEvents = events;
  writeReconnectDiagnosticEvents(events, storage);
  return events;
}

export function loadReconnectDiagnosticEvents(
  storage: Pick<Storage, "getItem"> | null = browserLocalStorage(),
): ReconnectDiagnosticEvent[] {
  if (cachedEvents) {
    return cachedEvents;
  }
  if (!storage) {
    return [];
  }
  try {
    cachedEvents = parseReconnectDiagnosticEvents(safeParse(storage.getItem(RECONNECT_DIAGNOSTICS_STORAGE_KEY)));
  } catch {
    cachedEvents = [];
  }
  return cachedEvents;
}

export function clearReconnectDiagnostics(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = browserLocalStorage(),
) {
  cachedEvents = [];
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(RECONNECT_DIAGNOSTICS_STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in private or locked-down browser contexts.
  }
}

export function appendReconnectDiagnosticEvent(
  events: readonly ReconnectDiagnosticEvent[],
  entry: ReconnectDiagnosticEvent,
  cap: number = MAX_RECONNECT_DIAGNOSTIC_EVENTS,
): ReconnectDiagnosticEvent[] {
  const next = [...events, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function parseReconnectDiagnosticEvents(value: unknown): ReconnectDiagnosticEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const events: ReconnectDiagnosticEvent[] = [];
  for (const item of value) {
    const parsed = parseReconnectDiagnosticEvent(item);
    if (parsed) {
      events.push(parsed);
    }
  }
  return events;
}

function parseReconnectDiagnosticEvent(value: unknown): ReconnectDiagnosticEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.atMs !== "number" || typeof record.event !== "string") {
    return null;
  }
  return {
    atMs: record.atMs,
    elapsedMs: typeof record.elapsedMs === "number" ? record.elapsedMs : null,
    terminalId: typeof record.terminalId === "string" ? record.terminalId : null,
    event: record.event,
    details:
      typeof record.details === "object" && record.details !== null
        ? (record.details as ReconnectDiagnosticDetails)
        : null,
  };
}

/**
 * Renders the recorded events as a human-readable text block suitable for
 * pasting into a bug report. Events are listed oldest first with relative
 * times so reconnect timelines are easy to scan.
 */
export function serializeReconnectDiagnostics(
  events: readonly ReconnectDiagnosticEvent[],
  context: { exportedAtMs?: number; userAgent?: string } = {},
): string {
  const lines: string[] = ["# herdr-web reconnect diagnostics"];
  if (context.userAgent) {
    lines.push(`# userAgent: ${context.userAgent}`);
  }
  const exportedAtMs = context.exportedAtMs ?? Date.now();
  lines.push(`# exported: ${new Date(exportedAtMs).toISOString()}`, `# events: ${events.length}`);
  for (const entry of events) {
    const relativeSeconds =
      entry.elapsedMs === null
        ? null
        : Math.round(entry.elapsedMs) / 1000;
    const when =
      relativeSeconds === null
        ? new Date(entry.atMs).toISOString()
        : `${new Date(entry.atMs).toISOString()} (+${relativeSeconds.toFixed(3)}s)`;
    const terminal = entry.terminalId ?? "-";
    const detailSuffix = entry.details ? ` ${JSON.stringify(entry.details)}` : "";
    lines.push(`${when} ${entry.event} terminal=${terminal}${detailSuffix}`);
  }
  return lines.join("\n");
}

export function formatReconnectDiagnostics(
  storage: Pick<Storage, "getItem"> | null = browserLocalStorage(),
): string {
  return serializeReconnectDiagnostics(loadReconnectDiagnosticEvents(storage), {
    userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
  });
}

function writeReconnectDiagnosticEvents(
  events: readonly ReconnectDiagnosticEvent[],
  storage: Pick<Storage, "setItem"> | null,
) {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(RECONNECT_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Quota or serialization failures must never break reconnect handling.
  }
}

function safeParse(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function monotonicMs() {
  if (typeof performance === "undefined") {
    return null;
  }
  try {
    return performance.now();
  } catch {
    return null;
  }
}

function browserLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
