//! WebSocket ping and peer-activity deadlines for removing dead browser connections.

use std::time::Duration;

use tokio::time::Instant;

const WEBSOCKET_PING_INTERVAL: Duration = Duration::from_secs(30);
const WEBSOCKET_PEER_TIMEOUT: Duration = Duration::from_secs(15);

/// The next action when a WebSocket probe or peer-reply deadline expires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WebSocketHeartbeatAction {
    /// Send a protocol-level ping for a legacy client.
    SendPing,
    /// Send both a protocol ping and a JavaScript-visible liveness probe.
    SendApplicationProbe { nonce: u64 },
    /// Drop the socket because its required reply did not arrive.
    Disconnect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WebSocketHeartbeatPhase {
    WaitingToPing,
    WaitingForPeer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WebSocketHeartbeatMode {
    LegacyPeerActivity,
    ApplicationAcknowledgement,
}

/// Tracks when a bridge WebSocket should probe its browser and when silence is fatal.
pub(crate) struct WebSocketHeartbeat {
    mode: WebSocketHeartbeatMode,
    phase: WebSocketHeartbeatPhase,
    deadline: Instant,
    next_nonce: u64,
    awaited_nonce: Option<u64>,
}

impl WebSocketHeartbeat {
    /// Starts the backward-compatible heartbeat used by clients without connection identity.
    pub(crate) fn new(now: Instant) -> Self {
        Self::with_mode(now, WebSocketHeartbeatMode::LegacyPeerActivity)
    }

    /// Starts a heartbeat that requires JavaScript to acknowledge each probe.
    pub(crate) fn new_application_liveness(now: Instant) -> Self {
        Self::with_mode(now, WebSocketHeartbeatMode::ApplicationAcknowledgement)
    }

    fn with_mode(now: Instant, mode: WebSocketHeartbeatMode) -> Self {
        Self {
            mode,
            phase: WebSocketHeartbeatPhase::WaitingToPing,
            deadline: now + WEBSOCKET_PING_INTERVAL,
            next_nonce: 1,
            awaited_nonce: None,
        }
    }

    /// Returns the next probe or peer-reply deadline.
    pub(crate) fn deadline(&self) -> Instant {
        self.deadline
    }

    /// Advances the heartbeat when its current deadline expires.
    pub(crate) fn handle_deadline(&mut self, now: Instant) -> WebSocketHeartbeatAction {
        match self.phase {
            WebSocketHeartbeatPhase::WaitingToPing => {
                self.phase = WebSocketHeartbeatPhase::WaitingForPeer;
                self.deadline = now + WEBSOCKET_PEER_TIMEOUT;
                match self.mode {
                    WebSocketHeartbeatMode::LegacyPeerActivity => {
                        WebSocketHeartbeatAction::SendPing
                    }
                    WebSocketHeartbeatMode::ApplicationAcknowledgement => {
                        let nonce = self.next_nonce;
                        self.next_nonce = self.next_nonce.wrapping_add(1).max(1);
                        self.awaited_nonce = Some(nonce);
                        WebSocketHeartbeatAction::SendApplicationProbe { nonce }
                    }
                }
            }
            WebSocketHeartbeatPhase::WaitingForPeer => WebSocketHeartbeatAction::Disconnect,
        }
    }

    /// Records an inbound frame only for a legacy client. Managed clients must run JavaScript.
    pub(crate) fn record_peer_activity(&mut self, now: Instant) {
        if self.mode == WebSocketHeartbeatMode::LegacyPeerActivity {
            self.arm_next_probe(now);
        }
    }

    /// Records the exact JavaScript acknowledgement for the outstanding managed-client probe.
    pub(crate) fn record_application_ack(&mut self, now: Instant, nonce: u64) -> bool {
        if self.mode != WebSocketHeartbeatMode::ApplicationAcknowledgement
            || self.phase != WebSocketHeartbeatPhase::WaitingForPeer
            || self.awaited_nonce != Some(nonce)
        {
            return false;
        }
        self.arm_next_probe(now);
        true
    }

    fn arm_next_probe(&mut self, now: Instant) {
        self.phase = WebSocketHeartbeatPhase::WaitingToPing;
        self.deadline = now + WEBSOCKET_PING_INTERVAL;
        self.awaited_nonce = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_disconnects_when_ping_receives_no_peer_activity() {
        let started_at = Instant::now();
        let mut heartbeat = WebSocketHeartbeat::new(started_at);
        let ping_at = started_at + WEBSOCKET_PING_INTERVAL;

        assert_eq!(heartbeat.deadline(), ping_at);
        assert_eq!(
            heartbeat.handle_deadline(ping_at),
            WebSocketHeartbeatAction::SendPing
        );

        let timeout_at = ping_at + WEBSOCKET_PEER_TIMEOUT;
        assert_eq!(heartbeat.deadline(), timeout_at);
        assert_eq!(
            heartbeat.handle_deadline(timeout_at),
            WebSocketHeartbeatAction::Disconnect
        );
    }

    #[test]
    fn legacy_peer_activity_arms_the_next_ping_instead_of_disconnect() {
        let started_at = Instant::now();
        let mut heartbeat = WebSocketHeartbeat::new(started_at);
        let ping_at = started_at + WEBSOCKET_PING_INTERVAL;
        assert_eq!(
            heartbeat.handle_deadline(ping_at),
            WebSocketHeartbeatAction::SendPing
        );

        let activity_at = ping_at + Duration::from_secs(1);
        heartbeat.record_peer_activity(activity_at);
        let next_ping_at = activity_at + WEBSOCKET_PING_INTERVAL;

        assert_eq!(heartbeat.deadline(), next_ping_at);
        assert_eq!(
            heartbeat.handle_deadline(next_ping_at),
            WebSocketHeartbeatAction::SendPing
        );
    }

    #[test]
    fn managed_socket_requires_exact_application_ack_not_protocol_activity() {
        let started_at = Instant::now();
        let mut heartbeat = WebSocketHeartbeat::new_application_liveness(started_at);
        let ping_at = started_at + WEBSOCKET_PING_INTERVAL;
        assert_eq!(
            heartbeat.handle_deadline(ping_at),
            WebSocketHeartbeatAction::SendApplicationProbe { nonce: 1 }
        );

        heartbeat.record_peer_activity(ping_at + Duration::from_secs(1));
        assert!(!heartbeat.record_application_ack(ping_at + Duration::from_secs(2), 99,));
        assert_eq!(
            heartbeat.handle_deadline(ping_at + WEBSOCKET_PEER_TIMEOUT),
            WebSocketHeartbeatAction::Disconnect
        );
    }

    #[test]
    fn exact_application_ack_arms_the_next_probe() {
        let started_at = Instant::now();
        let mut heartbeat = WebSocketHeartbeat::new_application_liveness(started_at);
        let ping_at = started_at + WEBSOCKET_PING_INTERVAL;
        assert_eq!(
            heartbeat.handle_deadline(ping_at),
            WebSocketHeartbeatAction::SendApplicationProbe { nonce: 1 }
        );

        let ack_at = ping_at + Duration::from_secs(1);
        assert!(heartbeat.record_application_ack(ack_at, 1));
        let next_probe_at = ack_at + WEBSOCKET_PING_INTERVAL;
        assert_eq!(heartbeat.deadline(), next_probe_at);
        assert_eq!(
            heartbeat.handle_deadline(next_probe_at),
            WebSocketHeartbeatAction::SendApplicationProbe { nonce: 2 }
        );
    }
}
