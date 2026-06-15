import { Keyboard, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PaneInfo } from "./types";
import { GhosttyRenderer } from "./terminalRenderer";
import type { TerminalRenderer, TerminalSize } from "./terminalRenderer";

type Props = {
  pane: PaneInfo | null;
  /** Whether to grab keyboard focus on attach. Off on mobile to avoid popping the keyboard. */
  autoFocus?: boolean;
  /** Wheel scroll speed multiplier; slower on desktop, faster on mobile. */
  scrollSensitivity?: number;
  /** Supplemental browser-native input controls for narrow touch screens. */
  mobileControls?: boolean;
  /** Incrementing token from the parent that requests an immediate fit+resize. */
  refitToken?: number;
};

type ConnectionState = "idle" | "connecting" | "attached" | "closed" | "error";

export function TerminalView({
  pane,
  autoFocus = true,
  scrollSensitivity = 1,
  mobileControls = false,
  refitToken = 0,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<TerminalRenderer | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sendResizeRef = useRef<(size: TerminalSize) => void>(() => {});
  const inputQueueRef = useRef<string[]>([]);
  const inputFlushTimerRef = useRef<number | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [closeReason, setCloseReason] = useState<string | null>(null);
  // Read at attach time without re-running the effect (which would re-attach the socket).
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;
  const scrollSensitivityRef = useRef(scrollSensitivity);
  scrollSensitivityRef.current = scrollSensitivity;

  // Re-apply scroll tuning live when crossing the desktop/mobile breakpoint,
  // without tearing down the socket.
  useEffect(() => {
    rendererRef.current?.setScrollSensitivity(scrollSensitivity);
  }, [scrollSensitivity]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !pane) {
      setConnectionState("idle");
      return;
    }

    host.replaceChildren();
    let disposed = false;
    let socket: WebSocket | null = null;
    let disposeInput: (() => void) | null = null;
    let disposeScroll: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempts = 0;
    let lastCloseReason: string | null = null;
    const renderer: TerminalRenderer = new GhosttyRenderer();
    rendererRef.current = renderer;
    setConnectionState("connecting");

    const sendResize = (size: TerminalSize) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
      }
    };
    sendResizeRef.current = sendResize;

    void renderer
      .mount(host)
      .then(() => {
        if (disposed) {
          return;
        }

        renderer.setScrollSensitivity(scrollSensitivityRef.current);

        disposeInput = renderer.onInput((data) => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "input", data }));
          }
        });
        disposeScroll = renderer.onScroll((lines) => {
          if (socket?.readyState !== WebSocket.OPEN || lines === 0) {
            return;
          }
          socket.send(
            JSON.stringify({
              type: "scroll",
              direction: lines < 0 ? "up" : "down",
              lines: Math.min(Math.abs(lines), 200),
            }),
          );
        });

        resizeObserver = new ResizeObserver(() => {
          sendResize(renderer.fit());
        });
        resizeObserver.observe(host);

        const fontReady = document.fonts?.ready;
        if (fontReady) {
          void fontReady.then(() => {
            if (!disposed) {
              sendResize(renderer.refreshMetrics());
            }
          });
        }

        const scheduleReconnect = () => {
          if (disposed || reconnectTimer !== null) {
            return;
          }
          const delay = Math.min(500 * 2 ** reconnectAttempts, 5000);
          reconnectAttempts += 1;
          setConnectionState("connecting");
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connectSocket();
          }, delay);
        };

        const connectSocket = () => {
          if (disposed) {
            return;
          }
          const nextSocket = new WebSocket(terminalSocketUrl(pane.terminal_id, renderer.fit()));
          socket = nextSocket;
          socketRef.current = nextSocket;
          nextSocket.binaryType = "arraybuffer";

          nextSocket.addEventListener("open", () => {
            if (!disposed && socket === nextSocket) {
              reconnectAttempts = 0;
              lastCloseReason = null;
              setCloseReason(null);
              setConnectionState("attached");
              sendResize(renderer.fit());
              if (autoFocusRef.current) {
                window.setTimeout(() => renderer.focus(), 0);
              }
            }
          });
          nextSocket.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
              lastCloseReason = parseCloseReason(event.data) ?? lastCloseReason;
              return;
            }
            if (event.data instanceof ArrayBuffer) {
              renderer.write(new Uint8Array(event.data));
              return;
            }
            if (event.data instanceof Blob) {
              void event.data.arrayBuffer().then((buffer) => {
                if (!disposed && socket === nextSocket) {
                  renderer.write(new Uint8Array(buffer));
                }
              });
            }
          });
          nextSocket.addEventListener("close", () => {
            if (!disposed && socket === nextSocket) {
              if (lastCloseReason) {
                console.warn("terminal websocket closed", lastCloseReason);
              }
              if (isNonRetryableAttachClose(lastCloseReason)) {
                setCloseReason(lastCloseReason);
                setConnectionState("closed");
              } else {
                scheduleReconnect();
              }
            }
          });
          nextSocket.addEventListener("error", () => {
            if (!disposed && socket === nextSocket) {
              setConnectionState("error");
            }
          });
        };

        connectSocket();
      })
      .catch((error: unknown) => {
        console.error("failed to mount terminal renderer", error);
        if (!disposed) {
          setConnectionState("error");
        }
      });

    return () => {
      disposed = true;
      inputQueueRef.current = [];
      if (inputFlushTimerRef.current !== null) {
        window.clearTimeout(inputFlushTimerRef.current);
        inputFlushTimerRef.current = null;
      }
      disposeInput?.();
      disposeScroll?.();
      resizeObserver?.disconnect();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      sendResizeRef.current = () => {};
      renderer.dispose();
      rendererRef.current = null;
      host.replaceChildren();
    };
  }, [pane?.terminal_id]);

  useEffect(() => {
    if (refitToken === 0) {
      return;
    }
    const renderer = rendererRef.current;
    if (renderer) {
      sendResizeRef.current(renderer.refreshMetrics());
    }
  }, [refitToken]);

  useEffect(() => {
    if (!mobileControls || !pane) {
      return;
    }
    const refit = () => {
      const renderer = rendererRef.current;
      if (renderer) {
        sendResizeRef.current(renderer.refreshMetrics());
      }
    };
    const frame = window.requestAnimationFrame(refit);
    const timers = [80, 280, 520].map((delay) => window.setTimeout(refit, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [mobileControls, pane?.terminal_id]);

  const sendTerminalInput = (data: string) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  };

  const enqueueTerminalInput = (parts: string[]) => {
    inputQueueRef.current.push(...parts.filter((part) => part.length > 0));
    if (inputFlushTimerRef.current !== null) {
      return;
    }
    const flush = () => {
      inputFlushTimerRef.current = null;
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) {
        inputQueueRef.current = [];
        return;
      }
      const next = inputQueueRef.current.shift();
      if (next !== undefined) {
        socket.send(JSON.stringify({ type: "input", data: next }));
      }
      if (inputQueueRef.current.length > 0) {
        inputFlushTimerRef.current = window.setTimeout(flush, 35);
      }
    };
    inputFlushTimerRef.current = window.setTimeout(flush, 0);
  };

  return (
    <section className="terminal-stage" aria-label="Selected pane terminal">
      <div ref={hostRef} className="terminal-host" />
      {!pane ? <div className="terminal-overlay">No panes available</div> : null}
      {pane && connectionState !== "attached" ? (
        <div className="terminal-overlay">{connectionCopy(connectionState, closeReason)}</div>
      ) : null}
      {mobileControls ? (
        <MobileTerminalControls
          disabled={!pane || connectionState !== "attached"}
          onInput={sendTerminalInput}
          onSubmitCommand={(command) => enqueueTerminalInput([command, "\r"])}
        />
      ) : null}
    </section>
  );
}

function MobileTerminalControls({
  disabled,
  onInput,
  onSubmitCommand,
}: {
  disabled: boolean;
  onInput: (data: string) => void;
  onSubmitCommand: (command: string) => void;
}) {
  const [value, setValue] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [ctrlLatch, setCtrlLatch] = useState(false);
  const submit = () => {
    onSubmitCommand(value);
    setValue("");
  };
  const sendKey = (key: TerminalKey) => {
    onInput(ctrlLatch && key.ctrlData ? key.ctrlData : key.data);
    if (ctrlLatch) {
      setCtrlLatch(false);
    }
  };

  return (
    <div className="terminal-mobile-controls" data-expanded={expanded ? "true" : "false"}>
      <div className="term-key-strip" aria-label="Common terminal keys">
        <button
          className="term-key term-key-icon"
          type="button"
          aria-label={expanded ? "Hide special keys" : "Show special keys"}
          title={expanded ? "Hide keys" : "Keys"}
          onClick={() => setExpanded((open) => !open)}
        >
          <Keyboard size={15} />
        </button>
        <button
          className="term-key"
          type="button"
          data-active={ctrlLatch ? "true" : "false"}
          disabled={disabled}
          onClick={() => setCtrlLatch((active) => !active)}
        >
          Ctrl
        </button>
        {COMMON_KEYS.map((key) => (
          <button
            key={key.label}
            className="term-key"
            type="button"
            disabled={disabled}
            onClick={() => sendKey(key)}
          >
            {key.label}
          </button>
        ))}
      </div>

      {expanded ? (
        <div className="term-key-panel" aria-label="Special terminal keys">
          {SPECIAL_KEYS.map((key) => (
            <button
              key={key.label}
              className="term-key"
              type="button"
              disabled={disabled}
              onClick={() => sendKey(key)}
            >
              {key.label}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="term-input-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) {
            submit();
          }
        }}
      >
        <input
          className="term-native-input mono"
          type="text"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          disabled={disabled}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          className="term-send"
          type="submit"
          disabled={disabled}
          aria-label={value.length > 0 ? "Send command" : "Send enter"}
          title={value.length > 0 ? "Send" : "Enter"}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

type TerminalKey = {
  label: string;
  data: string;
  ctrlData?: string;
};

const COMMON_KEYS: TerminalKey[] = [
  { label: "Esc", data: "\x1B" },
  { label: "Tab", data: "\t" },
  { label: "C-c", data: "\x03" },
  { label: "C-d", data: "\x04" },
  { label: "Enter", data: "\r" },
  { label: "←", data: "\x1B[D" },
  { label: "↑", data: "\x1B[A" },
  { label: "↓", data: "\x1B[B" },
  { label: "→", data: "\x1B[C" },
];

const SPECIAL_KEYS: TerminalKey[] = [
  { label: "Bksp", data: "\x7F" },
  { label: "Del", data: "\x1B[3~" },
  { label: "Home", data: "\x1B[H" },
  { label: "End", data: "\x1B[F" },
  { label: "PgUp", data: "\x1B[5~" },
  { label: "PgDn", data: "\x1B[6~" },
  { label: "C-l", data: "\x0C" },
  { label: "C-r", data: "\x12" },
  { label: "C-z", data: "\x1A" },
  { label: "/", data: "/", ctrlData: "\x1F" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "-", data: "-" },
  { label: "_", data: "_" },
  { label: "'", data: "'" },
  { label: "\"", data: "\"" },
  { label: "[", data: "[" },
  { label: "]", data: "]" },
  { label: "{", data: "{" },
  { label: "}", data: "}" },
];

function terminalSocketUrl(terminalId: string, size: TerminalSize) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({
    terminal_id: terminalId,
    cols: String(size.cols),
    rows: String(size.rows),
    takeover: "false",
  });
  return `${protocol}//${window.location.host}/ws/terminal?${params.toString()}`;
}

function parseCloseReason(message: string) {
  try {
    const parsed = JSON.parse(message) as { type?: unknown; reason?: unknown };
    return parsed.type === "closed" && typeof parsed.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
}

function isNonRetryableAttachClose(reason: string | null) {
  return (
    reason?.includes("already has an attached client") ||
    reason?.includes("terminal attach taken over") ||
    reason?.includes("terminal attach failed: terminal")
  );
}

function connectionCopy(state: ConnectionState, reason: string | null) {
  if (reason?.includes("already has an attached client")) {
    return "Attached in another browser";
  }
  if (reason?.includes("terminal attach taken over")) {
    return "Detached by another browser";
  }
  switch (state) {
    case "connecting":
      return "Connecting";
    case "closed":
      return "Detached";
    case "error":
      return "Connection failed";
    case "idle":
    case "attached":
      return "";
  }
}
