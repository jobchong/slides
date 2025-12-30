import { describe, expect, test } from "bun:test";

import { createConnector } from "../connectors";

function parseLineEnd(path: string) {
  const match = path.match(/^M\s+([0-9.]+)\s+([0-9.]+)\s+L\s+([0-9.]+)\s+([0-9.]+)/);
  if (!match) return null;
  return {
    fromX: Number(match[1]),
    fromY: Number(match[2]),
    toX: Number(match[3]),
    toY: Number(match[4]),
  };
}

describe("createConnector", () => {
  test("shortens the line for horizontal arrows", () => {
    const connector = createConnector(
      "c1",
      { x: 10, y: 10, width: 10, height: 10 },
      { x: 22, y: 10, width: 10, height: 10 },
      "horizontal",
      { arrowHead: "arrow" },
      0
    );

    const line = parseLineEnd(connector.shape.svgPath);
    expect(line).toBeDefined();
    const bounds = connector.bounds;
    const toEdgeX = 22;
    const toEdgeY = 15;
    const relToX = ((toEdgeX - bounds.x) / bounds.width) * 100;
    const relToY = ((toEdgeY - bounds.y) / bounds.height) * 100;

    expect(line!.toX).toBeLessThan(relToX);
    expect(line!.toY).toBeCloseTo(relToY, 3);
  });

  test("shortens the line for vertical arrows", () => {
    const connector = createConnector(
      "c2",
      { x: 10, y: 10, width: 10, height: 10 },
      { x: 10, y: 22, width: 10, height: 10 },
      "vertical",
      { arrowHead: "arrow" },
      0
    );

    const line = parseLineEnd(connector.shape.svgPath);
    expect(line).toBeDefined();
    const bounds = connector.bounds;
    const toEdgeX = 15;
    const toEdgeY = 22;
    const relToX = ((toEdgeX - bounds.x) / bounds.width) * 100;
    const relToY = ((toEdgeY - bounds.y) / bounds.height) * 100;

    expect(line!.toY).toBeLessThan(relToY);
    expect(line!.toX).toBeCloseTo(relToX, 3);
  });
});
