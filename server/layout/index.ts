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
import { layoutGrid } from "./grid";

export interface LayoutResult {
  source: SlideSource;
  html: string;
}

/**
 * Convert a DiagramIntent to positioned elements and HTML.
 * This is the main entry point for the layout engine.
 */
export function layoutDiagram(intent: DiagramIntent): LayoutResult {
  const normalized = normalizeDiagramIntent(intent);
  // Compute layout based on diagram type
  const layoutElements = computeLayout(normalized);

  // Merge with any freeform elements
  const allElements: EditableElement[] = [
    ...layoutElements,
    ...(normalized.freeformElements || []),
  ];

  // Build SlideSource
  const source: SlideSource = {
    background: convertBackground(normalized.background),
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
      return layoutGrid(nodes, connectors, { columns: layout.columns }) as EditableElement[];

    case "hierarchy":
      return layoutHierarchy(nodes, connectors, { direction: layout.direction }) as EditableElement[];

    default:
      // Freeform: no automatic layout
      return [];
  }
}

function normalizeDiagramIntent(intent: DiagramIntent): DiagramIntent {
  const nodes = Array.isArray(intent.nodes) ? intent.nodes : [];
  const connectors = Array.isArray(intent.connectors) ? intent.connectors : [];
  const layout = normalizeLayout(intent.layout, nodes.length);

  return {
    ...intent,
    layout,
    nodes,
    connectors,
  };
}

function normalizeLayout(layout: DiagramLayout | undefined, nodeCount: number): DiagramLayout {
  if (!layout || typeof layout !== "object") {
    return { type: "flowchart", direction: "horizontal" };
  }

  switch (layout.type) {
    case "flowchart":
      return {
        type: "flowchart",
        direction: layout.direction === "vertical" ? "vertical" : "horizontal",
      };
    case "grid": {
      const columns =
        typeof layout.columns === "number" && layout.columns > 0
          ? layout.columns
          : Math.max(1, Math.ceil(Math.sqrt(nodeCount || 1)));
      return { type: "grid", columns };
    }
    case "hierarchy":
      return {
        type: "hierarchy",
        direction: layout.direction === "left-right" ? "left-right" : "top-down",
      };
    default:
      return { type: "flowchart", direction: "horizontal" };
  }
}

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
