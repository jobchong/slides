// Flowchart Layout Algorithm - Horizontal and Vertical Flows

import type { Bounds } from "../import/types";
import type { DiagramNode, DiagramConnector } from "../../app/src/types";
import { createConnector, type ConnectorStyle } from "./connectors";

// Internal positioned node representation
interface PositionedNode {
  node: DiagramNode;
  bounds: Bounds;
}

interface FlowchartConfig {
  direction: "horizontal" | "vertical";
  region?: Bounds;  // Area to lay out within (default: centered 80% of slide)
}

// Default layout region (centered, 80% width, 50% height)
const DEFAULT_REGION: Bounds = { x: 10, y: 25, width: 80, height: 50 };

// Node sizing defaults
const NODE_ASPECT_RATIO = 1.5;  // width:height for horizontal, height:width for vertical
const MIN_NODE_SIZE = 12;       // minimum dimension in %
const MAX_NODE_SIZE = 25;       // maximum dimension in %
const GAP_RATIO = 0.3;          // gap as fraction of node size
const BASE_FONT_SIZE = 18;      // px for a ~20% node height
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;
const LABEL_FONT_SIZE = 12;
const LABEL_MIN_WIDTH = 8;
const LABEL_MAX_WIDTH = 16;
const LABEL_MIN_HEIGHT = 4;
const LABEL_MAX_HEIGHT = 9;

/**
 * Layout nodes in a linear flow (horizontal or vertical).
 * Returns EditableElement[] ready for rendering.
 */
export function layoutFlowchart(
  nodes: DiagramNode[],
  connectors: DiagramConnector[],
  config: FlowchartConfig
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
  const isHorizontal = config.direction === "horizontal";
  const n = nodes.length;

  // Calculate node dimensions based on available space
  const { nodeWidth, nodeHeight, gap } = calculateNodeDimensions(
    n,
    region,
    isHorizontal
  );

  // Position each node
  const positionedNodes = positionNodes(
    nodes,
    region,
    nodeWidth,
    nodeHeight,
    gap,
    isHorizontal
  );

  // Build element array
  const elements: Array<{
    id: string;
    type: "text" | "shape";
    bounds: Bounds;
  zIndex: number;
  text?: { content: string; style: any; insets?: { l?: number; r?: number; t?: number; b?: number } };
  shape?: any;
}> = [];

  // Create node elements (text with shape background)
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
        // Diamond SVG path
        ...(shape === "diamond" && {
          svgPath: "M 50 0 L 100 50 L 50 100 L 0 50 Z",
          svgViewBox: { width: 100, height: 100 },
        }),
      },
    });
  });

  // Create connector elements
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

    const connectorElement = createConnector(
      `connector-${i}`,
      fromBounds,
      toBounds,
      isHorizontal ? "horizontal" : "vertical",
      connStyle,
      0  // connectors behind nodes
    );

    elements.push(connectorElement as any);

    if (conn.label) {
      const labelElement = createConnectorLabel(
        `connector-label-${i}`,
        conn.label,
        fromBounds,
        toBounds,
        isHorizontal,
        connStyle.stroke || "#333333"
      );
      elements.push(labelElement as any);
    }
  });

  return elements;
}

/**
 * Calculate optimal node dimensions based on count and available space.
 */
function calculateNodeDimensions(
  nodeCount: number,
  region: Bounds,
  isHorizontal: boolean
): { nodeWidth: number; nodeHeight: number; gap: number } {
  // Primary axis is the direction of flow
  const primarySize = isHorizontal ? region.width : region.height;
  const secondarySize = isHorizontal ? region.height : region.width;

  // Calculate node size along primary axis
  // Formula: n * nodeSize + (n-1) * gap = primarySize
  // With gap = nodeSize * GAP_RATIO:
  // n * nodeSize + (n-1) * nodeSize * GAP_RATIO = primarySize
  // nodeSize * (n + (n-1) * GAP_RATIO) = primarySize
  const denominator = nodeCount + (nodeCount - 1) * GAP_RATIO;
  let primaryNodeSize = primarySize / denominator;

  // Clamp to min/max
  if (primaryNodeSize > MAX_NODE_SIZE) {
    primaryNodeSize = MAX_NODE_SIZE;
  } else if (primaryNodeSize < MIN_NODE_SIZE) {
    const minTotal = nodeCount * MIN_NODE_SIZE + (nodeCount - 1) * MIN_NODE_SIZE * GAP_RATIO;
    primaryNodeSize = minTotal <= primarySize ? MIN_NODE_SIZE : primarySize / denominator;
  }

  // Secondary dimension based on aspect ratio and available space
  let secondaryNodeSize = primaryNodeSize / NODE_ASPECT_RATIO;
  secondaryNodeSize = Math.min(secondaryNodeSize, secondarySize * 0.8);

  const gap = primaryNodeSize * GAP_RATIO;

  if (isHorizontal) {
    return { nodeWidth: primaryNodeSize, nodeHeight: secondaryNodeSize, gap };
  } else {
    return { nodeWidth: secondaryNodeSize, nodeHeight: primaryNodeSize, gap };
  }
}

/**
 * Position nodes along the primary axis, centered in the region.
 */
function positionNodes(
  nodes: DiagramNode[],
  region: Bounds,
  nodeWidth: number,
  nodeHeight: number,
  gap: number,
  isHorizontal: boolean
): PositionedNode[] {
  const n = nodes.length;

  if (isHorizontal) {
    // Calculate total width and center horizontally
    const totalWidth = n * nodeWidth + (n - 1) * gap;
    const startX = region.x + (region.width - totalWidth) / 2;
    const centerY = region.y + (region.height - nodeHeight) / 2;

    return nodes.map((node, i) => ({
      node,
      bounds: {
        x: startX + i * (nodeWidth + gap),
        y: centerY,
        width: nodeWidth,
        height: nodeHeight,
      },
    }));
  } else {
    // Vertical: calculate total height and center vertically
    const totalHeight = n * nodeHeight + (n - 1) * gap;
    const startY = region.y + (region.height - totalHeight) / 2;
    const centerX = region.x + (region.width - nodeWidth) / 2;

    return nodes.map((node, i) => ({
      node,
      bounds: {
        x: centerX,
        y: startY + i * (nodeHeight + gap),
        width: nodeWidth,
        height: nodeHeight,
      },
    }));
  }
}

/**
 * Default color palette for nodes.
 */
function getDefaultColor(index: number): string {
  const colors = [
    "#4A90D9",  // blue
    "#5CB85C",  // green
    "#F0AD4E",  // orange
    "#D9534F",  // red
    "#9B59B6",  // purple
    "#1ABC9C",  // teal
    "#E74C3C",  // crimson
    "#3498DB",  // light blue
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
