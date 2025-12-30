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
      return layoutGrid(nodes, connectors, { columns: layout.columns }) as EditableElement[];

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
