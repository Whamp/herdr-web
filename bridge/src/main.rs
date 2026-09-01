mod agent_activity;
mod agent_pins;
mod launcher_presets;
mod notes;
mod session;
mod store_util;
mod terminal_session;
mod web_bridge;
mod websocket_connection_registry;
mod websocket_heartbeat;
mod workspace;

fn main() -> std::io::Result<()> {
    init_tracing();
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(web_bridge::run_command(&args)?);
}

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_env("HERDR_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .init();
}
