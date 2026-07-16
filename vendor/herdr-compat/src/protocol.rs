mod wire;

pub use wire::*;

const EXTERNAL_OPEN_PROTOCOL_VERSION: u32 = 17;

#[derive(serde::Serialize)]
enum Protocol16ClientMessage {
    Hello {
        version: u32,
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
        requested_encoding: RenderEncoding,
        keybindings: ClientKeybindings,
        launch_mode: ClientLaunchMode,
    },
}

pub fn write_terminal_attach_hello<W: std::io::Write>(
    writer: &mut W,
    version: u32,
    cols: u16,
    rows: u16,
) -> Result<(), FramingError> {
    if version < EXTERNAL_OPEN_PROTOCOL_VERSION {
        return write_message(
            writer,
            &Protocol16ClientMessage::Hello {
                version,
                cols,
                rows,
                cell_width_px: 0,
                cell_height_px: 0,
                requested_encoding: RenderEncoding::TerminalAnsi,
                keybindings: ClientKeybindings::Server,
                launch_mode: ClientLaunchMode::TerminalAttach,
            },
        );
    }

    write_message(
        writer,
        &ClientMessage::Hello {
            version,
            cols,
            rows,
            cell_width_px: 0,
            cell_height_px: 0,
            requested_encoding: RenderEncoding::TerminalAnsi,
            keybindings: ClientKeybindings::Server,
            launch_mode: ClientLaunchMode::TerminalAttach,
            external_open_policy: None,
            external_open_attachment_id: None,
        },
    )
}

#[cfg(test)]
mod bridge_fixture_tests {
    use super::*;

    #[test]
    fn protocol_version_matches_reviewed_herdr_snapshot() {
        assert_eq!(PROTOCOL_VERSION, 17);
    }

    #[test]
    fn terminal_attach_hello_preserves_protocol_16_wire_fixture() {
        let mut frame = Vec::new();
        write_terminal_attach_hello(&mut frame, 16, 80, 24).unwrap();

        assert_eq!(frame, vec![9, 0, 0, 0, 0, 16, 80, 24, 0, 0, 1, 0, 1]);
    }

    #[test]
    fn client_hello_wire_fixture_matches_reviewed_snapshot() {
        let msg = ClientMessage::Hello {
            version: PROTOCOL_VERSION,
            cols: 80,
            rows: 24,
            cell_width_px: 8,
            cell_height_px: 16,
            requested_encoding: RenderEncoding::SemanticFrame,
            keybindings: ClientKeybindings::Server,
            launch_mode: ClientLaunchMode::TerminalAttach,
            external_open_policy: None,
            external_open_attachment_id: None,
        };
        let mut frame = Vec::new();
        write_message(&mut frame, &msg).unwrap();

        assert_eq!(
            frame,
            vec![11, 0, 0, 0, 0, 17, 80, 24, 8, 16, 0, 0, 1, 0, 0]
        );
        let decoded: ClientMessage = read_message(&mut frame.as_slice(), MAX_FRAME_SIZE).unwrap();
        assert_eq!(decoded, msg);
    }

    #[test]
    fn server_welcome_wire_fixture_matches_reviewed_snapshot() {
        let msg = ServerMessage::Welcome {
            version: PROTOCOL_VERSION,
            encoding: RenderEncoding::TerminalAnsi,
            error: None,
        };
        let mut frame = Vec::new();
        write_message(&mut frame, &msg).unwrap();

        assert_eq!(frame, vec![4, 0, 0, 0, 0, 17, 1, 0]);
        let decoded: ServerMessage = read_message(&mut frame.as_slice(), MAX_FRAME_SIZE).unwrap();
        assert_eq!(decoded, msg);
    }
}
