// Arrow/Connector Generation for Diagram Layout

import type { Bounds } from "../import/types";

export interface ConnectorStyle {
  stroke?: string;
  strokeWidth?: number;
  arrowHead?: "arrow" | "none";
  dashed?: boolean;
}

interface ConnectorElement {
  id: string;
  type: "shape";
  bounds: Bounds;
  zIndex: number;
  shape: {
    kind: "custom";
    fill: string | "none";
    stroke: string;
    strokeWidth: number;
    strokeDasharray?: string;
    svgPath: string;
    svgViewBox: { width: number; height: number };
  };
}

/**
 * Calculate connection points between two boxes.
 * Returns the edge midpoints that create the shortest connection.
 */
function getConnectionPoints(
  from: Bounds,
  to: Bounds,
  direction: "horizontal" | "vertical"
): { fromX: number; fromY: number; toX: number; toY: number } {
  if (direction === "horizontal") {
    // Connect right edge of 'from' to left edge of 'to'
    return {
      fromX: from.x + from.width,
      fromY: from.y + from.height / 2,
      toX: to.x,
      toY: to.y + to.height / 2,
    };
  } else {
    // Connect bottom edge of 'from' to top edge of 'to'
    return {
      fromX: from.x + from.width / 2,
      fromY: from.y + from.height,
      toX: to.x + to.width / 2,
      toY: to.y,
    };
  }
}

/**
 * Create an arrow connector element between two bounds.
 */
export function createConnector(
  id: string,
  from: Bounds,
  to: Bounds,
  direction: "horizontal" | "vertical",
  style: ConnectorStyle,
  zIndex: number
): ConnectorElement {
  const points = getConnectionPoints(from, to, direction);

  // Calculate bounding box for the connector
  const minX = Math.min(points.fromX, points.toX);
  const maxX = Math.max(points.fromX, points.toX);
  const minY = Math.min(points.fromY, points.toY);
  const maxY = Math.max(points.fromY, points.toY);

  // Add padding for arrow head
  const padding = 1;
  const bounds: Bounds = {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(maxX - minX + padding * 2, 0.5),
    height: Math.max(maxY - minY + padding * 2, 0.5),
  };

  // Convert absolute points to viewBox coordinates
  const viewBoxWidth = 100;
  const viewBoxHeight = 100;

  // Calculate relative positions within the viewBox
  const relFromX = ((points.fromX - bounds.x) / bounds.width) * viewBoxWidth;
  const relFromY = ((points.fromY - bounds.y) / bounds.height) * viewBoxHeight;
  const relToX = ((points.toX - bounds.x) / bounds.width) * viewBoxWidth;
  const relToY = ((points.toY - bounds.y) / bounds.height) * viewBoxHeight;

  // Build SVG path with optional arrowhead
  const stroke = style.stroke || "#333333";
  const strokeWidth = style.strokeWidth || 2;
  const strokeDasharray = style.dashed ? "6 4" : undefined;
  const showArrow = style.arrowHead !== "none";

  // Create path data - line stops short to make room for arrowhead
  const lineLength = Math.hypot(relToX - relFromX, relToY - relFromY);
  const arrowSize = showArrow ? Math.min(14, Math.max(6, lineLength * 0.25)) : 0;
  const angle = Math.atan2(relToY - relFromY, relToX - relFromX);

  // Shorten the line to meet the arrow base
  const lineEndX = showArrow ? relToX - arrowSize * Math.cos(angle) : relToX;
  const lineEndY = showArrow ? relToY - arrowSize * Math.sin(angle) : relToY;

  let pathData = `M ${relFromX} ${relFromY} L ${lineEndX} ${lineEndY}`;

  // Add filled arrowhead triangle
  if (showArrow) {
    // Arrow point coordinates - wider angle for more visible arrow
    const arrowX1 = relToX - arrowSize * Math.cos(angle - Math.PI / 5);
    const arrowY1 = relToY - arrowSize * Math.sin(angle - Math.PI / 5);
    const arrowX2 = relToX - arrowSize * Math.cos(angle + Math.PI / 5);
    const arrowY2 = relToY - arrowSize * Math.sin(angle + Math.PI / 5);

    // Filled triangle path
    pathData += ` M ${relToX} ${relToY} L ${arrowX1} ${arrowY1} L ${arrowX2} ${arrowY2} Z`;
  }

  return {
    id,
    type: "shape",
    bounds,
    zIndex,
    shape: {
      kind: "custom",
      fill: showArrow ? stroke : "none",  // Fill arrowhead with stroke color
      stroke,
      strokeWidth,
      strokeDasharray,
      svgPath: pathData,
      svgViewBox: { width: viewBoxWidth, height: viewBoxHeight },
    },
  };
}

/**
 * Create a simple horizontal arrow between two x positions at a given y.
 */
export function createHorizontalArrow(
  id: string,
  fromX: number,
  toX: number,
  y: number,
  height: number,
  style: ConnectorStyle,
  zIndex: number
): ConnectorElement {
  const from: Bounds = { x: fromX, y, width: 0, height };
  const to: Bounds = { x: toX, y, width: 0, height };
  return createConnector(id, from, to, "horizontal", style, zIndex);
}

/**
 * Create a simple vertical arrow between two y positions at a given x.
 */
export function createVerticalArrow(
  id: string,
  x: number,
  width: number,
  fromY: number,
  toY: number,
  style: ConnectorStyle,
  zIndex: number
): ConnectorElement {
  const from: Bounds = { x, y: fromY, width, height: 0 };
  const to: Bounds = { x, y: toY, width, height: 0 };
  return createConnector(id, from, to, "vertical", style, zIndex);
}
