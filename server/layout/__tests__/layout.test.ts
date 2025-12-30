import { describe, expect, test } from "bun:test";

import { layoutDiagram } from "../index";

describe("layoutDiagram", () => {
  test("defaults layout when missing", () => {
    const intent = {
      nodes: [{ id: "a", label: "Start" }],
      connectors: [],
    } as any;

    const result = layoutDiagram(intent);

    expect(result.html).toContain('data-element-id="a"');
  });

  test("defaults grid columns when missing", () => {
    const intent = {
      layout: { type: "grid" },
      nodes: [
        { id: "a", label: "One" },
        { id: "b", label: "Two" },
      ],
      connectors: [],
    } as any;

    const result = layoutDiagram(intent);

    expect(result.html).toContain('data-element-id="a"');
    expect(result.html).toContain('data-element-id="b"');
  });
});
