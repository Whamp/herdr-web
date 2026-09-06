import type { CellFlags, GhosttyTerminal } from "ghostty-web";
import { openableHttpUrl, terminalSelectionRange } from "./terminalSelection";
import type { TerminalSelectionPoint } from "./terminalSelection";

// Match Ghostty CellFlags.INVISIBLE without eagerly loading its WASM bundle.
const INVISIBLE_CELL_FLAG: CellFlags = 32;

/** Owns terminal link clicks before Ghostty's unfiltered opener; disposal removes only this handler. */
export function installTerminalLinkClickHandler(
  element: HTMLElement,
  onClick: (event: MouseEvent) => void,
) {
  const handleClick = (event: MouseEvent) => {
    // Rejected URLs and mouse-tracking clicks must not fall through to Ghostty's Ctrl/Meta opener.
    event.stopImmediatePropagation();
    onClick(event);
  };
  element.addEventListener("click", handleClick, { capture: true });
  return () => element.removeEventListener("click", handleClick, { capture: true });
}

/** Resolves a terminal hyperlink at an absolute buffer row, including scrollback; only HTTP(S) is openable. */
export function terminalHyperlinkAt(terminal: GhosttyTerminal, row: number, col: number) {
  const scrollbackLength = terminal.getScrollbackLength();
  const uri =
    row < scrollbackLength
      ? terminal.getScrollbackHyperlinkUri(row, col)
      : terminal.getHyperlinkUri(row - scrollbackLength, col);
  return uri ? openableHttpUrl(uri) : null;
}

/** Finds the first visible HTTP(S) hyperlink in a selection whose rows are absolute buffer positions. */
export function terminalHyperlinkInSelection(
  terminal: GhosttyTerminal,
  start: TerminalSelectionPoint,
  end: TerminalSelectionPoint,
) {
  const range = terminalSelectionRange(start, end, terminal.cols);
  const scrollbackLength = terminal.getScrollbackLength();
  for (let row = range.from.row; row <= range.to.row; row += 1) {
    const cells =
      row < scrollbackLength
        ? terminal.getScrollbackLine(row)
        : terminal.getLine(row - scrollbackLength);
    if (!cells) {
      continue;
    }
    const firstCol = row === range.from.row ? range.from.col : 0;
    const lastCol = row === range.to.row ? range.to.col : terminal.cols - 1;
    for (let col = firstCol; col <= lastCol; col += 1) {
      const cell = cells[col];
      if (!cell?.hyperlink_id || cell.flags & INVISIBLE_CELL_FLAG) {
        continue;
      }
      const url = terminalHyperlinkAt(terminal, row, col);
      if (url) {
        return url;
      }
    }
  }
  return null;
}
