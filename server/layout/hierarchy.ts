import type { Bounds } from "../import/types";
import type { DiagramNode, DiagramConnector } from "../../app/src/types";
import { createConnector, type ConnectorStyle } from "./connectors";

interface HierarchyConfig {
  direction: "top-down" | "left-right";
  region?: Bounds;
}

const DEFAULT_REGION: Bounds = { x: 10, y: 25, width: 80, height: 50 };
const NODE_ASPECT_RATIO = 1.6;
const MIN_NODE_SIZE = 12;
const MAX_NODE_SIZE = 25;
const GAP_RATIO = 0.3;
const BASE_FONT_SIZE = 18;
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;
const LABEL_FONT_SIZE = 12;
const LABEL_MIN_WIDTH = 8;
const LABEL_MAX_WIDTH = 16;
const LABEL_MIN_HEIGHT = 4;
const LABEL_MAX_HEIGHT = 9;

interface PositionedNode {
  node: DiagramNode;
  bounds: Bounds;
  level: number;
}

export function layoutHierarchy(
  nodes: DiagramNode[],
  connectors: DiagramConnector[],
  config: HierarchyConfig
): Array<{
  id: string;
  type: "text" | "shape";
  bounds: Bounds;
  zIndex: number;
  text?: { content: string; style: any; insets?: { l?: number; r?: number; t?: number; b?: number } };
  shape?: any;
}> {
  if (nodes.length === 0) return [];

  const region = config.region || DEFAULT_REGION;
  const isTopDown = config.direction === "top-down";

  const { levels, levelCount, maxNodesPerLevel } = buildLevels(nodes, connectors);
  const { nodeSize: levelNodeSize, gap: levelGap } = calculateAxisSize(levelCount, isTopDown ? region.height : region.width);
  const { nodeSize: crossNodeSize, gap: crossGap } = calculateAxisSize(maxNodesPerLevel, isTopDown ? region.width : region.height);

  let nodeWidth = isTopDown ? crossNodeSize : levelNodeSize;
  let nodeHeight = isTopDown ? levelNodeSize : crossNodeSize;

  if (isTopDown) {
    nodeWidth = Math.min(nodeWidth, nodeHeight * NODE_ASPECT_RATIO);
    nodeWidth = Math.max(MIN_NODE_SIZE, nodeWidth);
  } else {
    nodeHeight = Math.min(nodeHeight, nodeWidth / NODE_ASPECT_RATIO);
    nodeHeight = Math.max(MIN_NODE_SIZE, nodeHeight);
  }

  const positionedNodes = positionNodes(
    levels,
    region,
    nodeWidth,
    nodeHeight,
    crossGap,
    levelGap,
    isTopDown
  );

  const elements: Array<{
    id: string;
    type: "text" | "shape";
    bounds: Bounds;
    zIndex: number;
    text?: { content: string; style: any; insets?: { l?: number; r?: number; t?: number; b?: number } };
    shape?: any;
  }> = [];

  positionedNodes.forEach((pn, i) => {
    const style = pn.node.style || {};
    const shape = style.shape || "roundRect";
    const fill = style.fill || getDefaultColor(i);
    const textColor = style.textColor || "#ffffff";
    const shapeKind =
      shape === "ellipse" ? "ellipse" : shape === "diamond" ? "custom" : shape === "rect" ? "rect" : "roundRect";
    const content = pn.node.label + (pn.node.sublabel ? `\n${pn.node.sublabel}` : "");
    const fontSize = calculateFontSize(pn.bounds, content);
    const textInsets = calculateTextInsets(fontSize);

    elements.push({
      id: pn.node.id,
      type: "text",
      bounds: pn.bounds,
      zIndex: i + 1,
      text: {
        content,
        style: {
          fontFamily: "Inter",
          fontSize,
          fontWeight: "bold",
          fontStyle: "normal",
          color: textColor,
          align: "center",
          verticalAlign: "middle",
        },
        insets: textInsets,
      },
      shape: {
        kind: shapeKind,
        fill,
        stroke: style.stroke,
        strokeWidth: style.stroke ? 2 : undefined,
        borderRadius: shape === "roundRect" ? 8 : undefined,
        ...(shape === "diamond" && {
          svgPath: "M 50 0 L 100 50 L 50 100 L 0 50 Z",
          svgViewBox: { width: 100, height: 100 },
        }),
      },
    });
  });

  const nodeMap = new Map(positionedNodes.map((pn) => [pn.node.id, pn.bounds]));
  connectors.forEach((conn, i) => {
    const fromBounds = nodeMap.get(conn.from);
    const toBounds = nodeMap.get(conn.to);
    if (!fromBounds || !toBounds) return;

    const connStyle: ConnectorStyle = {
      stroke: conn.style?.stroke || "#333333",
      strokeWidth: 2,
      arrowHead: conn.style?.arrowHead || "arrow",
      dashed: conn.style?.dashed,
    };

    elements.push(
      createConnector(
        `connector-${i}`,
        fromBounds,
        toBounds,
        isTopDown ? "vertical" : "horizontal",
        connStyle,
        0
      ) as any
    );

    if (conn.label) {
      const labelElement = createConnectorLabel(
        `connector-label-${i}`,
        conn.label,
        fromBounds,
        toBounds,
        isTopDown,
        connStyle.stroke || "#333333"
      );
      elements.push(labelElement as any);
    }
  });

  return elements;
}

function buildLevels(nodes: DiagramNode[], connectors: DiagramConnector[]) {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  nodes.forEach((node) => {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  });

  connectors.forEach((conn) => {
    if (!inDegree.has(conn.from) || !inDegree.has(conn.to)) return;
    inDegree.set(conn.to, (inDegree.get(conn.to) || 0) + 1);
    adjacency.get(conn.from)!.push(conn.to);
  });

  const queue = nodes
    .filter((node) => (inDegree.get(node.id) || 0) === 0)
    .map((node) => node.id);
  const levels = new Map<string, number>();

  queue.forEach((id) => levels.set(id, 0));

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) || 0;
    for (const child of adjacency.get(current) || []) {
      const nextLevel = currentLevel + 1;
      levels.set(child, Math.max(levels.get(child) || 0, nextLevel));
      inDegree.set(child, (inDegree.get(child) || 0) - 1);
      if ((inDegree.get(child) || 0) === 0) {
        queue.push(child);
      }
    }
  }

  nodes.forEach((node) => {
    if (!levels.has(node.id)) levels.set(node.id, 0);
  });

  const levelBuckets: Map<number, DiagramNode[]> = new Map();
  let maxLevel = 0;
  let maxNodesPerLevel = 0;

  nodes.forEach((node) => {
    const level = levels.get(node.id) || 0;
    maxLevel = Math.max(maxLevel, level);
    if (!levelBuckets.has(level)) levelBuckets.set(level, []);
    levelBuckets.get(level)!.push(node);
  });

  for (const bucket of levelBuckets.values()) {
    maxNodesPerLevel = Math.max(maxNodesPerLevel, bucket.length);
  }

  return {
    levels: levelBuckets,
    levelCount: maxLevel + 1,
    maxNodesPerLevel: Math.max(maxNodesPerLevel, 1),
  };
}

function calculateAxisSize(count: number, size: number): { nodeSize: number; gap: number } {
  if (count <= 1) {
    const nodeSize = Math.min(MAX_NODE_SIZE, Math.max(MIN_NODE_SIZE, size * 0.6));
    return { nodeSize, gap: nodeSize * GAP_RATIO };
  }

  const denominator = count + (count - 1) * GAP_RATIO;
  let nodeSize = size / denominator;

  if (nodeSize > MAX_NODE_SIZE) {
    nodeSize = MAX_NODE_SIZE;
  } else if (nodeSize < MIN_NODE_SIZE) {
    const minTotal = count * MIN_NODE_SIZE + (count - 1) * MIN_NODE_SIZE * GAP_RATIO;
    nodeSize = minTotal <= size ? MIN_NODE_SIZE : size / denominator;
  }

  return { nodeSize, gap: nodeSize * GAP_RATIO };
}

function positionNodes(
  levels: Map<number, DiagramNode[]>,
  region: Bounds,
  nodeWidth: number,
  nodeHeight: number,
  crossGap: number,
  levelGap: number,
  isTopDown: boolean
): PositionedNode[] {
  const levelCount = levels.size;
  const positioned: PositionedNode[] = [];

  if (isTopDown) {
    const totalHeight = levelCount * nodeHeight + (levelCount - 1) * levelGap;
    const startY = region.y + (region.height - totalHeight) / 2;

    Array.from(levels.keys())
      .sort((a, b) => a - b)
      .forEach((level, levelIndex) => {
        const bucket = levels.get(level) || [];
        const totalWidth = bucket.length * nodeWidth + (bucket.length - 1) * crossGap;
        const startX = region.x + (region.width - totalWidth) / 2;

        bucket.forEach((node, index) => {
          positioned.push({
            node,
            level,
            bounds: {
              x: startX + index * (nodeWidth + crossGap),
              y: startY + levelIndex * (nodeHeight + levelGap),
              width: nodeWidth,
              height: nodeHeight,
            },
          });
        });
      });
  } else {
    const totalWidth = levelCount * nodeWidth + (levelCount - 1) * levelGap;
    const startX = region.x + (region.width - totalWidth) / 2;

    Array.from(levels.keys())
      .sort((a, b) => a - b)
      .forEach((level, levelIndex) => {
        const bucket = levels.get(level) || [];
        const totalHeight = bucket.length * nodeHeight + (bucket.length - 1) * crossGap;
        const startY = region.y + (region.height - totalHeight) / 2;

        bucket.forEach((node, index) => {
          positioned.push({
            node,
            level,
            bounds: {
              x: startX + levelIndex * (nodeWidth + levelGap),
              y: startY + index * (nodeHeight + crossGap),
              width: nodeWidth,
              height: nodeHeight,
            },
          });
        });
      });
  }

  return positioned;
}

function getDefaultColor(index: number): string {
  const colors = [
    "#4A90D9",
    "#5CB85C",
    "#F0AD4E",
    "#D9534F",
    "#9B59B6",
    "#1ABC9C",
    "#E74C3C",
    "#3498DB",
  ];
  return colors[index % colors.length];
}

function calculateFontSize(bounds: Bounds, content: string): number {
  const minDimension = Math.min(bounds.width, bounds.height);
  const scale = minDimension / 20;
  let fontSize = Math.round(BASE_FONT_SIZE * scale);
  const cleanLength = content.replace(/\s+/g, "").length;

  if (cleanLength > 24) {
    fontSize = Math.round(fontSize * 0.85);
  }
  if (cleanLength > 36) {
    fontSize = Math.round(fontSize * 0.75);
  }

  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fontSize));
}

function calculateTextInsets(fontSizePx: number): { l: number; r: number; t: number; b: number } {
  const pointsToPx = 96 / 72;
  const insetPt = Math.max(3.5, Math.min(8, (fontSizePx * 0.5) / pointsToPx));
  return {
    l: insetPt,
    r: insetPt,
    t: insetPt,
    b: insetPt,
  };
}

function createConnectorLabel(
  id: string,
  label: string,
  from: Bounds,
  to: Bounds,
  isTopDown: boolean,
  color: string
): {
  id: string;
  type: "text";
  bounds: Bounds;
  zIndex: number;
  text: { content: string; style: any };
  shape: any;
} {
  const fromEdgeX = isTopDown ? from.x + from.width / 2 : from.x + from.width;
  const fromEdgeY = isTopDown ? from.y + from.height : from.y + from.height / 2;
  const toEdgeX = isTopDown ? to.x + to.width / 2 : to.x;
  const toEdgeY = isTopDown ? to.y : to.y + to.height / 2;
  const midX = (fromEdgeX + toEdgeX) / 2;
  const midY = (fromEdgeY + toEdgeY) / 2;
  const distance = isTopDown
    ? Math.abs(toEdgeY - fromEdgeY)
    : Math.abs(toEdgeX - fromEdgeX);

  const labelWidth = clamp(distance * 0.7, LABEL_MIN_WIDTH, LABEL_MAX_WIDTH);
  const labelHeight = clamp(labelWidth * 0.4, LABEL_MIN_HEIGHT, LABEL_MAX_HEIGHT);

  return {
    id,
    type: "text",
    bounds: {
      x: midX - labelWidth / 2,
      y: midY - labelHeight / 2,
      width: labelWidth,
      height: labelHeight,
    },
    zIndex: 1,
    text: {
      content: label,
      style: {
        fontFamily: "Inter",
        fontSize: LABEL_FONT_SIZE,
        fontWeight: "bold",
        fontStyle: "normal",
        color,
        align: "center",
        verticalAlign: "middle",
      },
    },
    shape: {
      kind: "roundRect",
      fill: "#ffffff",
      stroke: "#e5e5e5",
      strokeWidth: 1,
      borderRadius: 6,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
