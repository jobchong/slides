import { describe, expect, test } from "bun:test";

import { resolveModelOutput } from "../model-output";

describe("resolveModelOutput", () => {
  test("passes through raw html output", () => {
    const raw = '<div style="position:absolute;top:10%;left:10%;">Hello</div>';

    const resolved = resolveModelOutput(raw);

    expect(resolved.type).toBe("html");
    expect(resolved.html).toBe(raw);
  });

  test("preserves clarification output", () => {
    const raw = "<clarify>Which audience should this flowchart target?</clarify>";

    const resolved = resolveModelOutput(raw);

    expect(resolved.type).toBe("clarify");
    expect(resolved.html).toBe(raw);
  });

  test("renders diagram output through the layout pipeline", () => {
    const raw = `
      <diagram>
      {
        "layout": { "type": "flowchart", "direction": "horizontal" },
        "nodes": [
          { "id": "start", "label": "Start" },
          { "id": "end", "label": "End" }
        ],
        "connectors": [
          { "from": "start", "to": "end" }
        ]
      }
      </diagram>
    `;

    const resolved = resolveModelOutput(raw);

    expect(resolved.type).toBe("diagram");
    expect(resolved.html).toContain('data-slide-source="true"');
    expect(resolved.html).toContain('data-element-id="start"');
    expect(resolved.html).not.toContain("<diagram>");
  });
});
