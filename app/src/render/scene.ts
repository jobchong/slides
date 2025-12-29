import type {
  EditableElement,
  ImageElement,
  ShapeElement,
  SlideBackground,
  SlideSource,
  TextElement,
} from "../types";

const STYLE_ORDER = [
  "position",
  "top",
  "left",
  "width",
  "height",
  "z-index",
  "transform",
  "transform-origin",
  "display",
  "flex-direction",
  "justify-content",
  "align-items",
  "text-align",
  "white-space",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "color",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "border",
  "border-radius",
  "object-fit",
  "pointer-events",
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value: number, maxDecimals = 2): string {
  const fixed = value.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, "");
}

function formatPercent(value: number): string {
  return `${formatNumber(value)}%`;
}

function formatPx(value: number): string {
  return `${formatNumber(value)}px`;
}

function styleToString(styles: Record<string, string | undefined>): string {
  return STYLE_ORDER
    .filter((key) => styles[key] !== undefined && styles[key] !== "")
    .map((key) => `${key}: ${styles[key]}`)
    .join("; ");
}

function buildBackgroundCss(background: SlideBackground): Record<string, string | undefined> {
  if (background.type === "solid") {
    return { "background-color": background.color };
  }
  if (background.type === "gradient") {
    const stops = background.stops
      .map((stop) => `${stop.color} ${formatNumber(stop.position)}%`)
      .join(", ");
    return { "background-image": `linear-gradient(${background.angle}deg, ${stops})` };
  }
  if (background.type === "image") {
    return {
      "background-image": `url("${background.url}")`,
      "background-size": "cover",
      "background-position": "center",
      "background-repeat": "no-repeat",
    };
  }
  return {};
}

function renderBackground(background: SlideBackground): string {
  if (background.type === "none") return "";

  if (background.type === "rasterized") {
    const style = styleToString({
      position: "absolute",
      top: "0%",
      left: "0%",
      width: "100%",
      height: "100%",
      "object-fit": "cover",
      "z-index": "-1",
      "pointer-events": "none",
    });
    return `<img data-el-role="background" src="${escapeHtml(background.url)}" style="${style}" />`;
  }

  const style = styleToString({
    position: "absolute",
    top: "0%",
    left: "0%",
    width: "100%",
    height: "100%",
    "z-index": "-1",
    "pointer-events": "none",
    ...buildBackgroundCss(background),
  });
  return `<div data-el-role="background" style="${style}"></div>`;
}

function renderTextElement(element: EditableElement, text: TextElement): string {
  const baseStyles = {
    position: "absolute",
    top: formatPercent(element.bounds.y),
    left: formatPercent(element.bounds.x),
    width: formatPercent(element.bounds.width),
    height: formatPercent(element.bounds.height),
    "z-index": String(element.zIndex),
    transform: element.rotation ? `rotate(${formatNumber(element.rotation)}deg)` : undefined,
    "transform-origin": element.rotation ? "center center" : undefined,
    display: "flex",
    "flex-direction": "column",
    "justify-content":
      text.style.verticalAlign === "middle"
        ? "center"
        : text.style.verticalAlign === "bottom"
          ? "flex-end"
          : "flex-start",
    "text-align": text.style.align,
    "white-space": "pre-wrap",
    "font-family": text.style.fontFamily,
    "font-size": formatPx(text.style.fontSize),
    "font-weight": text.style.fontWeight === "bold" ? "700" : "400",
    "font-style": text.style.fontStyle,
    color: text.style.color,
  };
  const shape = element.shape;
  const hasCustomShape = shape?.kind === "custom" && shape.svgPath && shape.svgViewBox;
  let customSvg = "";
  if (hasCustomShape && shape) {
    const viewBox = shape.svgViewBox!;
    const fill = shape.fill && shape.fill !== "none" ? shape.fill : "none";
    const stroke = shape.stroke || "none";
    const strokeWidth = stroke !== "none" ? shape.strokeWidth || 1 : 0;
    const strokeDasharray = shape.strokeDasharray;
    const dashAttr = strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : "";
    customSvg = `
      <svg viewBox="0 0 ${viewBox.width} ${viewBox.height}" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%; height:100%; display:block; z-index:0;">
        <path d="${shape.svgPath}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
      </svg>
    `.trim();
  }

  const content = escapeHtml(text.content);
  const wrappedContent = hasCustomShape
    ? `<span style="position: relative; z-index: 1;">${content}</span>`
    : content;

  const shapeStyles: Record<string, string | undefined> = {};
  if (shape && !hasCustomShape) {
    if (shape.fill && shape.fill !== "none") {
      shapeStyles["background-color"] = shape.fill;
    }
    if (shape.stroke && shape.strokeWidth) {
      shapeStyles.border = `${formatNumber(shape.strokeWidth)}px solid ${shape.stroke}`;
    }
    if (shape.kind === "ellipse") {
      shapeStyles["border-radius"] = "50%";
    } else if (shape.kind === "roundRect" && shape.borderRadius) {
      shapeStyles["border-radius"] = formatPx(shape.borderRadius);
    }
  }

  const mergedStyle = styleToString({
    ...baseStyles,
    ...shapeStyles,
  });

  return `<div data-el-id="${escapeHtml(element.id)}" data-el-type="text" style="${mergedStyle}">${customSvg}${wrappedContent}</div>`;
}

function renderShapeElement(element: EditableElement, shape: ShapeElement): string {
  const styles: Record<string, string | undefined> = {
    position: "absolute",
    top: formatPercent(element.bounds.y),
    left: formatPercent(element.bounds.x),
    width: formatPercent(element.bounds.width),
    height: formatPercent(element.bounds.height),
    "z-index": String(element.zIndex),
    transform: element.rotation ? `rotate(${formatNumber(element.rotation)}deg)` : undefined,
    "transform-origin": element.rotation ? "center center" : undefined,
    "background-color": shape.fill === "none" ? "transparent" : shape.fill,
  };

  const isCustomShape = shape.kind === "custom" && shape.svgPath && shape.svgViewBox;
  const isLine = shape.kind === "line";

  if (!isCustomShape && !isLine) {
    if (shape.stroke && shape.strokeWidth) {
      styles.border = `${formatNumber(shape.strokeWidth)}px solid ${shape.stroke}`;
    }
    if (shape.kind === "ellipse") {
      styles["border-radius"] = "50%";
    } else if (shape.kind === "roundRect" && shape.borderRadius) {
      styles["border-radius"] = formatPx(shape.borderRadius);
    }
  } else {
    styles["background-color"] = "transparent";
    styles.border = "none";
  }

  let customSvg = "";
  if (isCustomShape) {
    const viewBox = shape.svgViewBox!;
    const fill = shape.fill && shape.fill !== "none" ? shape.fill : "none";
    const stroke = shape.stroke || "none";
    const strokeWidth = stroke !== "none" ? shape.strokeWidth || 1 : 0;
    const strokeDasharray = shape.strokeDasharray;
    const dashAttr = strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : "";
    customSvg = `
      <svg viewBox="0 0 ${viewBox.width} ${viewBox.height}" preserveAspectRatio="none" style="width:100%; height:100%; display:block;">
        <path d="${shape.svgPath}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
      </svg>
    `.trim();
  }

  let lineSvg = "";
  if (isLine) {
    const stroke = shape.stroke || shape.fill || "#000000";
    const lineCap = shape.lineCap === "round" ? "round" : shape.lineCap === "square" ? "square" : "butt";
    const strokeWidth = shape.strokeWidth || 1;
    const strokeDasharray = shape.strokeDasharray;
    const dashAttr = strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : "";
    lineSvg = `
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%; height:100%; display:block;">
        <line x1="0" y1="50" x2="100" y2="50" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${lineCap}"${dashAttr}></line>
      </svg>
    `.trim();
  }

  const style = styleToString(styles);
  return `<div data-el-id="${escapeHtml(element.id)}" data-el-type="shape" data-shape-kind="${escapeHtml(
    shape.kind
  )}" style="${style}">${customSvg}${lineSvg}</div>`;
}

function renderImageElement(element: EditableElement, image: ImageElement): string {
  const style = styleToString({
    position: "absolute",
    top: formatPercent(element.bounds.y),
    left: formatPercent(element.bounds.x),
    width: formatPercent(element.bounds.width),
    height: formatPercent(element.bounds.height),
    "z-index": String(element.zIndex),
    transform: element.rotation ? `rotate(${formatNumber(element.rotation)}deg)` : undefined,
    "transform-origin": element.rotation ? "center center" : undefined,
    "object-fit": image.objectFit,
  });
  const alt = image.alt ? ` alt="${escapeHtml(image.alt)}"` : "";
  return `<img data-el-id="${escapeHtml(element.id)}" data-el-type="image"${alt} src="${escapeHtml(
    image.url
  )}" style="${style}" />`;
}

export function sceneToHtml(source: SlideSource): string {
  const parts: string[] = [];
  const backgroundMarkup = renderBackground(source.background);
  if (backgroundMarkup) parts.push(backgroundMarkup);

  const sortedElements = [...source.elements].sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return a.id.localeCompare(b.id);
  });

  for (const element of sortedElements) {
    if (element.type === "text" && element.text) {
      parts.push(renderTextElement(element, element.text));
    } else if (element.type === "shape" && element.shape) {
      parts.push(renderShapeElement(element, element.shape));
    } else if (element.type === "image" && element.image) {
      parts.push(renderImageElement(element, element.image));
    }
  }

  return parts.join("");
}
