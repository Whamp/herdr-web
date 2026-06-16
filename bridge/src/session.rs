use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

pub const SESSION_ENV_VAR: &str = "HERDR_SESSION";
const DEFAULT_SESSION_NAME: &str = "default";

static EXPLICIT_SESSION_REQUESTED: AtomicBool = AtomicBool::new(false);

pub fn explicit_session_requested() -> bool {
    EXPLICIT_SESSION_REQUESTED.load(Ordering::Relaxed)
}

pub fn active_name() -> Option<String> {
    std::env::var(SESSION_ENV_VAR)
        .ok()
        .filter(|name| name != DEFAULT_SESSION_NAME)
        .filter(|name| is_valid_session_name(name))
}

pub fn data_dir() -> PathBuf {
    data_dir_for(active_name().as_deref())
}

pub fn data_dir_for(name: Option<&str>) -> PathBuf {
    let config_dir = herdr_compat::config::config_dir();
    match name {
        Some(name) => config_dir.join("sessions").join(name),
        None => config_dir,
    }
}

pub fn api_socket_path_for(name: Option<&str>) -> PathBuf {
    data_dir_for(name).join("herdr.sock")
}

pub fn active_api_socket_path() -> PathBuf {
    if explicit_session_requested() {
        return api_socket_path_for(active_name().as_deref());
    }
    if let Ok(path) = std::env::var(herdr_compat::api::SOCKET_PATH_ENV_VAR) {
        return PathBuf::from(path);
    }
    api_socket_path_for(active_name().as_deref())
}

pub fn client_socket_path_for(name: Option<&str>) -> PathBuf {
    data_dir_for(name).join("herdr-client.sock")
}

pub fn active_client_socket_path() -> PathBuf {
    if explicit_session_requested() {
        return client_socket_path_for(active_name().as_deref());
    }
    herdr_compat::server::socket_paths::client_socket_path_from_overrides(
        std::env::var(herdr_compat::api::SOCKET_PATH_ENV_VAR)
            .ok()
            .as_deref(),
        std::env::var(herdr_compat::server::socket_paths::CLIENT_SOCKET_PATH_ENV_VAR)
            .ok()
            .as_deref(),
        client_socket_path_for(active_name().as_deref()),
    )
}

fn is_valid_session_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}
