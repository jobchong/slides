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

  const cssProps: string[] = [
    "position: absolute",
    `left: ${element.bounds.x.toFixed(4)}%`,
    `top: ${element.bounds.y.toFixed(4)}%`,
    `width: ${element.bounds.width.toFixed(4)}%`,
    `height: ${element.bounds.height.toFixed(4)}%`,
    `font-family: '${style.fontFamily}', sans-serif`,
    `font-size: ${style.fontSize}px`,
    `font-weight: ${style.fontWeight === "bold" ? 700 : 400}`,
    `font-style: ${style.fontStyle}`,
    `color: ${style.color}`,
    `text-align: ${style.align}`,
    "white-space: pre-wrap",
    "overflow: hidden",
    "box-sizing: border-box",
  ];

  // Vertical alignment using flexbox
  if (style.verticalAlign !== "top") {
    cssProps.push("display: flex");
    cssProps.push("flex-direction: column");
    if (style.verticalAlign === "middle") {
      cssProps.push("justify-content: center");
    } else if (style.verticalAlign === "bottom") {
      cssProps.push("justify-content: flex-end");
    }
  }

  // Add shape background if present
  if (element.shape) {
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

  // Rotation
  if (element.rotation) {
    cssProps.push(`transform: rotate(${element.rotation}deg)`);
  }

  // Padding for text in shapes
  if (element.shape) {
    cssProps.push("padding: 8px");
  }

  const content = escapeHtml(text.content).replace(/\n/g, "<br>");

  return `<div data-element-id="${element.id}" style="${cssProps.join("; ")}">${content}</div>`;
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

  const cssProps: string[] = [
    "position: absolute",
    `left: ${element.bounds.x.toFixed(4)}%`,
    `top: ${element.bounds.y.toFixed(4)}%`,
    `width: ${element.bounds.width.toFixed(4)}%`,
    `height: ${element.bounds.height.toFixed(4)}%`,
  ];

  // Fill
  if (shape.fill && shape.fill !== "none") {
    cssProps.push(`background: ${shape.fill}`);
  }

  // Stroke
  if (shape.stroke) {
    cssProps.push(`border: ${shape.strokeWidth || 1}px solid ${shape.stroke}`);
  }

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
    cssProps.push("height: 0");
    cssProps.push(`border-top: ${shape.strokeWidth || 1}px solid ${shape.stroke || "#000"}`);
  }

  return `<div data-element-id="${element.id}" style="${cssProps.join("; ")}"></div>`;
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

