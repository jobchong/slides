// Converter - Transforms ExtractedElements to EditableElements

import type {
  ExtractedElement,
  EditableElement,
  EditableTextElement,
  EditableTextStyle,
  EditableImageElement,
  EditableShapeElement,
  SlideBackground,
  Theme,
  Background,
  TextData,
  ShapeData,
} from "./types";

/**
 * Convert TextData to plain text content
 */
function extractTextContent(textData: TextData): string {
  const normalizeBullet = (char: string): string => {
    if (char === "\uf0b7" || char === "") return "•";
    if (/^[\x00-\x7F]$/.test(char)) return char;
    return "•";
  };

  return textData.paragraphs
    .map(p => {
      const content = p.runs.map(r => r.text).join("");
      if (p.bullet?.type === "bullet") {
        const bullet = p.bullet.char ? normalizeBullet(p.bullet.char) : "•";
        return `${bullet} ${content}`;
      }
      return content;
    })
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
    textData.anchorCtr ? "center" :
    "left";

  const pointsToPx = 96 / 72;
  const fontSizePoints = firstRun?.fontSize || 18;

  return {
    fontFamily: firstRun?.fontFamily || theme.fonts.minorLatin || "Arial",
    fontSize: fontSizePoints * pointsToPx,
    fontWeight: firstRun?.bold ? "bold" : "normal",
    fontStyle: firstRun?.italic ? "italic" : "normal",
    color: firstRun?.color || theme.colors.dk1 || "#000000",
    align: mappedAlign,
    verticalAlign: textData.verticalAlign || "top",
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
        anchorCtr: element.text.anchorCtr,
        insets: element.text.insets,
      },
    };

    // Preserve shape data for text when it affects rendering.
    if (
      element.shape &&
      (element.shape.fill && element.shape.fill !== "none" ||
        element.shape.stroke ||
        element.shape.shapeType === "custom")
    ) {
      textElement.shape = {
        kind: mapShapeKind(element.shape.shapeType),
        fill: element.shape.fill || "none",
        stroke: element.shape.stroke,
        strokeWidth: element.shape.strokeWidth,
        lineStart: element.shape.lineStart,
        lineEnd: element.shape.lineEnd,
        svgPath: element.shape.svgPath,
        svgViewBox: element.shape.svgViewBox,
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
        lineCap: element.shape.lineCap,
        lineHead: element.shape.lineHead,
        lineTail: element.shape.lineTail,
        lineStart: element.shape.lineStart,
        lineEnd: element.shape.lineEnd,
        svgPath: element.shape.svgPath,
        svgViewBox: element.shape.svgViewBox,
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
