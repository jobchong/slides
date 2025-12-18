// Converter - Transforms ExtractedElements to EditableElements

import type {
  ExtractedElement,
  ExtractedSlide,
  EditableElement,
  EditableTextElement,
  EditableTextStyle,
  EditableImageElement,
  EditableShapeElement,
  SlideBackground,
  SlideSource,
  Theme,
  Background,
  TextData,
  ShapeData,
} from "./types";
import { analyzeSlide, analyzeBackground } from "./complexity";

/**
 * Convert TextData to plain text content
 */
function extractTextContent(textData: TextData): string {
  return textData.paragraphs
    .map(p => p.runs.map(r => r.text).join(""))
    .join("\n");
}

/**
 * Extract dominant text style from TextData
 */
function extractTextStyle(textData: TextData, theme: Theme): EditableTextStyle {
  // Get the first run with style info as the dominant style
  const firstPara = textData.paragraphs[0];
  const firstRun = firstPara?.runs[0];

  // Map PPTX align to our simpler set (justify -> left)
  const align = firstPara?.align;
  const mappedAlign: "left" | "center" | "right" =
    align === "center" ? "center" :
    align === "right" ? "right" :
    "left";

  return {
    fontFamily: firstRun?.fontFamily || theme.fonts.minorLatin || "Arial",
    fontSize: firstRun?.fontSize || 18,
    fontWeight: firstRun?.bold ? "bold" : "normal",
    fontStyle: firstRun?.italic ? "italic" : "normal",
    color: firstRun?.color || theme.colors.dk1 || "#000000",
    align: mappedAlign,
    verticalAlign: "top", // Default, PPTX doesn't always specify
  };
}

/**
 * Map PPTX shape type to editable shape kind
 */
function mapShapeKind(shapeType: string): EditableShapeElement["kind"] {
  switch (shapeType) {
    case "rect":
      return "rect";
    case "ellipse":
      return "ellipse";
    case "line":
      return "line";
    case "roundRect":
    case "round1Rect":
    case "round2SameRect":
    case "snip1Rect":
    case "snip2SameRect":
      return "roundRect";
    default:
      return "custom";
  }
}

/**
 * Convert an ExtractedElement to an EditableElement
 */
export function convertToEditable(
  element: ExtractedElement,
  theme: Theme,
  imageUrlResolver?: (rId: string) => string | undefined
): EditableElement | null {
  const base: Omit<EditableElement, "type" | "text" | "image" | "shape"> = {
    id: element.id,
    bounds: element.bounds,
    zIndex: element.zIndex,
    rotation: element.rotation,
  };

  // Text element
  if (element.type === "text" && element.text) {
    const textElement: EditableElement = {
      ...base,
      type: "text",
      text: {
        content: extractTextContent(element.text),
        style: extractTextStyle(element.text, theme),
      },
    };

    // If shape has fill, include it (colored text box)
    if (element.shape && element.shape.fill && element.shape.fill !== "none") {
      textElement.shape = {
        kind: mapShapeKind(element.shape.shapeType),
        fill: element.shape.fill,
        stroke: element.shape.stroke,
        strokeWidth: element.shape.strokeWidth,
      };
    }

    return textElement;
  }

  // Image element
  if (element.type === "image" && element.image) {
    const url = imageUrlResolver?.(element.image.rId) || element.image.url;
    if (!url) {
      return null; // Can't resolve image URL
    }

    return {
      ...base,
      type: "image",
      image: {
        url,
        objectFit: "contain",
      },
    };
  }

  // Shape element (without text)
  if ((element.type === "shape" || element.type === "line") && element.shape) {
    return {
      ...base,
      type: "shape",
      shape: {
        kind: mapShapeKind(element.shape.shapeType),
        fill: element.shape.fill || "none",
        stroke: element.shape.stroke,
        strokeWidth: element.shape.strokeWidth,
        borderRadius: element.shape.shapeType === "roundRect" ? 8 : undefined,
      },
    };
  }

  return null;
}

/**
 * Convert Background to SlideBackground
 */
export function convertBackground(
  background: Background,
  rasterizedUrl?: string
): SlideBackground {
  // If we have a rasterized URL, use it
  if (rasterizedUrl) {
    return { type: "rasterized", url: rasterizedUrl };
  }

  if (background.type === "none") {
    return { type: "none" };
  }

  if (background.type === "solid" && background.color) {
    return { type: "solid", color: background.color };
  }

  if (background.type === "gradient" && background.gradient) {
    return {
      type: "gradient",
      angle: background.gradient.angle,
      stops: background.gradient.stops,
    };
  }

  if (background.type === "image" && background.imageUrl) {
    return { type: "image", url: background.imageUrl };
  }

  // Fallback to none
  return { type: "none" };
}

/**
 * Build SlideSource from an ExtractedSlide
 */
export function buildSlideSource(
  slide: ExtractedSlide,
  theme: Theme,
  options: {
    backgroundUrl?: string;
    screenshotUrl?: string;
    originalFile?: string;
    imageUrlResolver?: (rId: string) => string | undefined;
  } = {}
): SlideSource {
  const analysis = analyzeSlide(slide);

  // Convert background
  const needsRasterizedBackground =
    analysis.backgroundAnalysis.decision !== "reconstruct";
  const background = convertBackground(
    slide.background,
    needsRasterizedBackground ? options.backgroundUrl : undefined
  );

  // Convert elements that should be reconstructed
  const elements: EditableElement[] = [];
  for (const { element } of analysis.elementsToReconstruct) {
    const editable = convertToEditable(element, theme, options.imageUrlResolver);
    if (editable) {
      elements.push(editable);
    }
  }

  return {
    background,
    elements,
    import: {
      originalFile: options.originalFile,
      slideIndex: slide.index,
      screenshot: options.screenshotUrl,
    },
  };
}

/**
 * Build SlideSource for a fully rasterized slide (legacy mode)
 */
export function buildRasterizedSlideSource(
  slide: ExtractedSlide,
  rasterUrl: string,
  theme: Theme,
  options: {
    screenshotUrl?: string;
    originalFile?: string;
    imageUrlResolver?: (rId: string) => string | undefined;
  } = {}
): SlideSource {
  // All elements are overlaid on the raster, but we still extract them for editing
  const elements: EditableElement[] = [];

  for (const element of slide.elements) {
    // Only include text and images - shapes are part of the raster
    if (element.type === "text" || element.type === "image") {
      const editable = convertToEditable(element, theme, options.imageUrlResolver);
      if (editable) {
        elements.push(editable);
      }
    }
  }

  return {
    background: { type: "rasterized", url: rasterUrl },
    elements,
    import: {
      originalFile: options.originalFile,
      slideIndex: slide.index,
      screenshot: options.screenshotUrl,
    },
  };
}
