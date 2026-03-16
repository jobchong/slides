import { describe, expect, test } from "bun:test";

import { createDiagramStreamGate } from "../diagram-stream";

describe("createDiagramStreamGate", () => {
  test("buffers partial diagram tag prefixes across chunk boundaries", () => {
    const gate = createDiagramStreamGate();

    expect(gate.append("<diag")).toBe("");
    expect(gate.append('ram>{"layout":')).toBe("");

    const result = gate.finalize();
    expect(result.diagramDetected).toBe(true);
    expect(result.accumulated).toBe('<diagram>{"layout":');
    expect(result.remainder).toBe("");
  });

  test("streams normal html while preserving false-prefix suffixes until safe", () => {
    const gate = createDiagramStreamGate();

    expect(gate.append("Hello <di")).toBe("Hello ");
    expect(gate.append('v style="color:red">world</div>')).toBe('<div style="color:red">world</div>');

    const result = gate.finalize();
    expect(result.diagramDetected).toBe(false);
    expect(result.remainder).toBe("");
  });

  test("flushes any held suffix at end of non-diagram output", () => {
    const gate = createDiagramStreamGate();

    expect(gate.append("Hello <di")).toBe("Hello ");

    const result = gate.finalize();
    expect(result.diagramDetected).toBe(false);
    expect(result.remainder).toBe("<di");
  });
});
