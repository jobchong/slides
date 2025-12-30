import { describe, expect, test } from "bun:test";

import { layoutFlowchart } from "../flowchart";

function buildNodes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i + 1}`,
    label: `Step ${i + 1}`,
  }));
}

describe("layoutFlowchart", () => {
  test("keeps nodes within the default region for large counts", () => {
    const nodes = buildNodes(10);
    const elements = layoutFlowchart(nodes, [], { direction: "horizontal" });
    const nodeElements = elements.filter((el) => el.type === "text");

    const minX = Math.min(...nodeElements.map((el) => el.bounds.x));
    const maxX = Math.max(...nodeElements.map((el) => el.bounds.x + el.bounds.width));

    expect(minX).toBeGreaterThanOrEqual(10);
    expect(maxX).toBeLessThanOrEqual(90);
  });

  test("scales font size down as nodes shrink", () => {
    const fewNodes = layoutFlowchart(buildNodes(3), [], { direction: "horizontal" });
    const manyNodes = layoutFlowchart(buildNodes(10), [], { direction: "horizontal" });

    const fewFont = fewNodes[0].text?.style.fontSize ?? 0;
    const manyFont = manyNodes[0].text?.style.fontSize ?? 0;

    expect(fewFont).toBeGreaterThan(0);
    expect(manyFont).toBeGreaterThan(0);
    expect(manyFont).toBeLessThanOrEqual(fewFont);
  });

  test("adds text insets for padding", () => {
    const elements = layoutFlowchart(buildNodes(3), [], { direction: "horizontal" });
    const insets = elements[0].text?.insets;

    expect(insets).toBeDefined();
    expect(insets?.l).toBeGreaterThan(0);
    expect(insets?.r).toBeGreaterThan(0);
    expect(insets?.t).toBeGreaterThan(0);
    expect(insets?.b).toBeGreaterThan(0);
  });

  test("renders connector labels when provided", () => {
    const nodes = buildNodes(2);
    const elements = layoutFlowchart(
      nodes,
      [{ from: "node-1", to: "node-2", label: "Next" }],
      { direction: "horizontal" }
    );
    const label = elements.find((el) => el.id === "connector-label-0");

    expect(label).toBeDefined();
    expect(label?.type).toBe("text");
  });
});
