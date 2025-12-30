import { describe, expect, test } from "bun:test";

import { layoutHierarchy } from "../hierarchy";

const nodes = [
  { id: "a", label: "Root" },
  { id: "b", label: "Child 1" },
  { id: "c", label: "Child 2" },
  { id: "d", label: "Leaf" },
];

const connectors = [
  { from: "a", to: "b" },
  { from: "a", to: "c" },
  { from: "c", to: "d" },
];

describe("layoutHierarchy", () => {
  test("lays out top-down levels and connectors", () => {
    const elements = layoutHierarchy(nodes, connectors, { direction: "top-down" });
    const nodeElements = elements.filter((el) => el.type === "text");
    const connectorElements = elements.filter((el) => el.type === "shape" && el.id.startsWith("connector-"));

    const map = new Map(nodeElements.map((el) => [el.id, el.bounds]));

    expect(connectorElements.length).toBe(connectors.length);
    expect(map.get("a")!.y).toBeLessThan(map.get("b")!.y);
    expect(map.get("a")!.y).toBeLessThan(map.get("c")!.y);
    expect(map.get("c")!.y).toBeLessThan(map.get("d")!.y);
  });

  test("lays out left-right levels", () => {
    const elements = layoutHierarchy(nodes, connectors, { direction: "left-right" });
    const nodeElements = elements.filter((el) => el.type === "text");
    const map = new Map(nodeElements.map((el) => [el.id, el.bounds]));

    expect(map.get("a")!.x).toBeLessThan(map.get("b")!.x);
    expect(map.get("a")!.x).toBeLessThan(map.get("c")!.x);
    expect(map.get("c")!.x).toBeLessThan(map.get("d")!.x);
  });

  test("renders connector labels when provided", () => {
    const elements = layoutHierarchy(
      nodes,
      [{ from: "a", to: "b", label: "Depends on" }],
      { direction: "top-down" }
    );
    const label = elements.find((el) => el.id === "connector-label-0");

    expect(label).toBeDefined();
    expect(label?.type).toBe("text");
  });
});
