// Diagram Layout Engine
// Converts DiagramIntent (semantic description) to HTML via deterministic layout

import type {
  DiagramIntent,
  DiagramLayout,
  SlideBackground,
  EditableElement,
} from "../../app/src/types";
import type { SlideSource } from "../import/types";
import { renderSlideHtml } from "../import/render";
import { layoutFlowchart } from "./flowchart";
import { layoutHierarchy } from "./hierarchy";

export interface LayoutResult {
  source: SlideSource;
  html: string;
}

/**
 * Convert a DiagramIntent to positioned elements and HTML.
 * This is the main entry point for the layout engine.
 */
export function layoutDiagram(intent: DiagramIntent): LayoutResult {
  // Compute layout based on diagram type
  const layoutElements = computeLayout(intent);

  // Merge with any freeform elements
  const allElements: EditableElement[] = [
    ...layoutElements,
    ...(intent.freeformElements || []),
  ];

  // Build SlideSource
  const source: SlideSource = {
    background: convertBackground(intent.background),
    elements: allElements,
  };

  // Render to HTML using existing pipeline
  const html = renderSlideHtml(source);

  return { source, html };
}

/**
 * Route to the appropriate layout algorithm based on diagram type.
 */
function computeLayout(intent: DiagramIntent): EditableElement[] {
  const { layout, nodes, connectors } = intent;

  switch (layout.type) {
    case "flowchart":
      return layoutFlowchart(nodes, connectors, {
        direction: layout.direction,
      }) as EditableElement[];

    case "grid":
      return layoutGrid(nodes, layout.columns);

    case "hierarchy":
      return layoutHierarchy(nodes, connectors, { direction: layout.direction }) as EditableElement[];

    default:
      // Freeform: no automatic layout
      return [];
  }
}

/**
 * Grid layout: arrange nodes in a matrix with specified columns.
 * TODO: Full implementation
 */
function layoutGrid(
  nodes: import("../../app/src/types").DiagramNode[],
  columns: number
): EditableElement[] {
  if (nodes.length === 0) return [];

  const rows = Math.ceil(nodes.length / columns);
  const cellWidth = 80 / columns;
  const cellHeight = 60 / rows;
  const nodeWidth = cellWidth * 0.7;
  const nodeHeight = cellHeight * 0.7;
  const startX = 10;
  const startY = 20;

  const elements: EditableElement[] = [];

  nodes.forEach((node, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const style = node.style || {};

    elements.push({
      id: node.id,
      type: "text",
      bounds: {
        x: startX + col * cellWidth + (cellWidth - nodeWidth) / 2,
        y: startY + row * cellHeight + (cellHeight - nodeHeight) / 2,
        width: nodeWidth,
        height: nodeHeight,
      },
      zIndex: i + 1,
      text: {
        content: node.label,
        style: {
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: "bold",
          fontStyle: "normal",
          color: style.textColor || "#ffffff",
          align: "center",
          verticalAlign: "middle",
        },
      },
      shape: {
        kind: "roundRect",
        fill: style.fill || getDefaultColor(i),
        borderRadius: 8,
      },
    });
  });

  return elements;
}

/**
 * Hierarchy layout: tree structure.
 * TODO: Full implementation with proper tree layout algorithm
 */
/**
 * Convert optional background to SlideBackground.
 */
function convertBackground(bg?: SlideBackground): SlideBackground {
  if (!bg) {
    return { type: "solid", color: "#ffffff" };
  }
  return bg;
}

/**
 * Default color palette.
 */
function getDefaultColor(index: number): string {
  const colors = [
    "#4A90D9",
    "#5CB85C",
    "#F0AD4E",
    "#D9534F",
    "#9B59B6",
    "#1ABC9C",
  ];
  return colors[index % colors.length];
}
