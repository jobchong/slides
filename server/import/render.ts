// HTML Renderer - Generates HTML from SlideSource

import type {
  SlideSource,
  SlideBackground,
  EditableElement,
  EditableTextElement,
  EditableShapeElement,
  EditableImageElement,
} from "./types";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Render background CSS
 */
function renderBackgroundStyle(background: SlideBackground): string {
  switch (background.type) {
    case "solid":
      return `background: ${background.color};`;

    case "gradient": {
      const cssAngle = (90 - background.angle + 360) % 360;
      const stops = background.stops
        .map(s => `${s.color} ${s.position}%`)
        .join(", ");
      return `background: linear-gradient(${cssAngle}deg, ${stops});`;
    }

    case "image":
      return `background: url(${escapeHtml(background.url)}) center/cover no-repeat;`;

    case "rasterized":
      // Rasterized backgrounds use an img element, not CSS
      return "";

    case "none":
    default:
      return "background: #ffffff;";
  }
}

/**
 * Render a text element to HTML
 */
function renderTextElement(element: EditableElement): string {
  const text = element.text!;
  const style = text.style;

  const pointsToPx = 96 / 72;
  const fontSizePx = style.fontSize;
  const fontSizePt = fontSizePx / pointsToPx;

  const cssProps: string[] = [
    "position: absolute",
    `left: ${element.bounds.x.toFixed(4)}%`,
    `top: ${element.bounds.y.toFixed(4)}%`,
    `width: ${element.bounds.width.toFixed(4)}%`,
    `height: ${element.bounds.height.toFixed(4)}%`,
    `font-family: '${style.fontFamily}', sans-serif`,
    `font-size: ${fontSizePx}px`,
    `font-weight: ${style.fontWeight === "bold" ? 700 : 400}`,
    `font-style: ${style.fontStyle}`,
    `color: ${style.color}`,
    `text-align: ${style.align}`,
    "white-space: pre-wrap",
    "overflow: hidden",
    "box-sizing: border-box",
    "line-height: 1",
  ];

  const isEllipseText = element.shape?.kind === "ellipse";

  // Vertical alignment using flexbox
  if (isEllipseText || style.verticalAlign !== "top") {
    cssProps.push("display: flex");
    cssProps.push("flex-direction: column");
    if (isEllipseText || style.verticalAlign === "middle") {
      cssProps.push("justify-content: center");
    } else if (style.verticalAlign === "bottom") {
      cssProps.push("justify-content: flex-end");
    }
    if (isEllipseText) {
      cssProps.push("align-items: center");
      cssProps.push("text-align: center");
    }
  }

  // Add shape background if present
  if (element.shape) {
    const isCustomShape = element.shape.kind === "custom";
    if (!isCustomShape) {
      if (element.shape.fill && element.shape.fill !== "none") {
        cssProps.push(`background: ${element.shape.fill}`);
      }
      if (element.shape.stroke) {
        cssProps.push(`border: ${element.shape.strokeWidth || 1}px solid ${element.shape.stroke}`);
      }
      if (element.shape.borderRadius) {
        cssProps.push(`border-radius: ${element.shape.borderRadius}px`);
      }
      if (element.shape.kind === "ellipse") {
        cssProps.push("border-radius: 50%");
      }
    }
  }

  // Rotation
  if (element.rotation) {
    cssProps.push(`transform: rotate(${element.rotation}deg)`);
  }

  // Padding for text in shapes (from PPTX insets when available)
  if (element.shape && !isEllipseText) {
    const lInsPt = (text as EditableTextElement & { insets?: { l?: number; r?: number; t?: number; b?: number } })
      ?.insets?.l ?? 0;
    const rInsPt = (text as EditableTextElement & { insets?: { l?: number; r?: number; t?: number; b?: number } })
      ?.insets?.r ?? 0;
    const tInsPt = (text as EditableTextElement & { insets?: { l?: number; r?: number; t?: number; b?: number } })
      ?.insets?.t ?? 0;
    const bInsPt = (text as EditableTextElement & { insets?: { l?: number; r?: number; t?: number; b?: number } })
      ?.insets?.b ?? 0;
    if (lInsPt || rInsPt || tInsPt || bInsPt) {
      const lIns = lInsPt * pointsToPx;
      const rIns = rInsPt * pointsToPx;
      const tIns = tInsPt * pointsToPx;
      const bIns = bInsPt * pointsToPx;
      cssProps.push(`padding: ${tIns}px ${rIns}px ${bIns}px ${lIns}px`);
    }
  }

  const content = escapeHtml(text.content).replace(/\n/g, "<br>");
  const shape = element.shape;
  const hasCustomShape = shape?.kind === "custom" && shape.svgPath && shape.svgViewBox;
  let customSvg = "";
  if (hasCustomShape && shape) {
    const viewBox = shape.svgViewBox!;
    const fill = shape.fill && shape.fill !== "none" ? shape.fill : "none";
    const stroke = shape.stroke || "none";
    const strokeWidth = stroke !== "none" ? (shape.strokeWidth || 1) * pointsToPx : 0;
    const strokeDasharray = shape.strokeDasharray;
    const dashAttr = strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : "";
    customSvg = `
      <svg viewBox="0 0 ${viewBox.width} ${viewBox.height}" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%; height:100%; display:block; z-index:0;">
        <path d="${shape.svgPath}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
      </svg>
    `.trim();
    cssProps.push("background: none");
  }

  const wrappedContent = hasCustomShape
    ? `<span style="position: relative; z-index: 1;">${content}</span>`
    : content;

  return `<div data-element-id="${element.id}" style="${cssProps.join("; ")}">${customSvg}${wrappedContent}</div>`;
}

/**
 * Render an image element to HTML
 */
function renderImageElement(element: EditableElement): string {
  const image = element.image!;

  const cssProps: string[] = [
    "position: absolute",
    `left: ${element.bounds.x.toFixed(4)}%`,
    `top: ${element.bounds.y.toFixed(4)}%`,
    `width: ${element.bounds.width.toFixed(4)}%`,
    `height: ${element.bounds.height.toFixed(4)}%`,
    `object-fit: ${image.objectFit}`,
  ];

  if (element.rotation) {
    cssProps.push(`transform: rotate(${element.rotation}deg)`);
  }

  return `<img data-element-id="${element.id}" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || "")}" style="${cssProps.join("; ")}" />`;
}

/**
 * Render a shape element to HTML
 */
function renderShapeElement(element: EditableElement): string {
  const shape = element.shape!;
  const pointsToPx = 96 / 72;
  const strokeWidthPx = (shape.strokeWidth || 1) * pointsToPx;

  const isCustomShape = shape.kind === "custom" && shape.svgPath && shape.svgViewBox;
  const isLine = shape.kind === "line";

  const x = element.bounds.x.toFixed(4);
  const y = element.bounds.y.toFixed(4);
  const width = element.bounds.width.toFixed(4);
  const height = element.bounds.height.toFixed(4);
  let left = `${x}%`;
  let top = `${y}%`;
  let widthStyle = `${width}%`;
  let heightStyle = `${height}%`;

  if (isLine) {
    const epsilon = 0.0001;
    if (element.bounds.width <= epsilon) {
      widthStyle = `${strokeWidthPx}px`;
      left = `calc(${x}% - ${strokeWidthPx / 2}px)`;
    }
    if (element.bounds.height <= epsilon) {
      heightStyle = `${strokeWidthPx}px`;
      top = `calc(${y}% - ${strokeWidthPx / 2}px)`;
    }
  }

  const cssProps: string[] = [
    "position: absolute",
    `left: ${left}`,
    `top: ${top}`,
    `width: ${widthStyle}`,
    `height: ${heightStyle}`,
  ];

  // Border radius
  if (shape.kind === "ellipse") {
    cssProps.push("border-radius: 50%");
  } else if (shape.kind === "roundRect" && shape.borderRadius) {
    cssProps.push(`border-radius: ${shape.borderRadius}px`);
  }

  // Rotation
  if (element.rotation) {
    cssProps.push(`transform: rotate(${element.rotation}deg)`);
  }

  // Lines
  if (shape.kind === "line") {
    cssProps.push("border: none");
    cssProps.push("background: none");
  }

  if (!isCustomShape && !isLine) {
    // Fill
    if (shape.fill && shape.fill !== "none") {
      cssProps.push(`background: ${shape.fill}`);
    }

    // Stroke
    if (shape.stroke) {
      cssProps.push(`border: ${strokeWidthPx}px solid ${shape.stroke}`);
    }
  }

  let lineSvg = "";
  if (shape.kind === "line") {
    const stroke = shape.stroke || "#000";
    const lineCap = shape.lineCap === "round" ? "round" : shape.lineCap === "square" ? "square" : "butt";
    const strokeDasharray = shape.strokeDasharray;
    const dashAttr = strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : "";
    const lineStart = shape.lineStart || { x: 0, y: 0 };
    const lineEnd = shape.lineEnd || { x: 100, y: 100 };
    lineSvg = `
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%; height:100%; display:block;">
        <line x1="${lineStart.x}" y1="${lineStart.y}" x2="${lineEnd.x}" y2="${lineEnd.y}" stroke="${stroke}" stroke-width="${strokeWidthPx}" stroke-linecap="${lineCap}"${dashAttr} vector-effect="non-scaling-stroke"></line>
      </svg>
    `.trim();
  }

  let customSvg = "";
  if (isCustomShape) {
    const viewBox = shape.svgViewBox!;
    const fill = shape.fill && shape.fill !== "none" ? shape.fill : "none";
    const stroke = shape.stroke || "none";
    const lineCap = shape.lineCap === "round" ? "round" : shape.lineCap === "square" ? "square" : "butt";
    const strokeWidth = stroke !== "none" ? strokeWidthPx : 0;
    const strokeDasharray = shape.strokeDasharray;
    const dashAttr = strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : "";
    customSvg = `
      <svg viewBox="0 0 ${viewBox.width} ${viewBox.height}" preserveAspectRatio="none" style="width:100%; height:100%; display:block;">
        <path d="${shape.svgPath}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${lineCap}"${dashAttr} stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
      </svg>
    `.trim();
  }

  return `<div data-element-id="${element.id}" style="${cssProps.join("; ")}">${customSvg}${lineSvg}</div>`;
}

/**
 * Render an element to HTML
 */
function renderElement(element: EditableElement): string {
  switch (element.type) {
    case "text":
      return renderTextElement(element);
    case "image":
      return renderImageElement(element);
    case "shape":
      return renderShapeElement(element);
    default:
      return "";
  }
}

/**
 * Render a SlideSource to HTML
 */
export function renderSlideHtml(source: SlideSource): string {
  const bgStyle = renderBackgroundStyle(source.background);

  // Sort elements by z-index
  const sortedElements = [...source.elements].sort((a, b) => a.zIndex - b.zIndex);

  const elementsHtml = sortedElements.map(renderElement).join("\n  ");

  // Build the container
  const containerStyle = [
    "position: relative",
    "width: 100%",
    "height: 100%",
    "overflow: hidden",
    bgStyle,
  ].filter(Boolean).join("; ");

  // If rasterized background, include the image
  let backgroundImg = "";
  if (source.background.type === "rasterized") {
    backgroundImg = `<img data-role="background" src="${escapeHtml(source.background.url)}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0;" />`;
  }

  return `<div data-slide-source="true" style="${containerStyle}">
  ${backgroundImg}
  ${elementsHtml}
</div>`;
}
