import {
  createBridgeWebSocketSlot,
  parseBridgeWebSocketControlMessage,
} from "./connection/bridgeWebSocketConnection";
import {
  recordReconnectDiagnostic,
  type ReconnectDiagnosticDetails,
} from "./reconnectDiagnostics";
import {
  isTerminalOutputGzipAcknowledgement,
  terminalOutputCompressionSupported,
  createTerminalOutputFrameDecoder,
} from "./terminalOutputCoalescing";
import {
  terminalReconnectPolicy,
  TERMINAL_FOREGROUND_FAST_ATTEMPTS,
  TERMINAL_FOREGROUND_SIGNAL_COALESCE_MS,
} from "./terminalReconnectPolicy";
import {
  MAX_TERMINAL_ATTACH_CONFLICT_RETRIES,
  parseTerminalCloseMessage,
  terminalCloseDisposition,
  type TerminalCloseMessage,
  type TerminalConnectionState,
  TerminalCloseCause,
} from "./terminalConnectionStatus";

export type ReconnectReason =
  | "initial"
  | "close"
  | "error"
  | "stalled"
  | "resume"
  | "visible"
  | "online"
  | "resize"
  | "manual";

export const TERMINAL_FIRST_RESUME_CONNECT_TIMEOUT_MS = 10000;

export type TerminalConnectionTimers = {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

export type TerminalConnectionHooks = {
  /** Connection state for overlays and status copy. */
  onState(state: TerminalConnectionState): void;
  /** A close the client will not recover from; carries the typed cause. */
  onStopped(close: TerminalCloseMessage): void;
  /** The live socket (or null) so view-side senders can write frames. */
  onSocket(socket: WebSocket | null): void;
  /** The socket reached the daemon and attached; flush inputs, focus. */
  onOpen(): void;
  /** Decoded terminal output bytes, in order. */
  onOutput(bytes: Uint8Array): void;
};

export type TerminalConnectionOptions = {
  terminalId: string;
  wsUrl: (path: string, query?: URLSearchParams) => string;
  measureSize(refresh?: boolean): { cols: number; rows: number } | null;
  terminalOutputCoalesceMs: number;
  hooks: TerminalConnectionHooks;
  /** Defaults to the browser WebSocket; inject a fake in tests. */
  socketFactory?(url: string): WebSocket;
  /** Defaults to window timers; inject a fake clock in tests. */
  timers?: TerminalConnectionTimers;
  /** Defaults to performance.now; inject for deterministic tests. */
  now?(): number;
  /** Defaults to the persistent reconnect diagnostics recorder. */
  recordEvent?(event: string, details?: ReconnectDiagnosticDetails): void;
};

export type TerminalConnection = {
  /** Open the first socket. */
  start(): void;
  /**
   * Report a connection-relevant event. Foreground signals (resume, visible,
   * online) are coalesced and take the fast foreground path; resize refreshes
   * the live socket or schedules a reconnect when detached; everything else
   * follows the normal backoff path.
   */
  signal(reason: ReconnectReason): void;
  /** Close every socket while native Android is suspended; reconnect on resume. */
  setSuspended(suspended: boolean): void;
  /** Send a resize frame on the live socket, if it is open. */
  resize(size: { cols: number; rows: number }): void;
  dispose(): void;
};

function defaultTimers(): TerminalConnectionTimers {
  return {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };
}

function terminalSocketUrl(
  wsUrl: (path: string, query?: URLSearchParams) => string,
  terminalId: string,
  size: { cols: number; rows: number },
  coalesceMs: number,
  requestGzipOutput: boolean,
) {
  const params = new URLSearchParams({
    terminal_id: terminalId,
    cols: String(size.cols),
    rows: String(size.rows),
    takeover: "false",
    coalesce_ms: String(coalesceMs),
  });
  if (requestGzipOutput) {
    params.set("output_encoding", "gzip");
  }
  return wsUrl("/ws/terminal", params);
}

/**
 * Owns one terminal websocket's full lifecycle: connect attempts, stall
 * detection, backoff scheduling, foreground-signal coalescing, attach-conflict
 * retries, close-cause dispositions, output framing, and diagnostics. Callers
 * see only state changes, decoded output, and a handful of commands; the
 * socket factory and clock are injected so the transition sequence is testable.
 */
export function createTerminalConnection(options: TerminalConnectionOptions): TerminalConnection {
  const {
    terminalId,
    wsUrl,
    measureSize,
    terminalOutputCoalesceMs,
    hooks,
  } = options;
  const socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url));
  const timers = options.timers ?? defaultTimers();
  const now = options.now ?? (() => performance.now());
  const debugReconnect =
    options.recordEvent ??
    ((event: string, details: ReconnectDiagnosticDetails = {}) => {
      recordReconnectDiagnostic(terminalId, event, details);
    });

  const connectionSlot = createBridgeWebSocketSlot("terminal");
  const ownedSockets = new Set<WebSocket>();
  let disposed = false;
  let suspended = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let connectTimer: number | null = null;
  let foregroundCoalesceTimer: number | null = null;
  let reconnectAttempts = 0;
  let foregroundFastAttemptsRemaining = 0;
  let attachConflictRetries = 0;
  let lastClose: TerminalCloseMessage | null = null;
  let socketGeneration = 0;
  let socketStartedAt = 0;
  let lastForegroundReconnectAt = Number.NEGATIVE_INFINITY;
  let reconnectStopped = false;
  const reconnectScheduledForSocket = new Set<number>();
  const pendingForegroundReasons = new Set<ReconnectReason>();

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearConnectTimer = () => {
    if (connectTimer !== null) {
      timers.clearTimeout(connectTimer);
      connectTimer = null;
    }
  };

  const clearForegroundCoalesceTimer = () => {
    if (foregroundCoalesceTimer !== null) {
      timers.clearTimeout(foregroundCoalesceTimer);
      foregroundCoalesceTimer = null;
    }
  };

  const closeOwnedSockets = () => {
    socket = null;
    hooks.onSocket(null);
    for (const ownedSocket of ownedSockets) {
      ownedSocket.close();
    }
    ownedSockets.clear();
  };

  const sendResize = (size: { cols: number; rows: number }) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
    }
  };

  const connectSocket = (reason: ReconnectReason, connectTimeoutMs: number) => {
    if (disposed || suspended || reconnectStopped) {
      return;
    }
    clearConnectTimer();
    const initialSize = measureSize();
    if (!initialSize) {
      scheduleReconnect("resize");
      return;
    }
    const predecessorSocket = socket;
    reconnectScheduledForSocket.clear();
    const requestGzipOutput = terminalOutputCompressionSupported();
    const nextSocket = socketFactory(
      connectionSlot.connectionUrl(
        terminalSocketUrl(
          wsUrl,
          terminalId,
          initialSize,
          terminalOutputCoalesceMs,
          requestGzipOutput,
        ),
      ),
    );
    ownedSockets.add(nextSocket);
    let connectionActivated = false;
    let connectionIdentityReset = false;
    let connectionSuperseded = false;
    let gzipOutputAcknowledged = false;
    const outputDecoder = createTerminalOutputFrameDecoder(
      (output) => {
        if (socket === nextSocket && !disposed) {
          hooks.onOutput(output);
        }
      },
      (error) => {
        lastClose = {
          cause: TerminalCloseCause.TransportFailed,
          detail: "output decompression failed",
        };
        debugReconnect("output-decompression-failed", { error: String(error) });
        if (socket === nextSocket) {
          nextSocket.close();
        }
      },
    );
    socket = nextSocket;
    hooks.onSocket(nextSocket);
    nextSocket.binaryType = "arraybuffer";
    const currentSocketGeneration = socketGeneration + 1;
    socketGeneration = currentSocketGeneration;
    socketStartedAt = now();
    hooks.onState("connecting");
    debugReconnect("connect_start", { reason, socketGeneration, connectTimeoutMs });
    connectTimer = timers.setTimeout(() => {
      retryStalledConnect(nextSocket, currentSocketGeneration);
    }, connectTimeoutMs);

    nextSocket.addEventListener("open", () => {
      if (disposed || socket !== nextSocket || socketGeneration !== currentSocketGeneration) {
        return;
      }
      clearConnectTimer();
      clearReconnectTimer();
      reconnectAttempts = 0;
      foregroundFastAttemptsRemaining = 0;
      reconnectScheduledForSocket.delete(currentSocketGeneration);
      lastClose = null;
      hooks.onState("attached");
      debugReconnect("open", {
        socketGeneration: currentSocketGeneration,
        durationMs: Math.round(now() - socketStartedAt),
      });
      const size = measureSize();
      if (size) {
        sendResize(size);
      }
      hooks.onOpen();
    });
    nextSocket.addEventListener("message", (event) => {
      if (disposed || socket !== nextSocket || socketGeneration !== currentSocketGeneration) {
        return;
      }
      if (typeof event.data === "string") {
        const control = parseBridgeWebSocketControlMessage(event.data);
        if (control) {
          connectionSlot.observeControlMessage(control);
          if (control.type === "active") {
            connectionActivated = true;
          } else if (control.type === "livenessProbe") {
            nextSocket.send(control.acknowledgement);
          } else if (control.type === "rejected" && control.reason === "stale_predecessor") {
            connectionIdentityReset = true;
            connectionSlot.resetConnectionIdentity();
            nextSocket.close();
          } else if (control.type === "replaced" || control.type === "rejected") {
            connectionSuperseded = true;
            nextSocket.close();
          }
          return;
        }
        if (isTerminalOutputGzipAcknowledgement(event.data)) {
          gzipOutputAcknowledged = true;
          return;
        }
        lastClose = parseTerminalCloseMessage(event.data) ?? lastClose;
        return;
      }
      const deliverOutput = (output: ArrayBuffer) => {
        // Terminal output only flows after a successful daemon attach, so
        // a transient attach-conflict streak is over.
        attachConflictRetries = 0;
        if (gzipOutputAcknowledged) {
          outputDecoder.enqueue(new Uint8Array(output));
        } else {
          hooks.onOutput(new Uint8Array(output));
        }
      };
      if (event.data instanceof ArrayBuffer) {
        deliverOutput(event.data);
        return;
      }
      if (event.data instanceof Blob) {
        attachConflictRetries = 0;
        void event.data.arrayBuffer().then(deliverOutput);
      }
    });
    nextSocket.addEventListener("close", () => {
      outputDecoder.cancel();
      ownedSockets.delete(nextSocket);
      if (disposed || socket !== nextSocket || socketGeneration !== currentSocketGeneration) {
        return;
      }
      clearConnectTimer();
      if (!connectionActivated) {
        connectionSlot.abandonPendingConnection();
      }
      if (
        !connectionActivated &&
        !connectionIdentityReset &&
        predecessorSocket?.readyState === WebSocket.OPEN &&
        ownedSockets.has(predecessorSocket)
      ) {
        socket = predecessorSocket;
        hooks.onSocket(predecessorSocket);
        debugReconnect("replacement_fallback", {
          socketGeneration: currentSocketGeneration,
        });
        reconnectAttempts = 0;
        foregroundFastAttemptsRemaining = TERMINAL_FOREGROUND_FAST_ATTEMPTS;
        scheduleConnect("close", "foreground", true);
        return;
      }
      socket = null;
      hooks.onSocket(null);
      if (connectionIdentityReset) {
        debugReconnect("connection_identity_reset", {
          socketGeneration: currentSocketGeneration,
        });
        reconnectAttempts = 0;
        foregroundFastAttemptsRemaining = TERMINAL_FOREGROUND_FAST_ATTEMPTS;
        scheduleConnect("close", "foreground", true);
        return;
      }
      if (connectionSuperseded) {
        debugReconnect("connection_superseded", {
          socketGeneration: currentSocketGeneration,
        });
        return;
      }
      debugReconnect("close", {
        socketGeneration: currentSocketGeneration,
        cause: lastClose?.cause ?? null,
        detail: lastClose?.detail || null,
        lifetimeMs: Math.round(now() - socketStartedAt),
      });
      if (lastClose) {
        console.warn("terminal websocket closed", lastClose.cause, lastClose.detail);
      }
      const disposition = terminalCloseDisposition(lastClose?.cause ?? "unknown");
      if (
        disposition === "attach-conflict" &&
        attachConflictRetries < MAX_TERMINAL_ATTACH_CONFLICT_RETRIES
      ) {
        // Usually a bridge restart or reattach racing the daemon's cleanup
        // of the previous connection; retry briefly before concluding a
        // genuine external client holds the attach.
        attachConflictRetries += 1;
        debugReconnect("attach-conflict-retry", { attempt: attachConflictRetries });
        scheduleSocketReconnect("close", currentSocketGeneration);
        return;
      }
      if (
        lastClose !== null &&
        (disposition === "stop" || disposition === "attach-conflict")
      ) {
        // A final cause, or an attach-conflict budget spent without success.
        reconnectStopped = true;
        debugReconnect("stopped", { cause: lastClose.cause });
        hooks.onStopped(lastClose);
        return;
      }
      scheduleSocketReconnect("close", currentSocketGeneration);
    });
    nextSocket.addEventListener("error", () => {
      if (disposed || socket !== nextSocket || socketGeneration !== currentSocketGeneration) {
        return;
      }
      clearConnectTimer();
      debugReconnect("error", { socketGeneration: currentSocketGeneration });
      scheduleSocketReconnect("error", currentSocketGeneration);
      nextSocket.close();
    });
  };

  const scheduleConnect = (
    reason: ReconnectReason,
    mode: "normal" | "foreground",
    immediate: boolean,
  ) => {
    if (disposed || suspended || reconnectStopped) {
      return;
    }
    if (reconnectTimer !== null) {
      if (!immediate) {
        return;
      }
      clearReconnectTimer();
    }
    const policy = terminalReconnectPolicy({
      attempt: reconnectAttempts,
      mode,
      immediate,
      foregroundFastAttemptsRemaining,
    });
    const connectTimeoutMs =
      mode === "foreground" && immediate
        ? TERMINAL_FIRST_RESUME_CONNECT_TIMEOUT_MS
        : policy.connectTimeoutMs;
    reconnectAttempts = policy.nextAttempt;
    foregroundFastAttemptsRemaining = policy.nextForegroundFastAttemptsRemaining;
    hooks.onState("connecting");
    debugReconnect("scheduled", {
      reason,
      mode,
      delayMs: policy.delayMs,
      connectTimeoutMs,
    });
    const run = () => {
      reconnectTimer = null;
      connectSocket(reason, connectTimeoutMs);
    };
    if (policy.delayMs === 0) {
      run();
      return;
    }
    reconnectTimer = timers.setTimeout(run, policy.delayMs);
  };

  function scheduleReconnect(reason: ReconnectReason) {
    const mode = foregroundFastAttemptsRemaining > 0 ? "foreground" : "normal";
    scheduleConnect(reason, mode, false);
  }

  function scheduleSocketReconnect(reason: ReconnectReason, socketId: number) {
    if (reconnectScheduledForSocket.has(socketId)) {
      return;
    }
    reconnectScheduledForSocket.add(socketId);
    scheduleReconnect(reason);
  }

  function retryStalledConnect(stalledSocket: WebSocket, socketId: number) {
    if (
      disposed ||
      suspended ||
      socket !== stalledSocket ||
      socketGeneration !== socketId ||
      stalledSocket.readyState !== WebSocket.CONNECTING
    ) {
      return;
    }
    debugReconnect("stalled", { socketGeneration: socketId });
    socket = null;
    hooks.onSocket(null);
    stalledSocket.close();
    scheduleSocketReconnect("stalled", socketId);
  }

  const processForegroundReconnect = (reason: ReconnectReason) => {
    if (suspended || reconnectStopped) {
      return;
    }
    const currentTime = now();
    lastForegroundReconnectAt = currentTime;
    const currentSocket = socket;
    const reasons = Array.from(pendingForegroundReasons);
    pendingForegroundReasons.clear();
    debugReconnect("signal", {
      reason,
      reasons,
      socketState: currentSocket?.readyState ?? "none",
      sinceSocketStartMs:
        currentSocket && socketStartedAt > 0 ? Math.round(currentTime - socketStartedAt) : null,
    });
    reconnectAttempts = 0;
    foregroundFastAttemptsRemaining = TERMINAL_FOREGROUND_FAST_ATTEMPTS;
    clearReconnectTimer();
    if (currentSocket?.readyState === WebSocket.CONNECTING) {
      clearConnectTimer();
      const currentSocketGeneration = socketGeneration;
      connectTimer = timers.setTimeout(() => {
        retryStalledConnect(currentSocket, currentSocketGeneration);
      }, TERMINAL_FIRST_RESUME_CONNECT_TIMEOUT_MS);
      debugReconnect("foreground_connect_preserved", {
        reason,
        socketGeneration: currentSocketGeneration,
        connectTimeoutMs: TERMINAL_FIRST_RESUME_CONNECT_TIMEOUT_MS,
      });
      return;
    }
    scheduleConnect(reason, "foreground", true);
  };

  const requestForegroundReconnect = (reason: ReconnectReason) => {
    if (suspended || reconnectStopped) {
      return;
    }
    pendingForegroundReasons.add(reason);
    const currentTime = now();
    const remainingCoalesceMs =
      TERMINAL_FOREGROUND_SIGNAL_COALESCE_MS - (currentTime - lastForegroundReconnectAt);
    if (remainingCoalesceMs > 0) {
      debugReconnect("signal_coalesced", { reason });
      if (foregroundCoalesceTimer === null) {
        foregroundCoalesceTimer = timers.setTimeout(() => {
          foregroundCoalesceTimer = null;
          processForegroundReconnect(reason);
        }, remainingCoalesceMs);
      }
      return;
    }
    clearForegroundCoalesceTimer();
    processForegroundReconnect(reason);
  };

  const signal = (reason: ReconnectReason) => {
    if (suspended || reconnectStopped) {
      return;
    }
    if (reason === "resume" || reason === "visible" || reason === "online") {
      requestForegroundReconnect(reason);
      return;
    }
    if (reason === "resize") {
      if (socket?.readyState === WebSocket.OPEN) {
        const size = measureSize(true);
        if (size) {
          sendResize(size);
        }
        return;
      }
      if (socket?.readyState === WebSocket.CONNECTING) {
        return;
      }
      scheduleReconnect(reason);
      return;
    }
    scheduleConnect(reason, "normal", reason === "initial" || reason === "manual");
  };

  return {
    start() {
      signal("initial");
    },
    signal,
    setSuspended(nextSuspended) {
      if (disposed || suspended === nextSuspended) {
        return;
      }
      suspended = nextSuspended;
      if (suspended) {
        pendingForegroundReasons.clear();
        reconnectScheduledForSocket.clear();
        clearReconnectTimer();
        clearConnectTimer();
        clearForegroundCoalesceTimer();
        closeOwnedSockets();
        debugReconnect("suspended");
        return;
      }
      reconnectAttempts = 0;
      foregroundFastAttemptsRemaining = TERMINAL_FOREGROUND_FAST_ATTEMPTS;
      debugReconnect("resumed");
      scheduleConnect("resume", "foreground", true);
    },
    resize(size) {
      sendResize(size);
    },
    dispose() {
      disposed = true;
      clearReconnectTimer();
      clearConnectTimer();
      clearForegroundCoalesceTimer();
      closeOwnedSockets();
    },
  };
}
