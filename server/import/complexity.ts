// Complexity Analyzer - Determines whether to reconstruct or rasterize elements

import type {
  ExtractedElement,
  ExtractedSlide,
  Background,
  ElementAnalysis,
  BackgroundAnalysis,
  ConversionDecision,
  GradientStop,
  Theme,
} from "./types";

// Simple shape types that can be reconstructed with CSS
const SIMPLE_SHAPE_TYPES = new Set([
  "rect",
  "ellipse",
  "roundRect",
  "line",
  "snip1Rect",
  "snip2SameRect",
  "round1Rect",
  "round2SameRect",
]);

// Complex shape types that should be rasterized
const COMPLEX_SHAPE_TYPES = new Set([
  "custom",
  "actionButtonBlank",
  "actionButtonHome",
  "arc",
  "bentArrow",
  "bentConnector2",
  "bentConnector3",
  "bentConnector4",
  "bentConnector5",
  "bentUpArrow",
  "bevel",
  "blockArc",
  "borderCallout1",
  "borderCallout2",
  "borderCallout3",
  "bracePair",
  "bracketPair",
  "callout1",
  "callout2",
  "callout3",
  "can",
  "chartPlus",
  "chartStar",
  "chartX",
  "chevron",
  "chord",
  "circularArrow",
  "cloud",
  "cloudCallout",
  "corner",
  "cornerTabs",
  "cube",
  "curvedConnector2",
  "curvedConnector3",
  "curvedConnector4",
  "curvedConnector5",
  "curvedDownArrow",
  "curvedLeftArrow",
  "curvedRightArrow",
  "curvedUpArrow",
  "decagon",
  "diagStripe",
  "diamond",
  "dodecagon",
  "donut",
  "doubleWave",
  "downArrow",
  "downArrowCallout",
  "flowChartAlternateProcess",
  "flowChartCollate",
  "flowChartConnector",
  "flowChartDecision",
  "flowChartDelay",
  "flowChartDisplay",
  "flowChartDocument",
  "flowChartExtract",
  "flowChartInputOutput",
  "flowChartInternalStorage",
  "flowChartMagneticDisk",
  "flowChartMagneticDrum",
  "flowChartMagneticTape",
  "flowChartManualInput",
  "flowChartManualOperation",
  "flowChartMerge",
  "flowChartMultidocument",
  "flowChartOfflineStorage",
  "flowChartOffpageConnector",
  "flowChartOnlineStorage",
  "flowChartOr",
  "flowChartPredefinedProcess",
  "flowChartPreparation",
  "flowChartProcess",
  "flowChartPunchedCard",
  "flowChartPunchedTape",
  "flowChartSort",
  "flowChartSummingJunction",
  "flowChartTerminator",
  "foldedCorner",
  "frame",
  "funnel",
  "gear6",
  "gear9",
  "halfFrame",
  "heart",
  "heptagon",
  "hexagon",
  "homePlate",
  "horizontalScroll",
  "irregularSeal1",
  "irregularSeal2",
  "leftArrow",
  "leftArrowCallout",
  "leftBrace",
  "leftBracket",
  "leftCircularArrow",
  "leftRightArrow",
  "leftRightArrowCallout",
  "leftRightCircularArrow",
  "leftRightRibbon",
  "leftRightUpArrow",
  "leftUpArrow",
  "lightningBolt",
  "mathDivide",
  "mathEqual",
  "mathMinus",
  "mathMultiply",
  "mathNotEqual",
  "mathPlus",
  "moon",
  "nonIsoscelesTrapezoid",
  "noSmoking",
  "notchedRightArrow",
  "octagon",
  "parallelogram",
  "pentagon",
  "pie",
  "pieWedge",
  "plaque",
  "plaqueTabs",
  "plus",
  "quadArrow",
  "quadArrowCallout",
  "ribbon",
  "ribbon2",
  "rightArrow",
  "rightArrowCallout",
  "rightBrace",
  "rightBracket",
  "rtTriangle",
  "smileyFace",
  "squareTabs",
  "star10",
  "star12",
  "star16",
  "star24",
  "star32",
  "star4",
  "star5",
  "star6",
  "star7",
  "star8",
  "stripedRightArrow",
  "sun",
  "swooshArrow",
  "teardrop",
  "trapezoid",
  "triangle",
  "upArrow",
  "upArrowCallout",
  "upDownArrow",
  "upDownArrowCallout",
  "uturnArrow",
  "verticalScroll",
  "wave",
  "wedgeEllipseCallout",
  "wedgeRectCallout",
  "wedgeRoundRectCallout",
]);

/**
 * Analyze an element to determine if it should be reconstructed or rasterized
 */
export function analyzeElement(element: ExtractedElement): ElementAnalysis {
  const reasons: string[] = [];

  // Text elements are always reconstructed
  if (element.type === "text") {
    reasons.push("Text elements are always editable");
    return { element, decision: "reconstruct", reasons };
  }

  // Images are always reconstructed (we use the actual image file)
  if (element.type === "image") {
    reasons.push("Images use original file");
    return { element, decision: "reconstruct", reasons };
  }

  // Lines are simple to reconstruct
  if (element.type === "line") {
    reasons.push("Lines are simple CSS");
    return { element, decision: "reconstruct", reasons };
  }

  // Analyze shapes
  if (element.type === "shape" && element.shape) {
    const shape = element.shape;

    // Check shape type complexity
    if (COMPLEX_SHAPE_TYPES.has(shape.shapeType)) {
      reasons.push(`Complex shape type: ${shape.shapeType}`);
      return { element, decision: "rasterize", reasons };
    }

    if (!SIMPLE_SHAPE_TYPES.has(shape.shapeType) && shape.shapeType !== "rect") {
      reasons.push(`Unknown shape type: ${shape.shapeType}`);
      return { element, decision: "rasterize", reasons };
    }

    // Check for complex fills (gradients, patterns)
    if (shape.fill && shape.fill !== "none") {
      if (shape.fill.includes("gradient") || shape.fill.includes("pattern")) {
        reasons.push("Complex fill pattern");
        return { element, decision: "rasterize", reasons };
      }
    }

    // Simple shape with solid fill - reconstruct
    reasons.push(`Simple shape: ${shape.shapeType}`);
    return { element, decision: "reconstruct", reasons };
  }

  // Tables, charts, SmartArt - rasterize for now
  if (element.type === "table") {
    reasons.push("Tables require complex layout");
    return { element, decision: "rasterize", reasons };
  }

  if (element.type === "chart") {
    reasons.push("Charts require special rendering");
    return { element, decision: "rasterize", reasons };
  }

  if (element.type === "smartart") {
    reasons.push("SmartArt requires special rendering");
    return { element, decision: "rasterize", reasons };
  }

  // Default: rasterize unknown types
  reasons.push(`Unknown element type: ${element.type}`);
  return { element, decision: "rasterize", reasons };
}

/**
 * Build CSS for a gradient background
 */
function buildGradientCss(angle: number, stops: GradientStop[]): string {
  const cssAngle = (90 - angle + 360) % 360; // Convert from PPTX angle to CSS angle
  const colorStops = stops
    .map(s => `${s.color} ${s.position}%`)
    .join(", ");
  return `linear-gradient(${cssAngle}deg, ${colorStops})`;
}

/**
 * Analyze the background to determine reconstruction strategy
 */
export function analyzeBackground(background: Background): BackgroundAnalysis {
  const reasons: string[] = [];

  // No background - nothing to do
  if (background.type === "none") {
    reasons.push("No background specified");
    return { decision: "reconstruct", reasons };
  }

  // Solid color - easy to reconstruct
  if (background.type === "solid" && background.color) {
    reasons.push("Solid color background");
    return {
      decision: "reconstruct",
      css: `background: ${background.color}`,
      reasons,
    };
  }

  // Simple gradients (2-3 stops) - reconstruct
  if (background.type === "gradient" && background.gradient) {
    const { angle, stops } = background.gradient;
    if (stops.length <= 3) {
      reasons.push(`Simple gradient with ${stops.length} stops`);
      return {
        decision: "reconstruct",
        css: `background: ${buildGradientCss(angle, stops)}`,
        reasons,
      };
    }
    reasons.push(`Complex gradient with ${stops.length} stops`);
    return { decision: "rasterize-background", reasons };
  }

  // Image backgrounds - could be from master slide
  if (background.type === "image") {
    if (background.rId) {
      reasons.push("Background image from master slide");
      return { decision: "rasterize-master", reasons };
    }
    if (background.imageUrl) {
      reasons.push("Background image with URL");
      return {
        decision: "reconstruct",
        css: `background: url(${background.imageUrl}) center/cover`,
        reasons,
      };
    }
  }

  // Default: rasterize
  reasons.push("Unknown background type");
  return { decision: "rasterize-background", reasons };
}

/**
 * Analyze a full slide and categorize elements
 */
export function analyzeSlide(slide: ExtractedSlide): {
  backgroundAnalysis: BackgroundAnalysis;
  elementsToReconstruct: ElementAnalysis[];
  elementsToRasterize: ElementAnalysis[];
  canFullyReconstruct: boolean;
} {
  const backgroundAnalysis = analyzeBackground(slide.background);
  const elementsToReconstruct: ElementAnalysis[] = [];
  const elementsToRasterize: ElementAnalysis[] = [];

  for (const element of slide.elements) {
    const analysis = analyzeElement(element);
    if (analysis.decision === "reconstruct") {
      elementsToReconstruct.push(analysis);
    } else {
      elementsToRasterize.push(analysis);
    }
  }

  // Can fully reconstruct if background is reconstructable and no elements need rasterization
  const canFullyReconstruct =
    backgroundAnalysis.decision === "reconstruct" &&
    elementsToRasterize.length === 0;

  return {
    backgroundAnalysis,
    elementsToReconstruct,
    elementsToRasterize,
    canFullyReconstruct,
  };
}
