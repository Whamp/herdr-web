import { useTerminalFocusRequest } from "./useTerminalFocusRequest";
import { useCommandDraft } from "./commandDrafts";
import {
  Copy,
  ExternalLink,
  Keyboard,
  Link,
  Paperclip,
  Plus,
  Send,
  SquareTerminal,
  TextCursorInput,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  autosizeMobileCommandTextarea,
  encodeMobileTerminalChord,
  formatMobileTerminalChord,
  MOBILE_TERMINAL_MODIFIERS,
  MOBILE_TERMINAL_SPECIAL_KEYS,
  mobileTerminalPrintableKey,
} from "./mobileTerminalControls";
import type { MobileTerminalChordKey } from "./mobileTerminalControls";
import { MobileTerminalKeyButton } from "./MobileTerminalKeyButton";
import * as native from "./native";
import { ConfirmDialog } from "./overlays";
import { createTerminalConnection } from "./terminalConnection";
import type { ReconnectReason } from "./terminalConnection";
import { copyTextToClipboard } from "./clipboard";
import { shellQuote } from "./shell";
import {
  terminalConnectionCopy,
  terminalConnectionOverlayDelayMs,
} from "./terminalConnectionStatus";
import type {
  TerminalCloseMessage,
  TerminalConnectionState,
} from "./terminalConnectionStatus";
import {
  findFirstUrlInSelection,
  normalizeMobileTerminalCopyText,
  openableHttpUrl,
} from "./terminalSelection";
import { GhosttyRenderer } from "./terminalRenderer";
import type { MobileTerminalTouchEvent, TerminalRenderer, TerminalSize } from "./terminalRenderer";
import {
  appendTerminalInputBatch,
  drainTerminalInputBatch,
  emptyTerminalInputBatch,
  shouldSendTerminalInputImmediately,
} from "./terminalInputTransport";
import type { TerminalInputTransport } from "./terminalInputTransport";
import { DEFAULT_TERMINAL_OUTPUT_COALESCE_MS } from "./terminalOutputCoalescing";
import { DEFAULT_TERMINAL_FONT_SIZE_PX } from "./terminalPrefs";
import { DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS } from "./mobileTerminalPrefs";
import type {
  MobileLongPressBehavior,
  MobileTerminalTapTarget,
  MobileTouchSelectionEndpointTimeoutMs,
} from "./mobileTerminalPrefs";
import type { PaneInfo } from "./types";
import {
  UploadConflictError,
  uploadWithOverwritePrompt,
} from "./terminalUploads";
import type { UploadCandidate, UploadedFile } from "./terminalUploads";

/** Terminal renderer and transport preferences, passed as one group. */
export interface TerminalViewTerminalOptions {
  /** Terminal renderer font size in CSS pixels. */
  fontSizePx: number;
  /** Whether to maintain a hidden plain-text mirror of the visible terminal viewport. */
  screenReaderText: boolean;
  /** Browser-to-bridge transport for terminal input payloads. */
  inputTransport: TerminalInputTransport;
  /** Delay for coalescing short terminal input payloads. Zero disables batching. */
  inputBatchDelayMs: number;
  /** Delay for coalescing terminal output frames. Zero disables output batching. */
  outputCoalesceMs: number;
}

/** Touch-screen behavior preferences, passed as one group. */
export interface TerminalViewMobileOptions {
  /** Percentage scale applied to mobile terminal controls. */
  controlsScalePercent: number;
  /** Where terminal taps should send focus on mobile. */
  tapTarget: MobileTerminalTapTarget;
  /** Gesture behavior for long-presses on touch terminals. */
  longPressBehavior: MobileLongPressBehavior;
  /** How long the loupe endpoint waits for a second drag. */
  touchSelectionEndpointTimeoutMs: MobileTouchSelectionEndpointTimeoutMs;
  /** Whether the mobile command input wraps and grows while editing. */
  commandExpandingInput: boolean;
  /** Whether Enter inserts a newline in the expanding mobile command input. */
  commandEnterNewline: boolean;
}

type Props = {
  bridgeId: string;
  pane: PaneInfo | null;
  connectionKey: string;
  connectionSuspended?: boolean;
  resumeToken: number;
  httpUrl: (path: string, query?: URLSearchParams) => string;
  wsUrl: (path: string, query?: URLSearchParams) => string;
  /** Whether to grab keyboard focus on attach. Off on mobile to avoid popping the keyboard. */
  autoFocus?: boolean;
  /** Wheel scroll speed multiplier; slower on desktop, faster on mobile. */
  scrollSensitivity?: number;
  /** Supplemental browser-native input controls for narrow touch screens. */
  mobileControls?: boolean;
  /** Whether to show the expanding command composer without enabling mobile terminal behavior. */
  desktopCommandComposer?: boolean;
  /** Whether Enter inserts a newline in the desktop command composer. */
  desktopCommandEnterNewline?: boolean;
  /** Whether the terminal cursor blinks. Off on touch devices. */
  cursorBlink?: boolean;
  /** Terminal renderer font size in CSS pixels. */
  terminalFontSizePx?: number;
  /** Percentage scale applied to mobile terminal controls. */
  mobileControlsScalePercent?: number;
  /** Where terminal taps should send focus on mobile. */
  mobileTapTarget?: MobileTerminalTapTarget;
  /** Gesture behavior for long-presses on touch terminals. */
  mobileLongPressBehavior?: MobileLongPressBehavior;
  /** How long the loupe endpoint waits for a second drag. */
  mobileTouchSelectionEndpointTimeoutMs?: MobileTouchSelectionEndpointTimeoutMs;
  /** Whether the mobile command input wraps and grows while editing. */
  mobileCommandExpandingInput?: boolean;
  /** Whether Enter inserts a newline in the expanding mobile command input. */
  mobileCommandEnterNewline?: boolean;
  /** Refocus the mobile command field after Send. */
  mobileCommandFocusAfterSubmit?: boolean;
  /** Browser-to-bridge transport for terminal input payloads. */
  terminalInputTransport?: TerminalInputTransport;
  /** Delay for coalescing short terminal input payloads. Zero disables batching. */
  terminalInputBatchDelayMs?: number;
  /** Delay for coalescing terminal output frames. Zero disables output batching. */
  terminalOutputCoalesceMs?: number;
  /** Incrementing token from the parent that requests an immediate fit+resize. */
  refitToken?: number;
  /** Incrementing token from the parent that requests focus on the preferred terminal input. */
  focusToken?: number;
  /** Whether to maintain a hidden plain-text mirror of the visible terminal viewport. */
  terminalScreenReaderText?: boolean;
  /** Whether upload filename conflicts are resolved with a numeric suffix. */
  autoRenameUploadConflicts?: boolean;
  /** Pane-specific accessible name for the terminal and its screen mirror. */
  accessibilityLabel?: string;
  /** Whether this is the currently selected terminal in a split. */
  selected?: boolean;
};

type UploadConflictState = {
  name: string;
  path: string;
  resolve: (replace: boolean) => void;
};
type MobileSelectionAction = {
  text: string;
  url: string;
};
type TerminalRendererReady = {
  terminalId: string;
  generation: number;
  renderer: TerminalRenderer;
  measure: (mode?: "fit" | "refresh") => TerminalSize | null;
};
const MAX_UPLOAD_FILES = 8;
const NO_NATIVE_LIFECYCLE_SUBSCRIPTION: () => void = () => undefined;

export function TerminalView({
  bridgeId,
  pane,
  connectionKey,
  connectionSuspended = false,
  resumeToken,
  httpUrl,
  wsUrl,
  autoFocus = true,
  scrollSensitivity = 1,
  mobileControls = false,
  desktopCommandComposer = false,
  desktopCommandEnterNewline = true,
  cursorBlink = true,
  terminalFontSizePx = DEFAULT_TERMINAL_FONT_SIZE_PX,
  mobileControlsScalePercent = 100,
  mobileTapTarget = "command-input",
  mobileLongPressBehavior = "off",
  mobileTouchSelectionEndpointTimeoutMs = DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
  mobileCommandExpandingInput = false,
  mobileCommandEnterNewline = false,
  mobileCommandFocusAfterSubmit = false,
  terminalInputTransport = "json",
  terminalInputBatchDelayMs = 0,
  terminalOutputCoalesceMs = DEFAULT_TERMINAL_OUTPUT_COALESCE_MS,
  refitToken = 0,
  focusToken = 0,
  terminalScreenReaderText = false,
  autoRenameUploadConflicts = true,
  accessibilityLabel = "Terminal",
  selected = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCommandInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const rendererRef = useRef<TerminalRenderer | null>(null);
  const rendererGenerationRef = useRef(0);
  const rendererReadyRef = useRef<TerminalRendererReady | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const requestReconnectRef = useRef<(reason: ReconnectReason) => void>(() => {});
  const setConnectionSuspendedRef = useRef<(suspended: boolean) => void>(() => {});
  const handledResumeTokenRef = useRef(resumeToken);
  const resumeTokenRef = useRef(resumeToken);
  const connectionSuspendedRef = useRef(connectionSuspended);
  const terminalInputBlockedRef = useRef(false);
  const uploadInputId = useId();
  const sendResizeRef = useRef<(size: TerminalSize) => void>(() => {});
  const inputQueueRef = useRef<string[]>([]);
  const inputFlushTimerRef = useRef<number | null>(null);
  const batchedInputRef = useRef(emptyTerminalInputBatch());
  const batchedInputFlushTimerRef = useRef<number | null>(null);
  const terminalInputEncoderRef = useRef(new TextEncoder());
  const uploadStatusTimerRef = useRef<number | null>(null);
  const uploadInFlightRef = useRef(false);
  const uploadConflictRef = useRef<UploadConflictState | null>(null);
  const connectionKeyRef = useRef(connectionKey);
  const terminalIdRef = useRef(pane?.terminal_id ?? null);
  const overlayTerminalIdRef = useRef(pane?.terminal_id ?? null);
  const delayConnectingOverlayRef = useRef(false);
  const [connectionState, setConnectionState] = useState<TerminalConnectionState>("idle");
  const [closeReason, setCloseReason] = useState<TerminalCloseMessage | null>(null);
  const [rendererReady, setRendererReady] = useState<TerminalRendererReady | null>(null);
  const [accessibleScreen, setAccessibleScreen] = useState("");
  const [hasAttachedForTerminal, setHasAttachedForTerminal] = useState(false);
  const terminalAttachCountRef = useRef(0);
  const [showConnectionOverlay, setShowConnectionOverlay] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadConflict, setUploadConflict] = useState<UploadConflictState | null>(null);
  const [mobileSelectionAction, setMobileSelectionAction] =
    useState<MobileSelectionAction | null>(null);
  // Read at attach time without re-running the effect (which would re-attach the socket).
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;
  const scrollSensitivityRef = useRef(scrollSensitivity);
  scrollSensitivityRef.current = scrollSensitivity;
  const desktopCommandComposerRef = useRef(desktopCommandComposer);
  desktopCommandComposerRef.current = desktopCommandComposer;
  const mobileControlsRef = useRef(mobileControls);
  mobileControlsRef.current = mobileControls;
  const terminalFontSizePxRef = useRef(terminalFontSizePx);
  terminalFontSizePxRef.current = terminalFontSizePx;
  const mobileTapTargetRef = useRef(mobileTapTarget);
  mobileTapTargetRef.current = mobileTapTarget;
  const mobileLongPressBehaviorRef = useRef(mobileLongPressBehavior);
  mobileLongPressBehaviorRef.current = mobileLongPressBehavior;
  const mobileTouchSelectionEndpointTimeoutMsRef = useRef(
    mobileTouchSelectionEndpointTimeoutMs,
  );
  mobileTouchSelectionEndpointTimeoutMsRef.current = mobileTouchSelectionEndpointTimeoutMs;
  const terminalInputTransportRef = useRef(terminalInputTransport);
  terminalInputTransportRef.current = terminalInputTransport;
  const terminalInputBatchDelayMsRef = useRef(terminalInputBatchDelayMs);
  terminalInputBatchDelayMsRef.current = terminalInputBatchDelayMs;
  connectionKeyRef.current = connectionKey;
  connectionSuspendedRef.current = connectionSuspended;
  resumeTokenRef.current = resumeToken;
  terminalIdRef.current = pane?.terminal_id ?? null;

  const focusCommandInput = useCallback(() => {
    if (!mobileControlsRef.current && !desktopCommandComposerRef.current) {
      return false;
    }
    const input = mobileCommandInputRef.current;
    if (!input || input.disabled) {
      return true;
    }
    input.focus();
    return true;
  }, []);

  const setCommandControlsHeight = useCallback((heightPx: number | null) => {
    if (heightPx === null) {
      stageRef.current?.style.removeProperty("--terminal-command-controls-height");
      return;
    }
    stageRef.current?.style.setProperty(
      "--terminal-command-controls-height",
      `${Math.ceil(heightPx)}px`,
    );
  }, []);

  const focusTerminalKeyboardInput = useCallback(() => {
    rendererRef.current?.focusTextInput();
    return "terminal" as const;
  }, []);

  const focusPreferredInput = useCallback(() => {
    if (mobileControlsRef.current && mobileTapTargetRef.current === "terminal") {
      rendererRef.current?.focusTextInput();
      return;
    }
    if (!focusCommandInput()) {
      rendererRef.current?.focusTextInput();
    }
  }, [focusCommandInput]);

  const showUploadStatus = useCallback((message: string | null, timeoutMs?: number) => {
    if (uploadStatusTimerRef.current !== null) {
      window.clearTimeout(uploadStatusTimerRef.current);
      uploadStatusTimerRef.current = null;
    }
    setUploadStatus(message);
    if (message && timeoutMs) {
      uploadStatusTimerRef.current = window.setTimeout(() => {
        uploadStatusTimerRef.current = null;
        setUploadStatus(null);
      }, timeoutMs);
    }
  }, []);

  const copyText = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await copyTextToClipboard(text);
        showUploadStatus(successMessage, 2200);
      } catch (error) {
        console.warn("selection copy failed", error);
        showUploadStatus("Copy failed", 3000);
      }
    },
    [showUploadStatus],
  );

  const handleMobileTerminalTouch = useCallback(
    (event: MobileTerminalTouchEvent) => {
      if (event.type === "url") {
        const url = openableHttpUrl(event.url);
        if (url) {
          if (event.isHyperlink) {
            setMobileSelectionAction({ text: url, url });
          } else {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        }
        return;
      }
      const copiedText = normalizeMobileTerminalCopyText(
        event.text,
        event.lineBreaksAtTerminalRightEdge,
      ).trim();
      setMobileSelectionAction(null);
      if (!copiedText) {
        rendererRef.current?.clearSelection();
        return;
      }
      const url = (event.url && openableHttpUrl(event.url)) || findFirstUrlInSelection(copiedText);
      if (url) {
        setMobileSelectionAction({ text: copiedText, url });
        return;
      }
      rendererRef.current?.clearSelection();
      void copyText(copiedText, "Copied selection");
    },
    [copyText],
  );

  const measureTerminal = useCallback(
    (renderer: TerminalRenderer, mode: "fit" | "refresh" = "fit") => {
      try {
        return mode === "refresh" ? renderer.refreshMetrics() : renderer.fit();
      } catch (error) {
        if (rendererRef.current === renderer) {
          console.warn("terminal resize skipped", error);
        }
        return null;
      }
    },
    [],
  );

  const resizeTerminal = useCallback(
    (mode: "fit" | "refresh" = "fit") => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }
      const size = measureTerminal(renderer, mode);
      if (size) {
        sendResizeRef.current(size);
      }
    },
    [measureTerminal],
  );

  const sendTerminalInputFrame = useCallback(
    (socket: WebSocket, data: string) => {
      if (terminalInputTransportRef.current === "binary") {
        const encoded = terminalInputEncoderRef.current.encode(data);
        socket.send(encoded);
        return;
      }
      const payload = JSON.stringify({ type: "input", data });
      socket.send(payload);
    },
    [],
  );

  const clearBatchedInputTimer = useCallback(() => {
    if (batchedInputFlushTimerRef.current !== null) {
      window.clearTimeout(batchedInputFlushTimerRef.current);
      batchedInputFlushTimerRef.current = null;
    }
  }, []);

  const clearQueuedTerminalInput = useCallback(() => {
    inputQueueRef.current = [];
    if (inputFlushTimerRef.current !== null) {
      window.clearTimeout(inputFlushTimerRef.current);
      inputFlushTimerRef.current = null;
    }
  }, []);

  const flushQueuedTerminalInput = useCallback(() => {
    if (inputFlushTimerRef.current !== null) {
      window.clearTimeout(inputFlushTimerRef.current);
      inputFlushTimerRef.current = null;
    }
    const flush = () => {
      inputFlushTimerRef.current = null;
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      const next = inputQueueRef.current.shift();
      if (next !== undefined) {
        sendTerminalInputFrame(socket, next);
      }
      if (inputQueueRef.current.length > 0) {
        inputFlushTimerRef.current = window.setTimeout(flush, 35);
      }
    };
    flush();
  }, [sendTerminalInputFrame]);

  const flushBatchedTerminalInput = useCallback(() => {
    clearBatchedInputTimer();
    const pending = batchedInputRef.current;
    if (pending.parts.length === 0) {
      batchedInputRef.current = emptyTerminalInputBatch();
      return;
    }
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    const drained = drainTerminalInputBatch(pending);
    batchedInputRef.current = drained.batch;
    if (drained.data !== null) {
      sendTerminalInputFrame(socket, drained.data);
    }
  }, [clearBatchedInputTimer, sendTerminalInputFrame]);

  const scheduleBatchedTerminalInputFlush = useCallback(() => {
    clearBatchedInputTimer();
    const delayMs = terminalInputBatchDelayMsRef.current;
    batchedInputFlushTimerRef.current = window.setTimeout(flushBatchedTerminalInput, delayMs);
  }, [clearBatchedInputTimer, flushBatchedTerminalInput]);

  const sendTerminalInputData = useCallback(
    (data: string) => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      const delayMs = terminalInputBatchDelayMsRef.current;
      const bytes = terminalInputEncoderRef.current.encode(data).byteLength;
      if (shouldSendTerminalInputImmediately(bytes, delayMs)) {
        flushBatchedTerminalInput();
        sendTerminalInputFrame(socket, data);
        return;
      }
      const result = appendTerminalInputBatch(batchedInputRef.current, data, bytes);
      batchedInputRef.current = result.batch;
      if (result.shouldFlush) {
        flushBatchedTerminalInput();
        return;
      }
      if (batchedInputFlushTimerRef.current === null) {
        scheduleBatchedTerminalInputFlush();
      }
    },
    [flushBatchedTerminalInput, scheduleBatchedTerminalInputFlush, sendTerminalInputFrame],
  );

  useEffect(() => {
    if (terminalInputBatchDelayMs <= 0) {
      flushBatchedTerminalInput();
    }
  }, [flushBatchedTerminalInput, terminalInputBatchDelayMs]);

  // Re-apply scroll tuning live when crossing the desktop/mobile breakpoint,
  // without tearing down the socket.
  useEffect(() => {
    rendererRef.current?.setScrollSensitivity(scrollSensitivity);
  }, [scrollSensitivity]);

  useTerminalFocusRequest(
    focusToken,
    focusPreferredInput,
    mobileControls || !desktopCommandComposer,
  );

  useEffect(() => {
    const host = hostRef.current;
    const terminalId = pane?.terminal_id ?? null;
    const previousOverlayTerminalId = overlayTerminalIdRef.current;
    delayConnectingOverlayRef.current = Boolean(
      terminalId && previousOverlayTerminalId && previousOverlayTerminalId !== terminalId,
    );
    overlayTerminalIdRef.current = terminalId;
    rendererReadyRef.current = null;
    setRendererReady(null);
    setAccessibleScreen("");
    setHasAttachedForTerminal(false);
    terminalAttachCountRef.current = 0;
    setShowConnectionOverlay(false);
    setCloseReason(null);
    terminalInputBlockedRef.current = false;
    if (!host || !terminalId) {
      setConnectionState("idle");
      host?.replaceChildren();
      return;
    }

    host.replaceChildren();
    let disposed = false;
    let disposeInput: (() => void) | null = null;
    let disposeScroll: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const generation = rendererGenerationRef.current + 1;
    rendererGenerationRef.current = generation;
    const renderer: TerminalRenderer = new GhosttyRenderer(
      terminalFontSizePxRef.current,
      cursorBlink &&
        !mobileControlsRef.current &&
        !(navigator.maxTouchPoints > 0 ||
          window.matchMedia("(hover: none) and (pointer: coarse)").matches),
    );
    rendererRef.current = renderer;
    setConnectionState("connecting");

    const measure = (mode: "fit" | "refresh" = "fit") => measureTerminal(renderer, mode);
    const publishReady = (mode: "fit" | "refresh" = "fit") => {
      if (disposed || rendererRef.current !== renderer) {
        return;
      }
      const size = measure(mode);
      if (!size) {
        return;
      }
      if (rendererReadyRef.current?.generation !== generation) {
        const ready = { terminalId, generation, renderer, measure };
        rendererReadyRef.current = ready;
        setRendererReady(ready);
      }
      sendResizeRef.current(size);
    };

    void renderer
      .mount(host)
      .then(() => {
        if (disposed) {
          return;
        }

        renderer.setScrollSensitivity(scrollSensitivityRef.current);
        renderer.setTapFocusHandler(
          !mobileControlsRef.current
            ? null
            : mobileTapTargetRef.current === "command-input"
              ? focusCommandInput
              : focusTerminalKeyboardInput,
        );
        renderer.setMobileTouchSelection(
          mobileControlsRef.current ? mobileLongPressBehaviorRef.current : "off",
          mobileControlsRef.current ? handleMobileTerminalTouch : null,
          mobileTouchSelectionEndpointTimeoutMsRef.current,
        );

        disposeInput = renderer.onInput((data) => {
          sendTerminalInputData(data);
        });
        disposeScroll = renderer.onScroll((lines) => {
          const socket = socketRef.current;
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
          publishReady();
          if (socketRef.current?.readyState !== WebSocket.OPEN) {
            requestReconnectRef.current("resize");
          }
        });
        resizeObserver.observe(host);

        const fontReady = document.fonts?.ready;
        if (fontReady) {
          void fontReady.then(() => {
            if (!disposed) {
              publishReady("refresh");
            }
          });
        }
        // Preload the lazy Nerd Font face; fonts.ready resolves before it loads.
        void document.fonts
          ?.load('13px "JetBrainsMono Nerd Font Mono"', "\uE0B0")
          .then(() => {
            if (!disposed) {
              publishReady("refresh");
            }
          })
          .catch(() => undefined);

        publishReady();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        console.error("failed to mount terminal renderer", error);
        setConnectionState("error");
      });

    return () => {
      disposed = true;
      flushBatchedTerminalInput();
      batchedInputRef.current = emptyTerminalInputBatch();
      clearQueuedTerminalInput();
      disposeInput?.();
      disposeScroll?.();
      resizeObserver?.disconnect();
      if (rendererReadyRef.current?.generation === generation) {
        rendererReadyRef.current = null;
        setRendererReady(null);
      }
      sendResizeRef.current = () => {};
      renderer.dispose();
      if (rendererRef.current === renderer) {
        rendererRef.current = null;
      }
      host.replaceChildren();
    };
  }, [
    connectionKey,
    cursorBlink,
    clearQueuedTerminalInput,
    flushBatchedTerminalInput,
    focusCommandInput,
    focusTerminalKeyboardInput,
    handleMobileTerminalTouch,
    measureTerminal,
    pane?.terminal_id,
    sendTerminalInputData,
  ]);

  useEffect(() => {
    setAccessibleScreen("");
    const ready = rendererReady;
    if (!terminalScreenReaderText || !ready) {
      ready?.renderer.setAccessibleScreenListener(null);
      return;
    }

    const { renderer, generation, terminalId } = ready;
    renderer.setAccessibleScreenListener((text) => {
      if (
        rendererRef.current === renderer &&
        rendererGenerationRef.current === generation &&
        terminalIdRef.current === terminalId
      ) {
        setAccessibleScreen(text);
      }
    });
    return () => renderer.setAccessibleScreenListener(null);
  }, [rendererReady, terminalScreenReaderText]);

  useEffect(() => {
    const terminalId = pane?.terminal_id ?? null;
    const ready = rendererReady;
    if (!terminalId) {
      setConnectionState("idle");
      requestReconnectRef.current = () => {};
      return;
    }
    if (
      !ready ||
      ready.terminalId !== terminalId ||
      rendererReadyRef.current !== ready ||
      rendererRef.current !== ready.renderer
    ) {
      setConnectionState("connecting");
      requestReconnectRef.current = () => {};
      return;
    }

    const connection = createTerminalConnection({
      terminalId,
      wsUrl,
      terminalOutputCoalesceMs,
      measureSize: (refresh) => ready.measure(refresh === true ? "refresh" : "fit"),
      hooks: {
        onState: (state) => {
          setConnectionState(state);
        },
        onStopped: (close) => {
          setCloseReason(close);
          terminalInputBlockedRef.current = true;
          setConnectionState("closed");
        },
        onSocket: (next) => {
          socketRef.current = next;
        },
        onOpen: () => {
          terminalInputBlockedRef.current = false;
          setCloseReason(null);
          setHasAttachedForTerminal(true);
          if (autoFocusRef.current) {
            window.setTimeout(() => ready.renderer.focus(), 0);
          }
          flushBatchedTerminalInput();
          flushQueuedTerminalInput();
        },
        onOutput: (bytes) => {
          if (
            rendererReadyRef.current?.generation !== ready.generation ||
            rendererRef.current !== ready.renderer
          ) {
            return;
          }
          ready.renderer.write(bytes);
        },
      },
    });

    requestReconnectRef.current = connection.signal;
    setConnectionSuspendedRef.current = connection.setSuspended;
    sendResizeRef.current = (size) => connection.resize(size);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        connection.signal("visible");
      }
    };
    const handleOnline = () => connection.signal("online");
    let directlySuspended = connectionSuspendedRef.current;
    let removeNativeLifecycleSubscriber = NO_NATIVE_LIFECYCLE_SUBSCRIPTION;
    try {
      removeNativeLifecycleSubscriber = native.addNativeConnectionLifecycleSubscriber((event) => {
        if (event.type === "suspend") {
          directlySuspended = true;
          connection.setSuspended(true);
        } else if (event.type === "resume") {
          directlySuspended = false;
          connection.setSuspended(false);
        } else if (!directlySuspended) {
          connection.signal("online");
        }
      });
    } catch {
      // Test doubles and older native shells may not expose lifecycle hooks.
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    connection.setSuspended(connectionSuspendedRef.current);
    connection.start();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      removeNativeLifecycleSubscriber();
      requestReconnectRef.current = () => {};
      setConnectionSuspendedRef.current = () => {};
      flushBatchedTerminalInput();
      batchedInputRef.current = emptyTerminalInputBatch();
      clearQueuedTerminalInput();
      connection.dispose();
      sendResizeRef.current = () => {};
    };
  }, [
    connectionKey,
    clearQueuedTerminalInput,
    flushBatchedTerminalInput,
    flushQueuedTerminalInput,
    pane?.terminal_id,
    rendererReady,
    terminalOutputCoalesceMs,
    wsUrl,
  ]);

  // Wait for React to enable the composer after attach before focusing it.
  // Selection changes alone must not override a direct click into a split terminal.
  useEffect(() => {
    if (connectionState === "attached" && autoFocusRef.current &&
        desktopCommandComposerRef.current && !mobileControlsRef.current) {
      if (terminalAttachCountRef.current === 1 || !hostRef.current?.contains(document.activeElement)) {
        focusCommandInput();
      }
    }
  }, [connectionState, focusCommandInput]);

  useEffect(() => {
    setConnectionSuspendedRef.current(connectionSuspended);
    if (!connectionSuspended) {
      handledResumeTokenRef.current = resumeTokenRef.current;
    }
  }, [connectionSuspended]);

  useEffect(() => {
    if (
      !connectionSuspended &&
      resumeToken > handledResumeTokenRef.current
    ) {
      handledResumeTokenRef.current = resumeToken;
      requestReconnectRef.current("resume");
    }
  }, [connectionSuspended, resumeToken]);

  useEffect(() => {
    let overlayTimer: number | null = null;
    if (!pane || connectionState === "idle" || connectionState === "attached") {
      setShowConnectionOverlay(false);
      return;
    }
    const overlayDelayMs = terminalConnectionOverlayDelayMs(
      connectionState,
      hasAttachedForTerminal || delayConnectingOverlayRef.current,
    );
    if (overlayDelayMs > 0) {
      setShowConnectionOverlay(false);
      overlayTimer = window.setTimeout(() => {
        setShowConnectionOverlay(true);
      }, overlayDelayMs);
      return () => {
        if (overlayTimer !== null) {
          window.clearTimeout(overlayTimer);
        }
      };
    }
    setShowConnectionOverlay(true);
    return () => {
      if (overlayTimer !== null) {
        window.clearTimeout(overlayTimer);
      }
    };
  }, [connectionState, hasAttachedForTerminal, pane?.terminal_id]);

  useEffect(() => {
    rendererRef.current?.setTapFocusHandler(
      !mobileControls
        ? null
        : mobileTapTarget === "command-input"
          ? focusCommandInput
          : focusTerminalKeyboardInput,
    );
  }, [focusCommandInput, focusTerminalKeyboardInput, mobileControls, mobileTapTarget]);

  useEffect(() => {
    rendererRef.current?.setMobileTouchSelection(
      mobileControls ? mobileLongPressBehavior : "off",
      mobileControls ? handleMobileTerminalTouch : null,
      mobileTouchSelectionEndpointTimeoutMs,
    );
  }, [
    handleMobileTerminalTouch,
    mobileControls,
    mobileLongPressBehavior,
    mobileTouchSelectionEndpointTimeoutMs,
  ]);

  useEffect(() => {
    const size = rendererRef.current?.setFontSize(terminalFontSizePx);
    if (size) {
      sendResizeRef.current(size);
    }
  }, [terminalFontSizePx]);

  useEffect(() => {
    setMobileSelectionAction(null);
    rendererRef.current?.clearSelection();
  }, [connectionKey, pane?.terminal_id]);

  useEffect(() => {
    return () => {
      if (uploadStatusTimerRef.current !== null) {
        window.clearTimeout(uploadStatusTimerRef.current);
        uploadStatusTimerRef.current = null;
      }
      resolveUploadConflict(false, false);
    };
  }, []);

  useEffect(() => {
    if (refitToken === 0) {
      return;
    }
    resizeTerminal("refresh");
  }, [refitToken, resizeTerminal]);

  useEffect(() => {
    if (!mobileControls || !pane) {
      return;
    }
    const refit = () => {
      resizeTerminal("refresh");
    };
    const frame = window.requestAnimationFrame(refit);
    const timers = [80, 280, 520].map((delay) => window.setTimeout(refit, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [mobileControls, pane?.terminal_id, resizeTerminal]);

  const uploadDisabled = !pane || uploading;

  const closeMobileSelectionActions = () => {
    setMobileSelectionAction(null);
    rendererRef.current?.clearSelection();
  };

  const openSelectionUrl = () => {
    if (!mobileSelectionAction) {
      return;
    }
    const url = openableHttpUrl(mobileSelectionAction.url);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      void copyText(mobileSelectionAction.text, "Copied selection");
    }
    closeMobileSelectionActions();
  };

  const copySelectionText = (text: string, successMessage: string) => {
    closeMobileSelectionActions();
    void copyText(text, successMessage);
  };

  const openFilePicker = () => {
    if (!uploadDisabled) {
      fileInputRef.current?.click();
    }
  };

  const confirmUploadReplace = (error: UploadConflictError) =>
    new Promise<boolean>((resolve) => {
      const next = { name: error.name, path: error.path, resolve };
      uploadConflictRef.current = next;
      setUploadConflict(next);
    });

  function resolveUploadConflict(replace: boolean, updateState = true) {
    const pending = uploadConflictRef.current;
    uploadConflictRef.current = null;
    if (updateState) {
      setUploadConflict(null);
    }
    pending?.resolve(replace);
  }

  function confirmUploadConflictReplace() {
    resolveUploadConflict(true);
    focusPreferredInput();
  }

  const uploadAndInsert = async (files: UploadCandidate[]) => {
    if (files.length === 0 || !pane) {
      if (files.length > 0) {
        showUploadStatus("No pane selected", 3000);
      }
      return;
    }
    if (uploadInFlightRef.current) {
      showUploadStatus("Upload already in progress", 2500);
      return;
    }
    uploadInFlightRef.current = true;
    setUploading(true);
    const uploadConnectionKey = connectionKey;
    const uploadTerminalId = pane.terminal_id;
    const uploadFiles = files.slice(0, MAX_UPLOAD_FILES);
    const skippedCount = files.length - uploadFiles.length;
    showUploadStatus(
      `Uploading ${uploadFiles.length} file${uploadFiles.length === 1 ? "" : "s"}${
        skippedCount > 0 ? `; skipping ${skippedCount}` : ""
      }`,
    );
    try {
      const uploaded: UploadedFile[] = [];
      for (const file of uploadFiles) {
        uploaded.push(
          await uploadWithOverwritePrompt(
            httpUrl,
            file,
            autoRenameUploadConflicts,
            confirmUploadReplace,
          ),
        );
      }
      if (
        connectionKeyRef.current !== uploadConnectionKey ||
        terminalIdRef.current !== uploadTerminalId
      ) {
        showUploadStatus("Upload completed after terminal changed", 3000);
        return;
      }
      if (uploaded.length > 0) {
        if (enqueueTerminalInput([uploaded.map((file) => shellQuote(file.path)).join(" ")])) {
          showUploadStatus(
            `Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}${
              skippedCount > 0 ? `; skipped ${skippedCount}` : ""
            }`,
            2500,
          );
        }
      } else {
        showUploadStatus(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      showUploadStatus(message, 4500);
    } finally {
      uploadInFlightRef.current = false;
      setUploading(false);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = uploadCandidatesFromClipboard(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void uploadAndInsert(files);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    const files = uploadCandidatesFromFileList(event.dataTransfer.files);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void uploadAndInsert(files);
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = uploadCandidatesFromFileList(event.target.files);
    event.target.value = "";
    if (files.length === 0) {
      showUploadStatus("No file selected", 2000);
      return;
    }
    showUploadStatus(`Selected ${files.length} file${files.length === 1 ? "" : "s"}`);
    void uploadAndInsert(files);
  };

  const enqueueTerminalInput = (parts: string[]) => {
    if (terminalInputBlockedRef.current) {
      showUploadStatus("Terminal detached", 2500);
      return false;
    }
    const filteredParts = parts.filter((part) => part.length > 0);
    if (filteredParts.length === 0) {
      return false;
    }
    inputQueueRef.current.push(...filteredParts);
    flushQueuedTerminalInput();
    return true;
  };

  const showCommandControls = mobileControls || desktopCommandComposer;

  return (
    <section
      ref={stageRef}
      className="terminal-stage"
      aria-label={accessibilityLabel}
      aria-current={selected ? "true" : undefined}
      onDragOverCapture={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDropCapture={handleDrop}
      onPasteCapture={handlePaste}
    >
      <div ref={hostRef} className="terminal-host" />
      {pane && terminalScreenReaderText ? (
        <div
          className="terminal-accessible-screen sr-only"
          role="region"
          tabIndex={-1}
          aria-label={`${accessibilityLabel} screen contents`}
          aria-live="off"
        >
          {accessibleScreen}
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        className="terminal-file-input"
        id={uploadInputId}
        type="file"
        multiple
        disabled={uploadDisabled}
        onChange={handleFileInput}
      />
      {!pane ? <div className="terminal-overlay">No panes available</div> : null}
      {pane && showConnectionOverlay && connectionState !== "attached" ? (
        <div className="terminal-overlay">
          {terminalConnectionCopy(connectionState, closeReason, hasAttachedForTerminal)}
        </div>
      ) : null}
      {uploadStatus ? (
        <div className="terminal-upload-status" role="status" aria-live="polite">
          {uploadStatus}
        </div>
      ) : null}
      {!mobileControls ? (
        <button
          className="terminal-upload-fab"
          type="button"
          aria-label="Upload file"
          title="Upload file"
          disabled={uploadDisabled}
          onClick={openFilePicker}
        >
          <Paperclip size={16} />
        </button>
      ) : null}
      {showCommandControls && pane ? (
        <TerminalCommandControls
          key={JSON.stringify([bridgeId, pane.pane_id])}
          bridgeId={bridgeId}
          paneId={pane.pane_id}
          commandInputRef={mobileCommandInputRef}
          disabled={!pane || connectionState !== "attached"}
          uploadDisabled={uploadDisabled}
          expandingInput={mobileControls ? mobileCommandExpandingInput : true}
          enterNewline={mobileControls ? mobileCommandEnterNewline : desktopCommandEnterNewline}
          mobileControls={mobileControls}
          mobileFocusAfterSubmit={mobileCommandFocusAfterSubmit}
          controlsScalePercent={mobileControls ? mobileControlsScalePercent : 100}
          onControlsHeightChange={setCommandControlsHeight}
          onInput={sendTerminalInputData}
          onTerminalFocus={() => rendererRef.current?.focusTextInput()}
          onUpload={openFilePicker}
          onStageCommand={(command) => enqueueTerminalInput([command])}
          onSubmitCommand={(command) => enqueueTerminalInput([command, "\r"])}
        />
      ) : null}
      {mobileSelectionAction ? (
        <MobileSelectionActions
          action={mobileSelectionAction}
          onOpen={openSelectionUrl}
          onCopyUrl={() => copySelectionText(mobileSelectionAction.url, "Copied URL")}
          onCopyText={() => copySelectionText(mobileSelectionAction.text, "Copied selection")}
          onClose={closeMobileSelectionActions}
        />
      ) : null}
      {uploadConflict ? (
        <ConfirmDialog
          title="Replace uploaded file?"
          message={uploadConflictMessage(uploadConflict)}
          confirmLabel="Replace"
          onCancel={() => resolveUploadConflict(false)}
          onConfirm={confirmUploadConflictReplace}
        />
      ) : null}
    </section>
  );
}

function MobileSelectionActions({
  action,
  onOpen,
  onCopyUrl,
  onCopyText,
  onClose,
}: {
  action: MobileSelectionAction;
  onOpen: () => void;
  onCopyUrl: () => void;
  onCopyText: () => void;
  onClose: () => void;
}) {
  const canCopyTextSeparately = action.text !== action.url;
  const stopInteraction = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };
  return (
    <div
      className="terminal-selection-sheet"
      role="dialog"
      aria-label="Selected URL actions"
      onPointerDown={stopInteraction}
      onPointerUp={stopInteraction}
      onTouchStart={stopInteraction}
      onTouchEnd={stopInteraction}
      onMouseDown={stopInteraction}
      onMouseUp={stopInteraction}
      onClick={stopInteraction}
    >
      <div className="terminal-selection-url mono">{action.url}</div>
      <div className="terminal-selection-actions">
        <button type="button" className="btn btn-primary" onClick={onOpen}>
          <ExternalLink size={15} />
          Open
        </button>
        <button type="button" className="btn" onClick={onCopyUrl}>
          <Link size={15} />
          Copy URL
        </button>
        {canCopyTextSeparately ? (
          <button type="button" className="btn" onClick={onCopyText}>
            <Copy size={15} />
            Copy text
          </button>
        ) : null}
        <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

const DIRECT_TERMINAL_KEYS = MOBILE_TERMINAL_SPECIAL_KEYS.filter((key) =>
  ["backspace", "arrow-left", "arrow-up", "arrow-down", "arrow-right", "enter"].includes(key.id),
);
const MORE_TERMINAL_KEYS = MOBILE_TERMINAL_SPECIAL_KEYS.filter((key) =>
  ["home", "end", "delete", "page-up", "page-down"].includes(key.id),
);
type MobileTerminalModifier = (typeof MOBILE_TERMINAL_MODIFIERS)[number]["id"];

/** Keeps terminal command drafts and mobile direct or composed keys independent. */
export function TerminalCommandControls({
  bridgeId,
  paneId,
  commandInputRef,
  disabled,
  uploadDisabled,
  expandingInput,
  enterNewline,
  mobileControls,
  mobileFocusAfterSubmit = false,
  controlsScalePercent,
  onControlsHeightChange,
  onInput,
  onTerminalFocus,
  onUpload,
  onStageCommand,
  onSubmitCommand,
}: {
  bridgeId: string;
  paneId: string;
  commandInputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  disabled: boolean;
  uploadDisabled: boolean;
  expandingInput: boolean;
  enterNewline: boolean;
  mobileControls: boolean;
  mobileFocusAfterSubmit?: boolean;
  controlsScalePercent: number;
  onControlsHeightChange: (heightPx: number | null) => void;
  onInput: (data: string) => void;
  onTerminalFocus: () => void;
  onUpload: () => void;
  onStageCommand: (command: string) => void;
  onSubmitCommand: (command: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useCommandDraft(bridgeId, paneId);
  // Keep this deadline outside the keyed field so it survives input replacement.
  const compositionGuardUntilRef = useRef(0);
  const acceptedValueRef = useRef(value);
  useLayoutEffect(() => {
    acceptedValueRef.current = value;
  }, [value]);
  const onCommandChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const input = event.nativeEvent;
    if (
      performance.now() < compositionGuardUntilRef.current &&
      input instanceof InputEvent &&
      (input.isComposing || input.inputType === "insertCompositionText" ||
        input.inputType === "insertFromComposition" || input.inputType === "deleteCompositionText")
    ) {
      // Native composition edits may not be cancelable. Restore synchronously
      // without blurring, remounting again, or clearing subsequent accepted input.
      event.currentTarget.value = acceptedValueRef.current;
      return;
    }
    acceptedValueRef.current = event.currentTarget.value;
    setValue(event.currentTarget.value);
  };
  const [fieldKey, setFieldKey] = useState(0);
  const focusAfterSubmitRef = useRef(false);
  const [moreKeysOpen, setMoreKeysOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerModifiers, setComposerModifiers] = useState<MobileTerminalModifier[]>([]);
  const [composerKey, setComposerKey] = useState<MobileTerminalChordKey | null>(null);
  const [printableKey, setPrintableKey] = useState("");
  const setCommandInputNode = (node: HTMLInputElement | HTMLTextAreaElement | null) => {
    commandInputRef.current = node;
  };
  const clearCommandInput = () => {
    compositionGuardUntilRef.current = performance.now() + 250;
    acceptedValueRef.current = "";
    setValue("");
    const node = commandInputRef.current;
    if (node) {
      node.value = "";
      node.defaultValue = "";
    }
    setFieldKey((key) => key + 1);
  };
  const submit = () => {
    focusAfterSubmitRef.current = !mobileControls || mobileFocusAfterSubmit;
    const command = value;
    clearCommandInput();
    onSubmitCommand(command);
  };
  const stage = () => {
    if (value.length === 0) {
      return;
    }
    const command = value;
    clearCommandInput();
    onStageCommand(command);
    if (!mobileControls) {
      onTerminalFocus();
    }
  };
  const resetMobileTerminalComposer = () => {
    setComposerOpen(false);
    setComposerModifiers([]);
    setComposerKey(null);
    setPrintableKey("");
  };
  const toggleComposerModifier = (modifier: MobileTerminalModifier) => {
    setComposerModifiers((current) =>
      current.includes(modifier)
        ? current.filter((candidate) => candidate !== modifier)
        : [...current, modifier],
    );
  };
  const composerChordLabel = composerKey
    ? formatMobileTerminalChord(composerKey, composerModifiers)
    : null;
  const toggleMobileTerminalComposer = () => {
    if (composerOpen) {
      resetMobileTerminalComposer();
    } else {
      setComposerOpen(true);
    }
  };
  const sendMobileTerminalChord = () => {
    if (disabled || !composerKey) {
      return;
    }
    onInput(encodeMobileTerminalChord(composerKey, composerModifiers));
    resetMobileTerminalComposer();
  };
  const chooseComposerKey = (key: MobileTerminalChordKey, modifiers: MobileTerminalModifier[] = []) => {
    const deselect = composerKey?.id === key.id;
    setComposerKey(deselect ? null : key);
    setPrintableKey("");
    if (!deselect && modifiers.length > 0) {
      setComposerModifiers((current) => [...new Set([...current, ...modifiers])]);
    }
  };
  const renderSharedKey = (key: MobileTerminalChordKey, repeat: boolean) => composerOpen ? (
    <button key={key.id} className="term-key" type="button"
      aria-label={`Use ${key.name} key`} aria-pressed={composerKey?.id === key.id}
      data-active={composerKey?.id === key.id ? "true" : "false"}
      disabled={disabled} onPointerDown={preserveTouchInputFocus}
      onClick={() => chooseComposerKey(key)}>
      {key.label}
    </button>
  ) : (
    <MobileTerminalKeyButton key={key.id} terminalKey={key} disabled={disabled}
      repeat={repeat} onInput={onInput} />
  );
  const attachQuickKeyScrollHints = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }
    const updateScrollHints = () => {
      node.dataset.scrollLeft = String(node.scrollLeft > 1);
      node.dataset.scrollRight = String(node.scrollWidth - node.clientWidth - node.scrollLeft > 1);
    };
    const observer = window.ResizeObserver ? new ResizeObserver(updateScrollHints) : null;
    observer?.observe(node);
    node.addEventListener("scroll", updateScrollHints, { passive: true });
    window.addEventListener("resize", updateScrollHints);
    updateScrollHints();
    return () => {
      observer?.disconnect();
      node.removeEventListener("scroll", updateScrollHints);
      window.removeEventListener("resize", updateScrollHints);
    };
  }, []);

  useLayoutEffect(() => {
    const node = commandInputRef.current;
    if (fieldKey > 0 && node) {
      node.value = "";
      node.defaultValue = "";
      if (focusAfterSubmitRef.current) {
        focusAfterSubmitRef.current = false;
        node.focus();
      }
    }
  }, [commandInputRef, fieldKey]);

  useLayoutEffect(() => {
    if (expandingInput) {
      autosizeMobileCommandTextarea(commandInputRef.current);
    }
  }, [commandInputRef, controlsScalePercent, expandingInput, fieldKey, value]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      onControlsHeightChange(null);
      return;
    }
    const report = () => onControlsHeightChange(root.getBoundingClientRect().height);
    report();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", report);
      return () => {
        window.removeEventListener("resize", report);
        onControlsHeightChange(null);
      };
    }
    const observer = new ResizeObserver(report);
    observer.observe(root);
    return () => {
      observer.disconnect();
      onControlsHeightChange(null);
    };
  }, [onControlsHeightChange]);

  const onCommandTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    if (!mobileControls && isCommandComposerSubmitShortcut(event)) {
      event.preventDefault();
      if (!disabled) {
        submit();
      }
      return;
    }
    if (enterNewline || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    if (!disabled) {
      submit();
    }
  };

  const stageCommandButton = (
    <button
      className={
        mobileControls
          ? "term-key term-key-icon term-stage-command"
          : "term-send term-stage-command"
      }
      type="button"
      disabled={disabled || value.length === 0}
      aria-label="Stage command in terminal"
      title="Stage"
      onClick={stage}
    >
      <TextCursorInput size={mobileControls ? 15 : 16} />
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="terminal-command-controls"
      data-expanded={mobileControls && (composerOpen || moreKeysOpen) ? "true" : "false"}
      data-mobile-controls={mobileControls ? "true" : "false"}
      data-composing={mobileControls && composerOpen ? "true" : "false"}
    >
      <div className="term-key-strip" aria-label="Common terminal keys" hidden={!mobileControls}>
        <div
          ref={mobileControls ? attachQuickKeyScrollHints : undefined}
          className="term-key-group"
          role="group"
          aria-label="Terminal quick keys"
        >
          {QUICK_TERMINAL_KEYS.map(({ key, modifiers, label }) => (
            <button key={key.id} className="term-key" type="button" disabled={disabled}
              aria-label={composerOpen ? `Use ${label} key` : undefined}
              aria-pressed={composerOpen ? composerKey?.id === key.id : undefined}
              data-active={composerOpen && composerKey?.id === key.id ? "true" : "false"}
              onPointerDown={preserveTouchInputFocus}
              onClick={() => composerOpen
                ? chooseComposerKey(key, modifiers)
                : onInput(encodeMobileTerminalChord(key, modifiers))}>
              {label}
            </button>
          ))}
        </div>
        <div className="term-key-actions" role="group" aria-label="Terminal actions">
          <button
            className="term-key term-key-icon"
            type="button"
            aria-label="Upload file"
            title="Upload"
            disabled={uploadDisabled}
            onClick={onUpload}
          >
            <Paperclip size={15} />
          </button>
          {stageCommandButton}
          <button
            className="term-key term-key-icon"
            type="button"
            aria-label={moreKeysOpen ? "Hide more keys" : "Show more keys"}
            aria-expanded={moreKeysOpen}
            title={moreKeysOpen ? "Hide more keys" : "More keys"}
            onClick={() => {
              if (moreKeysOpen) resetMobileTerminalComposer();
              setMoreKeysOpen((open) => !open);
            }}
          >
            <Keyboard size={15} aria-hidden="true" />
          </button>
          <button
            className="term-key term-key-icon"
            type="button"
            aria-label="Focus terminal keyboard"
            title="Terminal keyboard"
            disabled={disabled}
            onPointerDown={(event) => {
              if (event.pointerType === "touch" || event.pointerType === "pen") {
                event.preventDefault();
                onTerminalFocus();
              }
            }}
            onClick={onTerminalFocus}
          >
            <SquareTerminal size={15} />
          </button>
        </div>
      </div>

      {mobileControls && moreKeysOpen ? (
        <div className="term-key-direct-row" role="group" aria-label="Direct terminal keys">
          {DIRECT_TERMINAL_KEYS.map((key) => renderSharedKey(key, key.id !== "enter"))}
        </div>
      ) : null}

      {mobileControls && moreKeysOpen ? (
        <div className="term-key-more-row" role="group" aria-label="More terminal keys">
          {MORE_TERMINAL_KEYS.map((key) =>
            renderSharedKey(key, key.id !== "home" && key.id !== "end"))}
          <button
            className="term-key term-key-icon term-key-compose-action"
            type="button"
            aria-label={composerOpen ? "Close terminal key composer" : "Compose terminal key"}
            aria-expanded={composerOpen}
            aria-pressed={composerOpen}
            title={composerOpen ? "Close and discard chord" : "Compose key"}
            data-active={composerOpen ? "true" : "false"}
            disabled={disabled && !composerOpen}
            onClick={toggleMobileTerminalComposer}
          >
            <span className="term-key-compose-icon" aria-hidden="true">
              <Keyboard size={15} />
              <Plus className="term-key-compose-plus" size={8} />
            </span>
          </button>
        </div>
      ) : null}

      {mobileControls && composerOpen ? (
        <div className="term-key-composer" aria-label="Terminal key composer">
          <div className="term-key-composer-preview">
            <div className="term-key-composer-preview-label" aria-live="polite">
              <span>Building shortcut</span>
              <strong>{composerChordLabel ?? "Choose a key"}</strong>
            </div>
            <button className="term-key" type="button" aria-label="Cancel shortcut"
              onClick={resetMobileTerminalComposer}>Cancel</button>
            <button
              className="term-key term-key-chord-send"
              type="button"
              aria-label={composerChordLabel ? `Send ${composerChordLabel}` : "Send composed key"}
              title="Send composed key"
              disabled={disabled || !composerKey}
              onClick={sendMobileTerminalChord}
            >
              <Send size={16} aria-hidden="true" /> Send
            </button>
          </div>
          <div className="term-key-composer-modifiers" aria-label="Chord modifiers">
            {MOBILE_TERMINAL_MODIFIERS.map((modifier) => {
              const active = composerModifiers.includes(modifier.id);
              return (
                <button
                  key={modifier.id}
                  className="term-key"
                  type="button"
                  data-active={active ? "true" : "false"}
                  aria-pressed={active}
                  aria-label={`${active ? "Remove" : "Add"} ${modifier.label} modifier`}
                  disabled={disabled}
                  onPointerDown={preserveTouchInputFocus}
                  onClick={() => toggleComposerModifier(modifier.id)}
                >
                  {modifier.label}
                </button>
              );
            })}
          </div>
          <div className="term-key-composer-capture">
            <label>
              <span>Printable key</span>
              <input
                className="mono"
                type="text"
                aria-label="Printable key"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                inputMode="text"
                spellCheck={false}
                value={printableKey}
                disabled={disabled}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  const nextPrintableKey = Array.from(event.target.value).at(-1) ?? "";
                  setPrintableKey(nextPrintableKey);
                  setComposerKey(
                    nextPrintableKey ? mobileTerminalPrintableKey(nextPrintableKey) : null,
                  );
                }}
              />
            </label>
          </div>
          <p>Tap a key above or enter a printable key, then Send. Cancel returns to direct keys.</p>
        </div>
      ) : null}

      <form
        className="term-input-row"
        data-expanding={expandingInput ? "true" : "false"}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) {
            submit();
          }
        }}
      >
        {expandingInput ? (
          <textarea
            key={fieldKey}
            ref={setCommandInputNode}
            className="term-native-input mono"
            rows={1}
            data-expanding="true"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint={enterNewline ? "enter" : "send"}
            disabled={disabled}
            value={value}
            onChange={onCommandChange}
            onKeyDown={onCommandTextareaKeyDown}
          />
        ) : (
          <input
            key={fieldKey}
            ref={setCommandInputNode}
            className="term-native-input mono"
            type="text"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            disabled={disabled}
            value={value}
            onChange={onCommandChange}
          />
        )}
        {!mobileControls ? stageCommandButton : null}
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

/** Backwards-compatible name retained for the fork's mobile-controls callers. */
export const MobileTerminalControls = TerminalCommandControls;

type CommandComposerShortcutEvent = Pick<
  KeyboardEvent<HTMLTextAreaElement>,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

export function isCommandComposerSubmitShortcut(
  event: CommandComposerShortcutEvent,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
) {
  if (event.key !== "Enter" || event.altKey || event.shiftKey) {
    return false;
  }
  return platform.startsWith("Mac")
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

// Touch keys act on the focused terminal/input without dismissing its soft keyboard.
// Keep mouse and keyboard activation native, and send/select only through onClick.
function preserveTouchInputFocus(event: ReactPointerEvent<HTMLButtonElement>) {
  if (event.pointerType === "touch" || event.pointerType === "pen") {
    event.preventDefault();
  }
}

const QUICK_TERMINAL_KEYS: {
  key: MobileTerminalChordKey;
  modifiers: MobileTerminalModifier[];
  label: string;
}[] = [
  ...MOBILE_TERMINAL_SPECIAL_KEYS.filter((key) => ["escape", "tab"].includes(key.id))
    .map((key) => ({ key, modifiers: [], label: key.label })),
  ...["c", "d"].map((value) => ({
    key: mobileTerminalPrintableKey(value), modifiers: ["ctrl" as const], label: `C-${value}`,
  })),
  ...["1", "2", "3"].map((value) => ({
    key: mobileTerminalPrintableKey(value), modifiers: [], label: value,
  })),
];

function uploadCandidatesFromFileList(files: FileList | null): UploadCandidate[] {
  if (!files) {
    return [];
  }
  return Array.from(files).map((file) => ({
    blob: file,
    name: file.name.trim() || null,
  }));
}

function uploadCandidatesFromClipboard(data: DataTransfer): UploadCandidate[] {
  const files: UploadCandidate[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") {
      continue;
    }
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    files.push({
      blob: file,
      name: file.name.trim() || null,
    });
  }
  return files;
}

function uploadConflictMessage(conflict: UploadConflictState) {
  return conflict.path
    ? `${conflict.name} already exists at ${conflict.path}.`
    : `${conflict.name} already exists.`;
}
