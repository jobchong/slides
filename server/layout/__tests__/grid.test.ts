import { describe, expect, test } from "bun:test";

import { layoutGrid } from "../grid";

function buildNodes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i + 1}`,
    label: `Item ${i + 1}`,
  }));
}

describe("layoutGrid", () => {
  test("lays out nodes within the default region", () => {
    const elements = layoutGrid(buildNodes(6), [], { columns: 3 });
    const nodeElements = elements.filter((el) => el.type === "text");

    const minX = Math.min(...nodeElements.map((el) => el.bounds.x));
    const maxX = Math.max(...nodeElements.map((el) => el.bounds.x + el.bounds.width));
    const minY = Math.min(...nodeElements.map((el) => el.bounds.y));
    const maxY = Math.max(...nodeElements.map((el) => el.bounds.y + el.bounds.height));

    expect(minX).toBeGreaterThanOrEqual(10);
    expect(maxX).toBeLessThanOrEqual(90);
    expect(minY).toBeGreaterThanOrEqual(25);
    expect(maxY).toBeLessThanOrEqual(75);
  });

  test("renders connectors and labels when provided", () => {
    const elements = layoutGrid(
      buildNodes(4),
      [{ from: "node-1", to: "node-2", label: "link" }],
      { columns: 2 }
    );
    const connector = elements.find((el) => el.id === "connector-0");
    const label = elements.find((el) => el.id === "connector-label-0");

    expect(connector).toBeDefined();
    expect(label).toBeDefined();
    expect(label?.type).toBe("text");
  });
});
