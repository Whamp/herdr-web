import { describe, expect, it } from "vitest";
import { terminalLoupeCursorGeometry } from "./terminalLoupe";

describe("terminal loupe cursor", () => {
  it("draws a caret before the selected cell within that cell's row", () => {
    const cursor = terminalLoupeCursorGeometry({
      col: 20,
      row: 10,
      cellWidth: 9,
      cellHeight: 16,
      sourceX: 149.5,
      sourceY: 146,
      sourceWidth: 70,
      sourceHeight: 44,
      loupeWidth: 132,
      loupeHeight: 82,
    });

    expect(cursor.caretX).toBeCloseTo(57.51, 1);
    expect(cursor.caretTop).toBeCloseTo(26.09, 1);
    expect(cursor.caretBottom).toBeCloseTo(55.91, 1);
  });
});
