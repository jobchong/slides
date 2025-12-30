import type { Bounds } from "../import/types";
import type { DiagramNode, DiagramConnector } from "../../app/src/types";
import { createConnector, type ConnectorStyle } from "./connectors";

interface GridConfig {
  columns: number;
  region?: Bounds;
}

const DEFAULT_REGION: Bounds = { x: 10, y: 25, width: 80, height: 50 };
const MIN_NODE_SIZE = 10;
const MAX_NODE_SIZE = 22;
const GAP_RATIO = 0.25;
const BASE_FONT_SIZE = 16;
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 20;
const LABEL_FONT_SIZE = 12;
const LABEL_MIN_WIDTH = 8;
const LABEL_MAX_WIDTH = 16;
const LABEL_MIN_HEIGHT = 4;
const LABEL_MAX_HEIGHT = 9;

export function layoutGrid(
  nodes: DiagramNode[],
  connectors: DiagramConnector[],
  config: GridConfig
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
  const columns = Math.max(1, Math.min(config.columns, nodes.length));
  const rows = Math.ceil(nodes.length / columns);

  const { nodeSize: nodeWidth, gap: gapX } = calculateAxisSize(columns, region.width);
  const { nodeSize: nodeHeight, gap: gapY } = calculateAxisSize(rows, region.height);

  const totalWidth = columns * nodeWidth + (columns - 1) * gapX;
  const totalHeight = rows * nodeHeight + (rows - 1) * gapY;
  const startX = region.x + (region.width - totalWidth) / 2;
  const startY = region.y + (region.height - totalHeight) / 2;

  const elements: Array<{
    id: string;
    type: "text" | "shape";
    bounds: Bounds;
    zIndex: number;
    text?: { content: string; style: any; insets?: { l?: number; r?: number; t?: number; b?: number } };
    shape?: any;
  }> = [];

  const positionedNodes: { node: DiagramNode; bounds: Bounds }[] = [];

  nodes.forEach((node, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const bounds: Bounds = {
      x: startX + col * (nodeWidth + gapX),
      y: startY + row * (nodeHeight + gapY),
      width: nodeWidth,
      height: nodeHeight,
    };
    positionedNodes.push({ node, bounds });

    const style = node.style || {};
    const shape = style.shape || "roundRect";
    const fill = style.fill || getDefaultColor(i);
    const textColor = style.textColor || "#ffffff";
    const shapeKind =
      shape === "ellipse" ? "ellipse" : shape === "diamond" ? "custom" : shape === "rect" ? "rect" : "roundRect";
    const content = node.label + (node.sublabel ? `\n${node.sublabel}` : "");
    const fontSize = calculateFontSize(bounds, content);
    const textInsets = calculateTextInsets(fontSize);

    elements.push({
      id: node.id,
      type: "text",
      bounds,
      zIndex: i + 2,
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

    const direction = getConnectorDirection(fromBounds, toBounds);
    elements.push(
      createConnector(`connector-${i}`, fromBounds, toBounds, direction, connStyle, 0) as any
    );

    if (conn.label) {
      const labelElement = createConnectorLabel(
        `connector-label-${i}`,
        conn.label,
        fromBounds,
        toBounds,
        direction === "horizontal",
        connStyle.stroke || "#333333"
      );
      elements.push(labelElement as any);
    }
  });

  return elements;
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

function getConnectorDirection(from: Bounds, to: Bounds): "horizontal" | "vertical" {
  const dx = (from.x + from.width / 2) - (to.x + to.width / 2);
  const dy = (from.y + from.height / 2) - (to.y + to.height / 2);
  return Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
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
  isHorizontal: boolean,
  color: string
): {
  id: string;
  type: "text";
  bounds: Bounds;
  zIndex: number;
  text: { content: string; style: any };
  shape: any;
} {
  const fromEdgeX = isHorizontal ? from.x + from.width : from.x + from.width / 2;
  const fromEdgeY = isHorizontal ? from.y + from.height / 2 : from.y + from.height;
  const toEdgeX = isHorizontal ? to.x : to.x + to.width / 2;
  const toEdgeY = isHorizontal ? to.y + to.height / 2 : to.y;
  const midX = (fromEdgeX + toEdgeX) / 2;
  const midY = (fromEdgeY + toEdgeY) / 2;
  const distance = isHorizontal
    ? Math.abs(toEdgeX - fromEdgeX)
    : Math.abs(toEdgeY - fromEdgeY);

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
