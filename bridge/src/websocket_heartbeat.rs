//! WebSocket ping and peer-activity deadlines for removing dead browser connections.

use std::time::Duration;

use tokio::time::Instant;

const WEBSOCKET_PING_INTERVAL: Duration = Duration::from_secs(30);
const WEBSOCKET_PEER_TIMEOUT: Duration = Duration::from_secs(15);

/// The next action when a WebSocket ping or peer-reply deadline expires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WebSocketHeartbeatAction {
    /// Send a protocol-level ping and start the peer-reply timeout.
    SendPing,
    /// Drop the socket because no peer frame arrived after the ping.
    Disconnect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WebSocketHeartbeatPhase {
    WaitingToPing,
    WaitingForPeer,
}

/// Tracks when a bridge WebSocket should ping its browser and when silence is fatal.
pub(crate) struct WebSocketHeartbeat {
    phase: WebSocketHeartbeatPhase,
    deadline: Instant,
}

impl WebSocketHeartbeat {
    /// Starts a heartbeat that sends its first ping after 30 silent seconds.
    pub(crate) fn new(now: Instant) -> Self {
        Self {
            phase: WebSocketHeartbeatPhase::WaitingToPing,
            deadline: now + WEBSOCKET_PING_INTERVAL,
        }
    }

    /// Returns the next ping or peer-reply deadline.
    pub(crate) fn deadline(&self) -> Instant {
        self.deadline
    }

    /// Advances the heartbeat when its current deadline expires.
    pub(crate) fn handle_deadline(&mut self, now: Instant) -> WebSocketHeartbeatAction {
        match self.phase {
            WebSocketHeartbeatPhase::WaitingToPing => {
                self.phase = WebSocketHeartbeatPhase::WaitingForPeer;
                self.deadline = now + WEBSOCKET_PEER_TIMEOUT;
                WebSocketHeartbeatAction::SendPing
            }
            WebSocketHeartbeatPhase::WaitingForPeer => WebSocketHeartbeatAction::Disconnect,
        }
    }

    /// Records any inbound peer frame and schedules the next idle ping.
    pub(crate) fn record_peer_activity(&mut self, now: Instant) {
        self.phase = WebSocketHeartbeatPhase::WaitingToPing;
        self.deadline = now + WEBSOCKET_PING_INTERVAL;
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
    fn peer_activity_arms_the_next_ping_instead_of_disconnect() {
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
}
