export type BridgeWebSocketControlMessage =
  | { type: "ready"; connectionHandle: string }
  | { type: "active" }
  | { type: "replaced" }
  | { type: "rejected"; reason: string }
  | { type: "livenessProbe"; acknowledgement: string };

export interface BridgeWebSocketSlot {
  connectionUrl(baseUrl: string): string;
  observeControlMessage(message: BridgeWebSocketControlMessage): void;
  abandonPendingConnection(): void;
  resetConnectionIdentity(): void;
}

const CONNECTION_HANDLE_PATTERN = /^[0-9a-f]{32}$/;

export function createBridgeWebSocketSlot(
  streamName: string,
  createSessionId: () => string = createSecureSessionId,
): BridgeWebSocketSlot {
  let slotId = `${streamName}:${createSessionId()}`;
  let activeHandle: string | null = null;
  let pendingHandle: string | null = null;

  return {
    connectionUrl(baseUrl: string): string {
      const url = new URL(baseUrl);
      url.searchParams.set("connection_slot", slotId);
      const predecessorHandle = pendingHandle ?? activeHandle;
      if (predecessorHandle) {
        url.searchParams.set("replace_connection", predecessorHandle);
      }
      return url.toString();
    },
    observeControlMessage(message: BridgeWebSocketControlMessage): void {
      if (message.type === "ready") {
        pendingHandle = message.connectionHandle;
      } else if (message.type === "active") {
        activeHandle = pendingHandle ?? activeHandle;
        pendingHandle = null;
      } else if (message.type === "rejected" || message.type === "replaced") {
        pendingHandle = null;
      }
    },
    abandonPendingConnection(): void {
      pendingHandle = null;
    },
    resetConnectionIdentity(): void {
      slotId = `${streamName}:${createSessionId()}`;
      activeHandle = null;
      pendingHandle = null;
    },
  };
}

export function parseBridgeWebSocketControlMessage(
  data: unknown,
): BridgeWebSocketControlMessage | null {
  if (typeof data !== "string") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "herdr_web.connection_ready":
      return typeof value.connection_handle === "string" &&
        CONNECTION_HANDLE_PATTERN.test(value.connection_handle)
        ? { type: "ready", connectionHandle: value.connection_handle }
        : null;
    case "herdr_web.connection_active":
      return { type: "active" };
    case "herdr_web.connection_replaced":
      return { type: "replaced" };
    case "herdr_web.connection_rejected":
      return typeof value.reason === "string" && value.reason.length > 0
        ? { type: "rejected", reason: value.reason }
        : null;
    case "herdr_web.liveness_probe":
      return typeof value.nonce === "string" && value.nonce.length > 0
        ? {
            type: "livenessProbe",
            acknowledgement: JSON.stringify({
              type: "herdr_web.liveness_ack",
              nonce: value.nonce,
            }),
          }
        : null;
    default:
      return null;
  }
}

function createSecureSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Secure random connection identity is unavailable");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
