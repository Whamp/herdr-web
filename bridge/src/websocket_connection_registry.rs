//! Exact-predecessor ownership for reconnecting browser WebSockets.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::{Arc, Mutex};

use tokio::sync::watch;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConnectionRegistrationError {
    HandleGenerationFailed,
    StalePredecessor,
}

const MAX_RELEASED_CONNECTION_SLOTS: usize = 4096;

#[derive(Clone, Default)]
pub(crate) struct WebSocketConnectionRegistry {
    inner: Arc<WebSocketConnectionRegistryInner>,
}

#[derive(Default)]
struct WebSocketConnectionRegistryInner {
    state: Mutex<WebSocketConnectionRegistryState>,
}

#[derive(Default)]
struct WebSocketConnectionRegistryState {
    slots: HashMap<String, ConnectionSlot>,
    next_release_order: u64,
}

enum ConnectionSlot {
    Live(RegisteredConnection),
    Released(ReleasedConnection),
}

struct ReleasedConnection {
    handle: Arc<str>,
    release_order: u64,
}

#[derive(Clone)]
struct ConnectionOwner {
    handle: Arc<str>,
    cancellation_tx: watch::Sender<bool>,
}

struct RegisteredConnection {
    owner: ConnectionOwner,
    phase: ConnectionPhase,
    active_predecessor: Option<ConnectionOwner>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ConnectionPhase {
    Attaching,
    Active,
}

impl WebSocketConnectionRegistry {
    pub(crate) fn register(
        &self,
        slot_id: &str,
        predecessor_handle: Option<&str>,
    ) -> Result<WebSocketConnectionLease, ConnectionRegistrationError> {
        let handle = generate_connection_handle()?;
        let (cancellation_tx, cancellation_rx) = watch::channel(false);
        let owner = ConnectionOwner {
            handle: handle.clone(),
            cancellation_tx,
        };

        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous_slot = state.slots.remove(slot_id);
        let active_predecessor = match previous_slot {
            None => {
                if predecessor_handle.is_some() {
                    return Err(ConnectionRegistrationError::StalePredecessor);
                }
                None
            }
            Some(ConnectionSlot::Released(released)) => {
                if predecessor_handle.is_some()
                    && predecessor_handle != Some(released.handle.as_ref())
                {
                    state
                        .slots
                        .insert(slot_id.to_string(), ConnectionSlot::Released(released));
                    return Err(ConnectionRegistrationError::StalePredecessor);
                }
                None
            }
            Some(ConnectionSlot::Live(mut current)) => {
                if predecessor_handle != Some(current.owner.handle.as_ref()) {
                    state
                        .slots
                        .insert(slot_id.to_string(), ConnectionSlot::Live(current));
                    return Err(ConnectionRegistrationError::StalePredecessor);
                }
                match current.phase {
                    ConnectionPhase::Active => Some(current.owner),
                    ConnectionPhase::Attaching => {
                        current.owner.cancellation_tx.send_replace(true);
                        current.active_predecessor.take()
                    }
                }
            }
        };
        state.slots.insert(
            slot_id.to_string(),
            ConnectionSlot::Live(RegisteredConnection {
                owner,
                phase: ConnectionPhase::Attaching,
                active_predecessor,
            }),
        );
        drop(state);

        Ok(WebSocketConnectionLease {
            registry: self.clone(),
            slot_id: slot_id.to_string(),
            handle,
            cancellation_rx,
        })
    }
}

pub(crate) struct WebSocketConnectionLease {
    registry: WebSocketConnectionRegistry,
    slot_id: String,
    handle: Arc<str>,
    cancellation_rx: watch::Receiver<bool>,
}

impl WebSocketConnectionLease {
    pub(crate) fn handle(&self) -> &str {
        &self.handle
    }

    /// Marks this connection ready to own its slot, then cancels the active predecessor.
    /// Returns false when a newer connection replaced this one while it was attaching.
    pub(crate) fn activate(&mut self) -> bool {
        let active_predecessor = {
            let mut state = self
                .registry
                .inner
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(ConnectionSlot::Live(current)) = state.slots.get_mut(&self.slot_id) else {
                return false;
            };
            if current.owner.handle != self.handle {
                return false;
            }
            current.phase = ConnectionPhase::Active;
            current.active_predecessor.take()
        };
        if let Some(predecessor) = active_predecessor {
            predecessor.cancellation_tx.send_replace(true);
        }
        true
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        *self.cancellation_rx.borrow()
    }

    pub(crate) async fn cancelled(&mut self) {
        while !self.is_cancelled() {
            if self.cancellation_rx.changed().await.is_err() {
                break;
            }
        }
    }
}

impl Drop for WebSocketConnectionLease {
    fn drop(&mut self) {
        let mut state = self
            .registry
            .inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(slot) = state.slots.remove(&self.slot_id) else {
            return;
        };

        match slot {
            ConnectionSlot::Live(mut current) if current.owner.handle == self.handle => {
                let restore = (current.phase == ConnectionPhase::Attaching)
                    .then(|| current.active_predecessor.take())
                    .flatten()
                    .filter(|predecessor| !*predecessor.cancellation_tx.borrow());
                if let Some(predecessor) = restore {
                    state.slots.insert(
                        self.slot_id.clone(),
                        ConnectionSlot::Live(RegisteredConnection {
                            owner: predecessor,
                            phase: ConnectionPhase::Active,
                            active_predecessor: None,
                        }),
                    );
                } else {
                    state.remember_released(self.slot_id.clone(), self.handle.clone());
                }
            }
            ConnectionSlot::Live(mut current) => {
                if current
                    .active_predecessor
                    .as_ref()
                    .is_some_and(|predecessor| predecessor.handle == self.handle)
                {
                    current.active_predecessor = None;
                }
                state
                    .slots
                    .insert(self.slot_id.clone(), ConnectionSlot::Live(current));
            }
            released @ ConnectionSlot::Released(_) => {
                state.slots.insert(self.slot_id.clone(), released);
            }
        }
    }
}

impl WebSocketConnectionRegistryState {
    fn remember_released(&mut self, slot_id: String, handle: Arc<str>) {
        let release_order = self.next_release_order;
        self.next_release_order = self.next_release_order.saturating_add(1);
        self.slots.insert(
            slot_id,
            ConnectionSlot::Released(ReleasedConnection {
                handle,
                release_order,
            }),
        );

        let released_count = self
            .slots
            .values()
            .filter(|slot| matches!(slot, ConnectionSlot::Released(_)))
            .count();
        if released_count <= MAX_RELEASED_CONNECTION_SLOTS {
            return;
        }
        let oldest_released_slot = self
            .slots
            .iter()
            .filter_map(|(slot_id, slot)| match slot {
                ConnectionSlot::Released(released) => {
                    Some((slot_id.clone(), released.release_order))
                }
                ConnectionSlot::Live(_) => None,
            })
            .min_by_key(|(_, release_order)| *release_order)
            .map(|(slot_id, _)| slot_id);
        if let Some(slot_id) = oldest_released_slot {
            self.slots.remove(&slot_id);
        }
    }
}

fn generate_connection_handle() -> Result<Arc<str>, ConnectionRegistrationError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| ConnectionRegistrationError::HandleGenerationFailed)?;
    let mut handle = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut handle, "{byte:02x}").expect("writing to String cannot fail");
    }
    Ok(Arc::from(handle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_predecessor_is_cancelled_only_after_replacement_activates() {
        let registry = WebSocketConnectionRegistry::default();
        let mut predecessor = registry.register("terminal-view", None).unwrap();
        assert!(predecessor.activate());

        let mut replacement = registry
            .register("terminal-view", Some(predecessor.handle()))
            .unwrap();
        assert!(!predecessor.is_cancelled());

        assert!(replacement.activate());
        assert!(predecessor.is_cancelled());
    }

    #[test]
    fn delayed_attempt_cannot_replace_the_exact_predecessors_winner() {
        let registry = WebSocketConnectionRegistry::default();
        let mut predecessor = registry.register("events", None).unwrap();
        assert!(predecessor.activate());
        let predecessor_handle = predecessor.handle().to_string();

        let mut winner = registry
            .register("events", Some(&predecessor_handle))
            .unwrap();
        assert!(winner.activate());

        let stale = registry.register("events", Some(&predecessor_handle));
        assert_eq!(
            stale.err(),
            Some(ConnectionRegistrationError::StalePredecessor)
        );

        let current_handle = winner.handle().to_string();
        assert!(registry.register("events", Some(&current_handle)).is_ok());
    }

    #[test]
    fn released_exact_predecessor_can_resume_without_identity_reset() {
        let registry = WebSocketConnectionRegistry::default();
        let mut predecessor = registry.register("terminal-view", None).unwrap();
        assert!(predecessor.activate());
        let predecessor_handle = predecessor.handle().to_string();
        drop(predecessor);

        let mut resumed = registry
            .register("terminal-view", Some(&predecessor_handle))
            .unwrap();
        assert!(resumed.activate());
    }

    #[test]
    fn older_released_handle_cannot_replace_newer_released_winner() {
        let registry = WebSocketConnectionRegistry::default();
        let mut first = registry.register("events", None).unwrap();
        assert!(first.activate());
        let first_handle = first.handle().to_string();
        drop(first);

        let mut second = registry.register("events", Some(&first_handle)).unwrap();
        assert!(second.activate());
        let second_handle = second.handle().to_string();
        drop(second);

        let stale = registry.register("events", Some(&first_handle));
        assert_eq!(
            stale.err(),
            Some(ConnectionRegistrationError::StalePredecessor)
        );
        assert!(registry.register("events", Some(&second_handle)).is_ok());
    }

    #[test]
    fn replacing_one_slot_does_not_cancel_another_viewer() {
        let registry = WebSocketConnectionRegistry::default();
        let mut first_viewer = registry.register("terminal-view-a", None).unwrap();
        let mut second_viewer = registry.register("terminal-view-b", None).unwrap();
        assert!(first_viewer.activate());
        assert!(second_viewer.activate());

        let mut replacement = registry
            .register("terminal-view-a", Some(first_viewer.handle()))
            .unwrap();
        assert!(replacement.activate());

        assert!(first_viewer.is_cancelled());
        assert!(!second_viewer.is_cancelled());
    }

    #[test]
    fn newer_attempt_cancels_pending_attach_but_preserves_active_predecessor() {
        let registry = WebSocketConnectionRegistry::default();
        let mut active = registry.register("terminal-view", None).unwrap();
        assert!(active.activate());

        let mut pending = registry
            .register("terminal-view", Some(active.handle()))
            .unwrap();
        let mut newest = registry
            .register("terminal-view", Some(pending.handle()))
            .unwrap();

        assert!(pending.is_cancelled());
        assert!(!active.is_cancelled());
        assert!(!pending.activate());

        assert!(newest.activate());
        assert!(active.is_cancelled());
    }

    #[tokio::test]
    async fn newer_attempt_promptly_wakes_pending_attach_handler() {
        let registry = WebSocketConnectionRegistry::default();
        let mut active = registry.register("terminal-view", None).unwrap();
        assert!(active.activate());
        let mut pending = registry
            .register("terminal-view", Some(active.handle()))
            .unwrap();
        let pending_handle = pending.handle().to_string();

        let waiter = tokio::spawn(async move {
            pending.cancelled().await;
            pending.is_cancelled()
        });
        let _newest = registry
            .register("terminal-view", Some(&pending_handle))
            .unwrap();

        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(25), waiter)
                .await
                .expect("pending handler wakes promptly")
                .expect("pending handler task completes")
        );
        assert!(!active.is_cancelled());
    }

    #[test]
    fn dropped_pending_attempt_restores_its_active_predecessor() {
        let registry = WebSocketConnectionRegistry::default();
        let mut active = registry.register("terminal-view", None).unwrap();
        assert!(active.activate());
        let active_handle = active.handle().to_string();

        let pending = registry
            .register("terminal-view", Some(&active_handle))
            .unwrap();
        drop(pending);

        assert!(registry
            .register("terminal-view", Some(&active_handle))
            .is_ok());
        assert!(!active.is_cancelled());
    }

    #[test]
    fn closed_predecessor_is_not_restored_when_pending_attempt_drops() {
        let registry = WebSocketConnectionRegistry::default();
        let mut active = registry.register("terminal-view", None).unwrap();
        assert!(active.activate());

        let pending = registry
            .register("terminal-view", Some(active.handle()))
            .unwrap();
        drop(active);
        drop(pending);

        assert!(registry.register("terminal-view", None).is_ok());
    }
}
