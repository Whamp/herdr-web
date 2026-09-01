import {
  parseBridgeWebSocketControlMessage,
  type BridgeWebSocketSlot,
} from "./bridgeWebSocketConnection";

export type BridgePersistentSocketTimers = {
  setTimeout(handler: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
};

export type BridgePersistentSocketOptions = {
  connectionSlot: BridgeWebSocketSlot;
  onOpen?: () => void;
  socketFactory?: (url: string) => WebSocket;
  timers?: BridgePersistentSocketTimers;
};

export function openBridgePersistentSocket(
  wsUrl: (path: string, query?: URLSearchParams) => string,
  path: string,
  onEvent: (event: MessageEvent) => void,
  options: BridgePersistentSocketOptions,
) {
  const socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url));
  const timers = options.timers ?? {
    setTimeout: (handler: () => void, delayMs: number) => window.setTimeout(handler, delayMs),
    clearTimeout: (timerId: number) => window.clearTimeout(timerId),
  };
  let socket: WebSocket | null = null;
  let closed = false;
  let replaced = false;
  let reconnectTimer: number | null = null;
  let attempts = 0;

  const connect = () => {
    if (closed || replaced) {
      return;
    }
    const next = socketFactory(options.connectionSlot.connectionUrl(wsUrl(path)));
    socket = next;
    next.addEventListener("open", () => {
      attempts = 0;
      options.onOpen?.();
    });
    next.addEventListener("message", (event) => {
      if (closed || socket !== next) {
        return;
      }
      const control = parseBridgeWebSocketControlMessage(event.data);
      if (!control) {
        onEvent(event);
        return;
      }
      options.connectionSlot.observeControlMessage(control);
      if (control.type === "livenessProbe") {
        next.send(control.acknowledgement);
      } else if (control.type === "rejected" && control.reason === "stale_predecessor") {
        options.connectionSlot.resetConnectionIdentity();
        next.close();
      } else if (control.type === "replaced" || control.type === "rejected") {
        replaced = true;
        next.close();
      }
    });
    next.addEventListener("close", () => {
      if (closed || replaced || socket !== next || reconnectTimer !== null) {
        return;
      }
      const delay = Math.min(500 * 2 ** attempts, 5000);
      attempts += 1;
      reconnectTimer = timers.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    });
  };

  connect();
  return {
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        timers.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    },
  };
}
