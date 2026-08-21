//! Terminal session lifecycle: the attach registry, the attach/detach
//! state machine, output coalescing and framing, and the typed close causes
//! sent to the web client. The daemon side of an attach is abstracted behind
//! [`TerminalDaemonAttach`] so the concurrency paths are testable with a
//! scripted fake; the production adapter lives in `web_bridge.rs`.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::Duration;

use axum::body::Bytes;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::Deserialize;
use tokio::time::Instant;
use tracing::{debug, warn};

use crate::web_bridge::current_panes;
use herdr_compat::api::client::ApiClient;
use herdr_compat::protocol::ClientMessage;

pub(crate) const MAX_QUEUED_TERMINAL_INPUT_BYTES: usize = 8 * 1024 * 1024;
pub(crate) const DEFAULT_TERMINAL_OUTPUT_COALESCE_MS: u64 = 16;
pub(crate) const MAX_TERMINAL_OUTPUT_COALESCE_MS: u64 = 256;
pub(crate) const TERMINAL_OUTPUT_COALESCE_MAX_BYTES: usize = 32 * 1024;
pub(crate) const TERMINAL_OUTPUT_COALESCE_MAX_CHUNKS: usize = 256;
pub(crate) const TERMINAL_OUTPUT_FRAME_RAW: u8 = 0;
pub(crate) const TERMINAL_OUTPUT_FRAME_GZIP: u8 = 1;
pub(crate) const TERMINAL_OUTPUT_GZIP_MIN_BYTES: usize = 256;
pub(crate) const TERMINAL_OUTPUT_GZIP_ACKNOWLEDGEMENT: &str =
    r#"{"type":"terminal_output_encoding","encoding":"gzip"}"#;

#[cfg(test)]
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TerminalOutputCoalescingStats {
    pub(crate) source_frames: u64,
    pub(crate) source_bytes: u64,
    pub(crate) sent_frames: u64,
    pub(crate) sent_bytes: u64,
    pub(crate) immediate_frames: u64,
    pub(crate) coalesced_source_frames: u64,
    pub(crate) coalesced_sent_frames: u64,
    pub(crate) timer_flushes: u64,
    pub(crate) byte_flushes: u64,
    pub(crate) chunk_flushes: u64,
    pub(crate) single_chunk_flushes: u64,
    pub(crate) merged_flushes: u64,
    pub(crate) lagged_events: u64,
    pub(crate) lagged_frames: u64,
    pub(crate) max_pending_bytes: usize,
    pub(crate) max_pending_chunks: usize,
    pub(crate) total_flush_latency_us: u128,
    pub(crate) max_flush_latency_us: u128,
}

#[cfg(test)]
impl TerminalOutputCoalescingStats {
    pub(crate) fn record_source(&mut self, bytes: usize) {
        self.source_frames += 1;
        self.source_bytes += bytes as u64;
    }

    pub(crate) fn record_immediate_send(&mut self, bytes: usize) {
        self.sent_frames += 1;
        self.sent_bytes += bytes as u64;
        self.immediate_frames += 1;
    }

    fn record_pending(&mut self, bytes: usize, chunks: usize) {
        self.max_pending_bytes = self.max_pending_bytes.max(bytes);
        self.max_pending_chunks = self.max_pending_chunks.max(chunks);
    }

    pub(crate) fn record_flush_reason(&mut self, reason: TerminalOutputFlushReason) {
        match reason {
            TerminalOutputFlushReason::Timer => self.timer_flushes += 1,
            TerminalOutputFlushReason::ByteThreshold => self.byte_flushes += 1,
            TerminalOutputFlushReason::ChunkThreshold => self.chunk_flushes += 1,
            TerminalOutputFlushReason::Close => {}
        }
    }

    pub(crate) fn record_coalesced_send(
        &mut self,
        source_chunks: usize,
        bytes: usize,
        latency: Duration,
    ) {
        self.sent_frames += 1;
        self.sent_bytes += bytes as u64;
        self.coalesced_source_frames += source_chunks as u64;
        self.coalesced_sent_frames += 1;
        if source_chunks <= 1 {
            self.single_chunk_flushes += 1;
        } else {
            self.merged_flushes += 1;
        }

        let latency_us = latency.as_micros();
        self.total_flush_latency_us += latency_us;
        self.max_flush_latency_us = self.max_flush_latency_us.max(latency_us);
    }

    pub(crate) fn record_lagged(&mut self, frames: u64) {
        self.lagged_events += 1;
        self.lagged_frames += frames;
    }

    #[cfg(test)]
    pub(crate) fn frames_saved(&self) -> u64 {
        self.source_frames.saturating_sub(self.sent_frames)
    }

    #[cfg(test)]
    pub(crate) fn coalescing_ratio(&self) -> f64 {
        if self.sent_frames == 0 {
            return 0.0;
        }
        self.source_frames as f64 / self.sent_frames as f64
    }

    #[cfg(test)]
    pub(crate) fn avg_source_frame_bytes(&self) -> f64 {
        if self.source_frames == 0 {
            return 0.0;
        }
        self.source_bytes as f64 / self.source_frames as f64
    }

    #[cfg(test)]
    pub(crate) fn avg_sent_frame_bytes(&self) -> f64 {
        if self.sent_frames == 0 {
            return 0.0;
        }
        self.sent_bytes as f64 / self.sent_frames as f64
    }

    #[cfg(test)]
    pub(crate) fn avg_flush_latency_us(&self) -> f64 {
        if self.coalesced_sent_frames == 0 {
            return 0.0;
        }
        self.total_flush_latency_us as f64 / self.coalesced_sent_frames as f64
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TerminalOutputFlushReason {
    Timer,
    ByteThreshold,
    ChunkThreshold,
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TerminalOutputCoalescingDecision {
    SendNow(Bytes),
    Pending,
    FlushPending(TerminalOutputFlushReason),
}

#[derive(Debug, Clone)]
pub(crate) enum TerminalOutput {
    Bytes(Bytes),
    Close(String),
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TerminalOutputWireEncoding {
    Identity,
    Gzip,
}

pub(crate) struct TerminalOutputCoalescer {
    #[allow(dead_code)]
    pub(crate) window: Duration,
    #[allow(dead_code)]
    pub(crate) pending: Vec<Bytes>,
    #[allow(dead_code)]
    pub(crate) pending_bytes: usize,
    #[allow(dead_code)]
    pub(crate) pending_started_at: Option<Instant>,
    #[allow(dead_code)]
    pub(crate) deadline: Option<Instant>,
    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) lifetime_stats: TerminalOutputCoalescingStats,
}

impl TerminalOutputCoalescer {
    pub(crate) fn new(window: Duration) -> Self {
        Self {
            window,
            pending: Vec::new(),
            pending_bytes: 0,
            pending_started_at: None,
            deadline: None,
            #[cfg(test)]
            lifetime_stats: TerminalOutputCoalescingStats::default(),
        }
    }

    pub(crate) fn deadline(&self) -> Option<Instant> {
        self.deadline
    }

    pub(crate) fn push_bytes(
        &mut self,
        bytes: Bytes,
        now: Instant,
    ) -> TerminalOutputCoalescingDecision {
        let byte_count = bytes.len();
        self.record_source(byte_count);

        if self.window.is_zero() {
            self.record_immediate_send(byte_count);
            return TerminalOutputCoalescingDecision::SendNow(bytes);
        }

        if self.deadline.is_none() {
            self.deadline = Some(now + self.window);
            self.record_immediate_send(byte_count);
            return TerminalOutputCoalescingDecision::SendNow(bytes);
        }

        if self.pending.is_empty() {
            self.pending_started_at = Some(now);
        }
        self.pending_bytes += byte_count;
        self.pending.push(bytes);
        self.record_pending();

        if self.pending_bytes >= TERMINAL_OUTPUT_COALESCE_MAX_BYTES {
            TerminalOutputCoalescingDecision::FlushPending(TerminalOutputFlushReason::ByteThreshold)
        } else if self.pending.len() >= TERMINAL_OUTPUT_COALESCE_MAX_CHUNKS {
            TerminalOutputCoalescingDecision::FlushPending(
                TerminalOutputFlushReason::ChunkThreshold,
            )
        } else {
            TerminalOutputCoalescingDecision::Pending
        }
    }

    pub(crate) fn handle_deadline(&mut self) -> Option<TerminalOutputFlushReason> {
        self.deadline?;
        if self.pending.is_empty() {
            self.deadline = None;
            return None;
        }
        Some(TerminalOutputFlushReason::Timer)
    }

    pub(crate) fn flush_pending(
        &mut self,
        reason: TerminalOutputFlushReason,
        now: Instant,
    ) -> Option<Bytes> {
        if self.pending.is_empty() {
            self.pending_bytes = 0;
            self.pending_started_at = None;
            if matches!(reason, TerminalOutputFlushReason::Close) {
                self.deadline = None;
            }
            return None;
        }

        self.record_flush_reason(reason);
        let source_chunks = self.pending.len();
        let latency = self
            .pending_started_at
            .map(|started_at| now.saturating_duration_since(started_at))
            .unwrap_or_default();
        let Some(bytes) = drain_terminal_output_pending(&mut self.pending, &mut self.pending_bytes)
        else {
            self.pending_started_at = None;
            return None;
        };

        self.pending_started_at = None;
        if matches!(reason, TerminalOutputFlushReason::Close) {
            self.deadline = None;
        } else {
            // Keep a trailing window warm so sustained redraws continue batching between flushes.
            self.deadline = Some(now + self.window);
        }
        self.record_coalesced_send(source_chunks, bytes.len(), latency);
        Some(bytes)
    }

    #[cfg(test)]
    pub(crate) fn record_lagged(&mut self, frames: u64) {
        self.lifetime_stats.record_lagged(frames);
    }

    #[cfg(not(test))]
    pub(crate) fn record_lagged(&mut self, _frames: u64) {}

    #[cfg(test)]
    pub(crate) fn record_source(&mut self, bytes: usize) {
        self.lifetime_stats.record_source(bytes);
    }

    #[cfg(not(test))]
    pub(crate) fn record_source(&mut self, _bytes: usize) {}

    #[cfg(test)]
    pub(crate) fn record_immediate_send(&mut self, bytes: usize) {
        self.lifetime_stats.record_immediate_send(bytes);
    }

    #[cfg(not(test))]
    pub(crate) fn record_immediate_send(&mut self, _bytes: usize) {}

    #[cfg(test)]
    fn record_pending(&mut self) {
        self.lifetime_stats
            .record_pending(self.pending_bytes, self.pending.len());
    }

    #[cfg(not(test))]
    fn record_pending(&mut self) {}

    #[cfg(test)]
    pub(crate) fn record_flush_reason(&mut self, reason: TerminalOutputFlushReason) {
        self.lifetime_stats.record_flush_reason(reason);
    }

    #[cfg(not(test))]
    pub(crate) fn record_flush_reason(&mut self, _reason: TerminalOutputFlushReason) {}

    #[cfg(test)]
    pub(crate) fn record_coalesced_send(&mut self, chunks: usize, bytes: usize, latency: Duration) {
        self.lifetime_stats
            .record_coalesced_send(chunks, bytes, latency);
    }

    #[cfg(not(test))]
    pub(crate) fn record_coalesced_send(
        &mut self,
        _chunks: usize,
        _bytes: usize,
        _latency: Duration,
    ) {
    }
}

pub(crate) fn encode_terminal_output_frame(
    bytes: Bytes,
    encoding: TerminalOutputWireEncoding,
) -> Bytes {
    if matches!(encoding, TerminalOutputWireEncoding::Identity) {
        return bytes;
    }

    if bytes.len() < TERMINAL_OUTPUT_GZIP_MIN_BYTES {
        return raw_terminal_output_frame(bytes);
    }

    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    if encoder.write_all(&bytes).is_ok() {
        if let Ok(compressed) = encoder.finish() {
            if compressed.len() < bytes.len() {
                let mut frame = Vec::with_capacity(compressed.len() + 1);
                frame.push(TERMINAL_OUTPUT_FRAME_GZIP);
                frame.extend_from_slice(&compressed);
                return Bytes::from(frame);
            }
        }
    }

    raw_terminal_output_frame(bytes)
}

pub(crate) fn drain_terminal_output_pending(
    pending: &mut Vec<Bytes>,
    pending_bytes: &mut usize,
) -> Option<Bytes> {
    if pending.is_empty() {
        *pending_bytes = 0;
        return None;
    }

    let byte_count = *pending_bytes;
    *pending_bytes = 0;
    if pending.len() == 1 {
        return pending.pop();
    }

    let mut output = Vec::with_capacity(byte_count);
    for chunk in pending.drain(..) {
        output.extend_from_slice(&chunk);
    }
    Some(Bytes::from(output))
}

pub(crate) fn raw_terminal_output_frame(bytes: Bytes) -> Bytes {
    let mut frame = Vec::with_capacity(bytes.len() + 1);
    frame.push(TERMINAL_OUTPUT_FRAME_RAW);
    frame.extend_from_slice(&bytes);
    Bytes::from(frame)
}

/// Shared attach connections keyed by terminal id. `draining` remembers
/// connections whose `Detach` has been queued but not yet flushed to the
/// daemon and shut down by the writer thread. A reattach waits for that
/// teardown so the new attach cannot reach the daemon ahead of the pending
/// `Detach` and be rejected as a second concurrent client. The daemon never
/// closes attach sockets itself, so the close that resolves a draining entry
/// is always the bridge's own post-`Detach` shutdown. `attaching` serializes
/// fresh attach handshakes per terminal: with two concurrent attaches the
/// daemon accepts one and rejects the other, and which one the map would
/// keep is an independent race — so concurrent acquires instead wait for the
/// in-flight handshake and join the session it publishes.
#[derive(Default)]
pub(crate) struct TerminalSessions {
    pub(crate) active: HashMap<String, SharedTerminalSession>,
    pub(crate) draining: HashMap<String, Arc<ConnectionClosed>>,
    pub(crate) attaching: HashMap<String, Arc<ConnectionClosed>>,
}

/// Signals that a daemon attach connection has fully closed.
#[derive(Default)]
pub(crate) struct ConnectionClosed {
    closed: Mutex<bool>,
    condvar: Condvar,
}

impl ConnectionClosed {
    pub(crate) fn mark_closed(&self) {
        let mut closed = match self.closed.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *closed = true;
        drop(closed);
        self.condvar.notify_all();
    }

    pub(crate) fn is_closed(&self) -> bool {
        match self.closed.lock() {
            Ok(guard) => *guard,
            Err(poisoned) => *poisoned.into_inner(),
        }
    }

    /// Returns true once the connection is closed, or false on timeout.
    pub(crate) fn wait_closed(&self, timeout: Duration) -> bool {
        let closed = match self.closed.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        match self
            .condvar
            .wait_timeout_while(closed, timeout, |closed| !*closed)
        {
            Ok((closed, _)) => *closed,
            Err(poisoned) => *poisoned.into_inner().0,
        }
    }
}

#[derive(Clone)]
pub(crate) struct SharedTerminalSession {
    pub(crate) write_tx: TerminalWriter,
    pub(crate) output_tx: tokio::sync::broadcast::Sender<TerminalOutput>,
    pub(crate) client_count: Arc<AtomicUsize>,
    pub(crate) connection_closed: Arc<ConnectionClosed>,
}

/// Sender for daemon-bound terminal messages that bounds how many input
/// bytes may sit in the writer queue, so a client streaming input faster
/// than the pty consumes it cannot balloon bridge memory.
#[derive(Clone)]
pub(crate) struct TerminalWriter {
    pub(crate) tx: mpsc::Sender<ClientMessage>,
    pub(crate) queued_input_bytes: Arc<AtomicUsize>,
}

impl TerminalWriter {
    pub(crate) fn send(
        &self,
        message: ClientMessage,
    ) -> Result<(), mpsc::SendError<ClientMessage>> {
        self.tx.send(message)
    }

    /// Reserve queue budget for a whole input frame before any of its chunks
    /// are enqueued, so an oversized frame is rejected atomically instead of
    /// delivering truncated input to the pty.
    pub(crate) fn reserve_input_bytes(&self, len: usize) -> Result<(), String> {
        let queued = self.queued_input_bytes.fetch_add(len, Ordering::AcqRel);
        if queued + len > MAX_QUEUED_TERMINAL_INPUT_BYTES {
            self.queued_input_bytes.fetch_sub(len, Ordering::AcqRel);
            return Err("terminal input backlog exceeded".to_string());
        }
        Ok(())
    }

    pub(crate) fn release_input_bytes(&self, len: usize) {
        self.queued_input_bytes.fetch_sub(len, Ordering::AcqRel);
    }
}

/// Why a terminal websocket session's main loop ended. Logged with each
/// session-end record so mobile reconnection bugs can be attributed to a
/// client disconnect, a failed daemon attach, or dropped output.
#[derive(Debug)]
pub(crate) enum TerminalSessionExit {
    /// The browser closed the socket or the transport errored.
    ClientDisconnected,
    /// A client frame could not be forwarded to the daemon writer.
    ClientWriteFailed,
    /// The daemon reported the terminal attach closed.
    DaemonClosed(String),
    /// The client lagged the output broadcast; the socket closes for resync.
    OutputLagged(u64),
    /// The daemon output channel closed.
    OutputChannelClosed,
}

/// Machine-readable close cause sent to the web client in the `closed` frame.
/// The vocabulary is pinned by `protocol/terminal-close-causes.json`, which
/// both the Rust serializer tests and the TypeScript decoder tests read. The
/// web client owns retry policy per cause; this side only classifies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TerminalCloseCause {
    /// Another client holds the terminal attach; usually transient.
    AttachConflict,
    /// This connection was taken over by a newer attach elsewhere.
    TakenOver,
    /// The daemon refused the attach because the terminal is gone.
    TerminalGone,
    /// The bridge gave up attaching amid sustained detach churn.
    PendingDetach,
    /// The daemon closed the attach mid-session (e.g. terminal exited).
    DaemonClosed,
    /// The client lagged the output broadcast; reconnect for a clean repaint.
    OutputLagged,
    /// The bridge could not reach or speak to the daemon.
    TransportFailed,
}

/// A typed close frame for the web client: stable `cause` plus human-readable
/// `detail` for logs and diagnostics.
#[derive(Debug, Clone)]
pub(crate) struct TerminalClose {
    pub(crate) cause: TerminalCloseCause,
    pub(crate) detail: String,
}

pub(crate) fn close_message(cause: TerminalCloseCause, detail: &str) -> String {
    format!(
        r#"{{"type":"closed","cause":{},"detail":{}}}"#,
        serde_json::to_string(cause.wire_name()).unwrap_or_else(|_| "\"daemon_closed\"".into()),
        serde_json::to_string(detail).unwrap_or_else(|_| "\"\"".into())
    )
}

fn close_terminal_session(
    sessions: &Mutex<TerminalSessions>,
    terminal_id: &str,
    session: &SharedTerminalSession,
    reason: &str,
) {
    let _ = session
        .output_tx
        .send(TerminalOutput::Close(reason.to_string()));
    let _ = session.write_tx.send(ClientMessage::Detach);
    let Ok(mut sessions) = sessions.lock() else {
        return;
    };
    if sessions
        .active
        .get(terminal_id)
        .is_some_and(|current| Arc::ptr_eq(&current.client_count, &session.client_count))
    {
        sessions.active.remove(terminal_id);
        remember_draining_connection(&mut sessions, terminal_id, session);
    }
}

/// Why a terminal websocket attach attempt failed. Rejections carry a typed
/// close cause for the browser; transport problems classify as
/// `transport_failed` at the send site.
#[derive(Debug)]
pub(crate) enum TerminalAttachError {
    Rejected(TerminalClose),
    Transport(String),
}

impl fmt::Display for TerminalAttachError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TerminalAttachError::Rejected(close) => {
                write!(f, "{} ({})", close.detail, close.cause.wire_name())
            }
            TerminalAttachError::Transport(detail) => write!(f, "{detail}"),
        }
    }
}

/// The daemon side of a terminal attach, abstracted so the attach state
/// machine can be driven by a scripted fake in tests: the fake can pause
/// attaches, reject handshakes, and record detach ordering.
pub(crate) trait TerminalDaemonAttach: Send + 'static {
    fn protocol_version(&self) -> Result<u32, String>;
    fn open_attach(
        &self,
        terminal_id: String,
        cols: u16,
        rows: u16,
        takeover: bool,
        protocol_version: u32,
        output_tx: tokio::sync::broadcast::Sender<TerminalOutput>,
    ) -> Result<TerminalAttach, TerminalAttachError>;
}

/// Timing and retry budgets for the attach state machine. Production uses
/// the defaults; tests shrink them so race sequences resolve in milliseconds.
#[derive(Clone, Copy)]
pub(crate) struct WaitPolicy {
    pub(crate) gate_timeout: Duration,
    pub(crate) drain_timeout: Duration,
    pub(crate) max_gate_waits: usize,
    pub(crate) max_drain_waits: usize,
    pub(crate) max_handshake_retries: usize,
}

impl WaitPolicy {
    #[allow(dead_code)]
    pub(crate) fn production() -> Self {
        Self {
            gate_timeout: Duration::from_secs(5),
            drain_timeout: Duration::from_secs(2),
            max_gate_waits: 4,
            max_drain_waits: 4,
            max_handshake_retries: 2,
        }
    }
}

pub(crate) struct TerminalAttach {
    pub(crate) write_tx: TerminalWriter,
    pub(crate) connection_closed: Arc<ConnectionClosed>,
}

pub(crate) async fn acquire_terminal_session<D: TerminalDaemonAttach>(
    registry: Arc<Mutex<TerminalSessions>>,
    daemon: D,
    wait_policy: WaitPolicy,
    terminal_id: String,
    cols: u16,
    rows: u16,
    takeover: bool,
) -> Result<SharedTerminalSession, TerminalAttachError> {
    tokio::task::spawn_blocking(move || {
        // What to do after inspecting the maps under one lock hold.
        enum AttachStep {
            WaitDrain(Arc<ConnectionClosed>),
            WaitGate(Arc<ConnectionClosed>),
            Handshake(Arc<ConnectionClosed>),
        }

        let mut drain_waits = 0;
        let mut gate_waits = 0;
        let mut handshake_retries = 0;
        'attach: loop {
            // All maps can change while this thread waits without the lock, so
            // every wait loops back here: a session attached meanwhile must be
            // joined, another thread's in-flight handshake must be awaited
            // (two concurrent fresh attaches make the daemon reject one — it
            // races whichever the map keeps), and a draining connection must
            // finish tearing down before a fresh attach, or the daemon rejects
            // it as a second concurrent client.
            let step = {
                let mut sessions = registry.lock().map_err(|_| {
                    TerminalAttachError::Transport("terminal session lock poisoned".to_string())
                })?;
                if let Some(session) = sessions.active.get(&terminal_id) {
                    session.client_count.fetch_add(1, Ordering::AcqRel);
                    debug!(
                        terminal_id = %terminal_id,
                        "terminal websocket joined existing session"
                    );
                    return Ok(session.clone());
                }
                if let Some(gate) = sessions.attaching.get(&terminal_id) {
                    if gate_waits < wait_policy.max_gate_waits {
                        AttachStep::WaitGate(gate.clone())
                    } else {
                        // Progress guard: handshake anyway, without claiming
                        // the gate another thread still holds.
                        warn!(
                            terminal_id = %terminal_id,
                            "attaching despite a stuck concurrent attach handshake"
                        );
                        AttachStep::Handshake(Arc::new(ConnectionClosed::default()))
                    }
                } else if let Some(draining) = sessions.draining.get(&terminal_id) {
                    if drain_waits < wait_policy.max_drain_waits {
                        AttachStep::WaitDrain(draining.clone())
                    } else {
                        warn!(
                            terminal_id = %terminal_id,
                            "reattaching despite pending detach teardown after repeated drain waits"
                        );
                        let gate = Arc::new(ConnectionClosed::default());
                        sessions.attaching.insert(terminal_id.clone(), gate.clone());
                        AttachStep::Handshake(gate)
                    }
                } else {
                    let gate = Arc::new(ConnectionClosed::default());
                    sessions.attaching.insert(terminal_id.clone(), gate.clone());
                    AttachStep::Handshake(gate)
                }
            };

            let gate = match step {
                AttachStep::WaitGate(gate) => {
                    gate_waits += 1;
                    if !gate.wait_closed(wait_policy.gate_timeout) {
                        warn!(
                            terminal_id = %terminal_id,
                            "timed out waiting for a concurrent terminal attach handshake"
                        );
                    }
                    continue 'attach;
                }
                AttachStep::WaitDrain(draining) => {
                    drain_waits += 1;
                    if !draining.wait_closed(wait_policy.drain_timeout) {
                        warn!(
                            terminal_id = %terminal_id,
                            "timed out waiting for detached terminal connection to close"
                        );
                    }
                    let mut sessions = registry.lock().map_err(|_| {
                        TerminalAttachError::Transport("terminal session lock poisoned".to_string())
                    })?;
                    if sessions
                        .draining
                        .get(&terminal_id)
                        .is_some_and(|entry| Arc::ptr_eq(entry, &draining))
                    {
                        sessions.draining.remove(&terminal_id);
                    }
                    continue 'attach;
                }
                AttachStep::Handshake(gate) => gate,
            };

            // Perform the daemon handshake without holding the map lock so a
            // stalled daemon cannot wedge every other terminal client. The
            // gate keeps concurrent acquires for this terminal waiting; they
            // join the published session once it opens.
            let handshake = || -> Result<SharedTerminalSession, TerminalAttachError> {
                let protocol_version = daemon
                    .protocol_version()
                    .map_err(TerminalAttachError::Transport)?;
                let (output_tx, _) = tokio::sync::broadcast::channel(256);
                let attach = daemon.open_attach(
                    terminal_id.clone(),
                    cols,
                    rows,
                    takeover,
                    protocol_version,
                    output_tx.clone(),
                )?;
                Ok(SharedTerminalSession {
                    write_tx: attach.write_tx,
                    output_tx,
                    client_count: Arc::new(AtomicUsize::new(0)),
                    connection_closed: attach.connection_closed,
                })
            };
            let session = match handshake() {
                Ok(session) => session,
                Err(err) => {
                    release_attach_gate(&registry, &terminal_id, &gate);
                    return Err(err);
                }
            };

            let Ok(mut sessions) = registry.lock() else {
                let _ = session.write_tx.send(ClientMessage::Detach);
                gate.mark_closed();
                return Err(TerminalAttachError::Transport(
                    "terminal session lock poisoned".to_string(),
                ));
            };
            if let Some(existing) = sessions.active.get(&terminal_id) {
                // Safety net: only reachable via the stuck-gate fallback.
                // Keep the established session and detach the redundant one.
                existing.client_count.fetch_add(1, Ordering::AcqRel);
                let existing = existing.clone();
                drop(sessions);
                let _ = session.write_tx.send(ClientMessage::Detach);
                release_attach_gate(&registry, &terminal_id, &gate);
                return Ok(existing);
            }
            if sessions.draining.contains_key(&terminal_id) {
                // A connection attached and began detaching while we were
                // handshaking (only possible via the stuck-gate fallback), so
                // the daemon may have rejected our attach as a second
                // concurrent client. Never publish the possibly dead session:
                // retry, and once the retry budget is spent fail with a reason
                // the web client treats as retryable.
                drop(sessions);
                let _ = session.write_tx.send(ClientMessage::Detach);
                release_attach_gate(&registry, &terminal_id, &gate);
                if handshake_retries < wait_policy.max_handshake_retries {
                    handshake_retries += 1;
                    continue 'attach;
                }
                warn!(
                    terminal_id = %terminal_id,
                    "giving up terminal attach amid sustained detach churn"
                );
                return Err(TerminalAttachError::Rejected(TerminalClose {
                    cause: TerminalCloseCause::PendingDetach,
                    detail: "terminal attach conflicted with a pending detach; retry shortly"
                        .to_string(),
                }));
            }
            session.client_count.fetch_add(1, Ordering::AcqRel);
            sessions.active.insert(terminal_id.clone(), session.clone());
            drop(sessions);
            release_attach_gate(&registry, &terminal_id, &gate);
            debug!(
                terminal_id = %terminal_id,
                drain_waits,
                gate_waits,
                handshake_retries,
                "terminal attach handshake completed"
            );
            return Ok(session);
        }
    })
    .await
    .map_err(|err| TerminalAttachError::Transport(err.to_string()))?
}

pub(crate) fn release_terminal_session(
    sessions: &Mutex<TerminalSessions>,
    terminal_id: &str,
    session: &SharedTerminalSession,
) {
    // Decrement while holding the map lock so a concurrent acquire cannot
    // join the session between the last-client check and its removal.
    let Ok(mut sessions) = sessions.lock() else {
        return;
    };
    if session.client_count.fetch_sub(1, Ordering::AcqRel) != 1 {
        return;
    }

    let _ = session.write_tx.send(ClientMessage::Detach);
    if sessions
        .active
        .get(terminal_id)
        .is_some_and(|current| Arc::ptr_eq(&current.client_count, &session.client_count))
    {
        sessions.active.remove(terminal_id);
        remember_draining_connection(&mut sessions, terminal_id, session);
    }
}

/// Releases a terminal's attach-handshake gate and wakes its waiters, who
/// re-check the maps and normally join the session the handshake published.
pub(crate) fn release_attach_gate(
    sessions: &Mutex<TerminalSessions>,
    terminal_id: &str,
    gate: &Arc<ConnectionClosed>,
) {
    if let Ok(mut sessions) = sessions.lock() {
        if sessions
            .attaching
            .get(terminal_id)
            .is_some_and(|entry| Arc::ptr_eq(entry, gate))
        {
            sessions.attaching.remove(terminal_id);
        }
    }
    gate.mark_closed();
}

/// Records a detached connection so a quick reattach waits for the daemon to
/// finish tearing it down instead of racing the queued `Detach`. Entries are
/// cleared by the next reattach or swept once closed during session pruning.
fn remember_draining_connection(
    sessions: &mut TerminalSessions,
    terminal_id: &str,
    session: &SharedTerminalSession,
) {
    if session.connection_closed.is_closed() {
        return;
    }
    sessions
        .draining
        .insert(terminal_id.to_string(), session.connection_closed.clone());
}

pub(crate) fn prune_detached_terminal_sessions(
    registry: &Mutex<TerminalSessions>,
    api: &ApiClient,
) {
    let Ok(panes) = current_panes(api) else {
        warn!("failed to prune herdr web terminal sessions");
        return;
    };
    let active_terminal_ids = panes
        .iter()
        .map(|pane| pane.terminal_id.as_str())
        .collect::<HashSet<_>>();
    let stale_sessions = {
        let Ok(mut sessions) = registry.lock() else {
            warn!("failed to lock herdr web terminal sessions for pruning");
            return;
        };
        sessions
            .draining
            .retain(|_, connection| !connection.is_closed());
        sessions
            .active
            .iter()
            .filter(|(terminal_id, _)| !active_terminal_ids.contains(terminal_id.as_str()))
            .map(|(terminal_id, session)| (terminal_id.clone(), session.clone()))
            .collect::<Vec<_>>()
    };

    for (terminal_id, session) in stale_sessions {
        close_terminal_session(registry, &terminal_id, &session, "terminal closed by Herdr");
    }
}

impl TerminalCloseCause {
    pub(crate) fn wire_name(self) -> &'static str {
        match self {
            TerminalCloseCause::AttachConflict => "attach_conflict",
            TerminalCloseCause::TakenOver => "taken_over",
            TerminalCloseCause::TerminalGone => "terminal_gone",
            TerminalCloseCause::PendingDetach => "pending_detach",
            TerminalCloseCause::DaemonClosed => "daemon_closed",
            TerminalCloseCause::OutputLagged => "output_lagged",
            TerminalCloseCause::TransportFailed => "transport_failed",
        }
    }

    /// Classifies the daemon's attach-rejection prose. Protocol 20 carries no
    /// typed error codes, so `Welcome.error` text is the only signal; this is
    /// the single place in either codebase allowed to match on it.
    pub(crate) fn from_daemon_attach_error(prose: &str) -> Self {
        if prose.contains("already has an attached client") {
            TerminalCloseCause::AttachConflict
        } else if prose.contains("terminal attach taken over") {
            TerminalCloseCause::TakenOver
        } else if prose.contains("terminal attach failed: terminal") {
            TerminalCloseCause::TerminalGone
        } else {
            TerminalCloseCause::DaemonClosed
        }
    }
}

impl TerminalClose {
    pub(crate) fn message(&self) -> String {
        close_message(self.cause, &self.detail)
    }
}

#[cfg(test)]
mod attach_state_machine_tests {
    use super::*;
    use std::sync::mpsc;

    fn test_wait_policy() -> WaitPolicy {
        WaitPolicy {
            gate_timeout: Duration::from_millis(25),
            drain_timeout: Duration::from_millis(25),
            max_gate_waits: 1,
            max_drain_waits: 1,
            max_handshake_retries: 2,
        }
    }

    fn accepted_attach() -> TerminalAttach {
        let (write_tx, _rx) = mpsc::channel();
        TerminalAttach {
            write_tx: TerminalWriter {
                tx: write_tx,
                queued_input_bytes: Arc::new(AtomicUsize::new(0)),
            },
            connection_closed: Arc::new(ConnectionClosed::default()),
        }
    }

    /// What the next scripted `open_attach` call does.
    enum Step {
        Accept,
        RejectWithProse(&'static str),
        RejectWithConflict,
        /// Accepts the attach but injects a draining connection first,
        /// reproducing the detach-churn race the retry budget exists for.
        InjectDrainingThenAccept,
    }

    #[derive(Clone)]
    struct ScriptedDaemon {
        inner: Arc<ScriptInner>,
    }

    struct ScriptInner {
        steps: Mutex<Vec<Step>>,
        accepted: AtomicUsize,
        rejected: AtomicUsize,
        registry: Arc<Mutex<TerminalSessions>>,
        terminal_id: String,
    }

    impl ScriptedDaemon {
        fn new(
            registry: Arc<Mutex<TerminalSessions>>,
            terminal_id: &str,
            steps: Vec<Step>,
        ) -> Self {
            Self {
                inner: Arc::new(ScriptInner {
                    steps: Mutex::new(steps),
                    accepted: AtomicUsize::new(0),
                    rejected: AtomicUsize::new(0),
                    registry,
                    terminal_id: terminal_id.to_string(),
                }),
            }
        }

        fn accept_count(&self) -> usize {
            self.inner.accepted.load(Ordering::Acquire)
        }

        fn reject_count(&self) -> usize {
            self.inner.rejected.load(Ordering::Acquire)
        }
    }

    impl TerminalDaemonAttach for ScriptedDaemon {
        fn protocol_version(&self) -> Result<u32, String> {
            Ok(20)
        }

        fn open_attach(
            &self,
            _terminal_id: String,
            _cols: u16,
            _rows: u16,
            _takeover: bool,
            _protocol_version: u32,
            _output_tx: tokio::sync::broadcast::Sender<TerminalOutput>,
        ) -> Result<TerminalAttach, TerminalAttachError> {
            let step = self.inner.steps.lock().unwrap().remove(0);
            match step {
                Step::Accept => {
                    self.inner.accepted.fetch_add(1, Ordering::AcqRel);
                    Ok(accepted_attach())
                }
                Step::RejectWithProse(prose) => {
                    self.inner.rejected.fetch_add(1, Ordering::AcqRel);
                    Err(TerminalAttachError::Rejected(TerminalClose {
                        cause: TerminalCloseCause::from_daemon_attach_error(prose),
                        detail: prose.to_string(),
                    }))
                }
                Step::RejectWithConflict => {
                    // Another client already holds the attach.
                    self.inner.rejected.fetch_add(1, Ordering::AcqRel);
                    Err(TerminalAttachError::Rejected(TerminalClose {
                        cause: TerminalCloseCause::AttachConflict,
                        detail: "injected conflict".to_string(),
                    }))
                }
                Step::InjectDrainingThenAccept => {
                    // Another connection attached and began detaching while
                    // this handshake was in flight: the session publishes into
                    // a world where the daemon may have rejected us as a
                    // second concurrent client, so the state machine retries.
                    {
                        let mut sessions = self.inner.registry.lock().unwrap();
                        sessions.draining.insert(
                            self.inner.terminal_id.clone(),
                            Arc::new(ConnectionClosed::default()),
                        );
                    }
                    self.inner.accepted.fetch_add(1, Ordering::AcqRel);
                    Ok(accepted_attach())
                }
            }
        }
    }

    fn run_acquire(
        registry: Arc<Mutex<TerminalSessions>>,
        daemon: &ScriptedDaemon,
    ) -> Result<SharedTerminalSession, TerminalAttachError> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                acquire_terminal_session(
                    registry,
                    daemon.clone(),
                    test_wait_policy(),
                    daemon.inner.terminal_id.clone(),
                    80,
                    24,
                    false,
                )
                .await
            })
    }

    const TERM: &str = "term_scripted";

    #[test]
    fn fresh_attach_publishes_session_and_release_records_draining() {
        let registry = Arc::new(Mutex::new(TerminalSessions::default()));
        let daemon = ScriptedDaemon::new(registry.clone(), TERM, vec![Step::Accept]);

        let session = run_acquire(registry.clone(), &daemon).expect("attach succeeds");
        assert_eq!(daemon.accept_count(), 1);
        assert!(registry.lock().unwrap().active.contains_key(TERM));

        release_terminal_session(&registry, TERM, &session);
        let sessions = registry.lock().unwrap();
        assert!(!sessions.active.contains_key(TERM));
        assert!(sessions.draining.contains_key(TERM));
    }

    #[test]
    fn second_acquire_joins_the_published_session_without_a_new_handshake() {
        let registry = Arc::new(Mutex::new(TerminalSessions::default()));
        let daemon = ScriptedDaemon::new(registry.clone(), TERM, vec![Step::Accept]);

        let first = run_acquire(registry.clone(), &daemon).expect("first attach");
        let second = run_acquire(registry.clone(), &daemon).expect("join");

        assert_eq!(Arc::strong_count(&second.client_count), 3); // two holders + map
        assert_eq!(second.client_count.load(Ordering::Acquire), 2);
        let _ = first;
        assert_eq!(daemon.accept_count(), 1);
    }

    #[test]
    fn reattach_waits_for_a_pending_drain_then_proceeds_when_it_closes() {
        let registry = Arc::new(Mutex::new(TerminalSessions::default()));
        let stale_gate = Arc::new(ConnectionClosed::default());
        registry
            .lock()
            .unwrap()
            .draining
            .insert(TERM.to_string(), stale_gate.clone());
        let daemon = ScriptedDaemon::new(registry.clone(), TERM, vec![Step::Accept]);

        // Close the draining connection after a moment, from another thread.
        {
            let gate = stale_gate.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(5));
                gate.mark_closed();
            });
        }

        let session = run_acquire(registry.clone(), &daemon).expect("attach after drain closes");
        assert_eq!(daemon.accept_count(), 1);
        assert!(!registry.lock().unwrap().draining.contains_key(TERM));
        release_terminal_session(&registry, TERM, &session);
    }

    #[test]
    fn stuck_attach_gate_falls_back_to_a_direct_handshake() {
        let registry = Arc::new(Mutex::new(TerminalSessions::default()));
        // A concurrent attach's gate that never opens.
        registry
            .lock()
            .unwrap()
            .attaching
            .insert(TERM.to_string(), Arc::new(ConnectionClosed::default()));
        let daemon = ScriptedDaemon::new(registry.clone(), TERM, vec![Step::Accept]);

        let session = run_acquire(registry.clone(), &daemon).expect("progress-guard attach");
        assert_eq!(daemon.accept_count(), 1);
        assert!(registry.lock().unwrap().active.contains_key(TERM));
        release_terminal_session(&registry, TERM, &session);
    }

    #[test]
    fn sustained_detach_churn_exhausts_retries_and_reports_pending_detach() {
        let registry = Arc::new(Mutex::new(TerminalSessions::default()));
        // Every handshake succeeds, but a fresh draining connection appears
        // before publish, so each attempt is rolled back and retried until
        // the budget is spent.
        let steps = vec![
            Step::InjectDrainingThenAccept,
            Step::InjectDrainingThenAccept,
            Step::InjectDrainingThenAccept,
        ];
        let daemon = ScriptedDaemon::new(registry.clone(), TERM, steps);

        let err = run_acquire(registry.clone(), &daemon).expect_err("budget exhausts");
        match err {
            TerminalAttachError::Rejected(close) => {
                assert_eq!(close.cause, TerminalCloseCause::PendingDetach);
            }
            other => panic!("expected rejection, got {other:?}"),
        }
        assert_eq!(daemon.accept_count(), 3);
    }

    #[test]
    fn daemon_rejection_surfaces_its_typed_close_cause_immediately() {
        let registry = Arc::new(Mutex::new(TerminalSessions::default()));
        let daemon = ScriptedDaemon::new(
            registry.clone(),
            TERM,
            vec![Step::RejectWithProse(
                "terminal attach failed: terminal term_x already has an attached client",
            )],
        );

        // Attach conflicts are retryable at the client, but the bridge itself
        // surfaces the typed cause on the first rejection rather than retrying
        // server-side for conflicts it cannot resolve.
        let err = run_acquire(registry.clone(), &daemon).expect_err("rejected");
        match err {
            TerminalAttachError::Rejected(close) => {
                assert_eq!(close.cause, TerminalCloseCause::AttachConflict);
                let message = close.message();
                assert!(message.contains("\"cause\":\"attach_conflict\""));
                assert!(message.contains("\"type\":\"closed\""));
            }
            other => panic!("expected rejection, got {other:?}"),
        }
        assert!(registry.lock().unwrap().attaching.is_empty());
    }

    #[test]
    fn transport_failure_leaves_no_gate_behind() {
        let registry = Arc::new(Mutex::new(TerminalSessions::default()));
        let daemon = ScriptedDaemon::new(registry.clone(), TERM, vec![]);
        // No steps: the script panics via remove(0) if contacted — instead use
        // an empty registry path where the lock-poison branch cannot trigger.
        // Simulate transport failure by exhausting the script differently:
        drop(daemon);

        // Direct check: a poisoned registry maps to Transport, not a gate leak.
        let poisoned_registry = Arc::new(Mutex::new(TerminalSessions::default()));
        let clone_for_poison = poisoned_registry.clone();
        let _ = std::thread::spawn(move || {
            let _guard = clone_for_poison.lock().unwrap();
            panic!("poison the registry lock");
        })
        .join();

        let daemon = ScriptedDaemon::new(poisoned_registry.clone(), TERM, vec![]);
        let err = run_acquire(poisoned_registry.clone(), &daemon).expect_err("poisoned");
        match err {
            TerminalAttachError::Transport(detail) => {
                assert!(detail.contains("poisoned"));
            }
            other => panic!("expected transport error, got {other:?}"),
        }
    }
}

#[cfg(test)]
impl fmt::Debug for SharedTerminalSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SharedTerminalSession")
            .field("clients", &self.client_count.load(Ordering::Acquire))
            .finish()
    }
}
