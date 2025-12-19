import type {
  EditableElement,
  ImageElement,
  ShapeElement,
  SlideBackground,
  SlideSource,
  TextElement,
  TextStyle,
} from "../types";

const CANONICAL_WIDTH_PX = 960;
const CANONICAL_HEIGHT_PX = 540;

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

function parseStyle(style: string): Record<string, string> {
  const output: Record<string, string> = {};
  style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [rawKey, ...rawValue] = part.split(":");
      if (!rawKey || rawValue.length === 0) return;
      const key = rawKey.trim().toLowerCase();
      const value = rawValue.join(":").trim();
      output[key] = value;
    });
  return output;
}

function parsePercent(value: string | undefined, axis: "x" | "y"): number | null {
  if (!value) return null;
  if (value.endsWith("%")) {
    const parsed = Number(value.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value.endsWith("px")) {
    const parsed = Number(value.replace("px", ""));
    if (!Number.isFinite(parsed)) return null;
    const denom = axis === "x" ? CANONICAL_WIDTH_PX : CANONICAL_HEIGHT_PX;
    return (parsed / denom) * 100;
  }
  return null;
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  if (value.endsWith("px")) {
    const parsed = Number(value.replace("px", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseRotation(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/rotate\(([-\d.]+)deg\)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  const style = styleToString({
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
  });
  return `<div data-el-id="${escapeHtml(element.id)}" data-el-type="text" style="${style}">${escapeHtml(
    text.content
  )}</div>`;
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

  if (shape.stroke && shape.strokeWidth) {
    styles.border = `${formatNumber(shape.strokeWidth)}px solid ${shape.stroke}`;
  }

  if (shape.kind === "ellipse") {
    styles["border-radius"] = "50%";
  } else if (shape.kind === "roundRect" && shape.borderRadius) {
    styles["border-radius"] = formatPx(shape.borderRadius);
  } else if (shape.kind === "line") {
    styles["background-color"] = shape.stroke || shape.fill || "#000000";
  }

  const style = styleToString(styles);
  return `<div data-el-id="${escapeHtml(element.id)}" data-el-type="shape" data-shape-kind="${escapeHtml(
    shape.kind
  )}" style="${style}"></div>`;
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

function parseBackground(el: HTMLElement): SlideBackground | null {
  if (el.getAttribute("data-el-role") !== "background") return null;
  if (el.tagName === "IMG") {
    const url = el.getAttribute("src") || "";
    return url ? { type: "rasterized", url } : { type: "none" };
  }
  const style = parseStyle(el.getAttribute("style") || "");
  if (style["background-image"]) {
    const gradientMatch = style["background-image"].match(
      /linear-gradient\(([-\d.]+)deg,\s*(.+)\)/i
    );
    if (gradientMatch) {
      const angle = Number(gradientMatch[1]);
      const stopsRaw = gradientMatch[2]
        .split(",")
        .map((stop) => stop.trim())
        .filter(Boolean);
      const stops = stopsRaw
        .map((stop) => {
          const parts = stop.split(" ");
          if (parts.length < 2) return null;
          const color = parts.slice(0, -1).join(" ");
          const position = Number(parts[parts.length - 1].replace("%", ""));
          if (!Number.isFinite(position)) return null;
          return { color, position };
        })
        .filter((stop): stop is { color: string; position: number } => !!stop);
      if (Number.isFinite(angle) && stops.length) {
        return { type: "gradient", angle, stops };
      }
    }
    const urlMatch = style["background-image"].match(/url\(["']?([^"')]+)["']?\)/i);
    if (urlMatch) {
      return { type: "image", url: urlMatch[1] };
    }
  }
  if (style["background-color"]) {
    return { type: "solid", color: style["background-color"] };
  }
  return { type: "none" };
}

function parseTextStyle(style: Record<string, string>): TextStyle {
  const fontSize = parsePx(style["font-size"]) || 16;
  const fontWeight = style["font-weight"] && Number(style["font-weight"]) >= 600 ? "bold" : "normal";
  const fontStyle = style["font-style"] === "italic" ? "italic" : "normal";
  const align = (style["text-align"] as TextStyle["align"]) || "left";
  const verticalAlign =
    style["justify-content"] === "center"
      ? "middle"
      : style["justify-content"] === "flex-end"
        ? "bottom"
        : "top";
  return {
    fontFamily: style["font-family"] || "Arial",
    fontSize,
    fontWeight,
    fontStyle,
    color: style.color || "#000000",
    align,
    verticalAlign,
  };
}

function parseShapeStyle(
  element: HTMLElement,
  style: Record<string, string>
): ShapeElement {
  const radius = style["border-radius"];
  const shapeKind = (element.getAttribute("data-shape-kind") as ShapeElement["kind"]) || null;

  let kind: ShapeElement["kind"] = "rect";
  if (shapeKind) {
    kind = shapeKind;
  } else if (radius === "50%") {
    kind = "ellipse";
  } else if (radius && radius !== "0px") {
    kind = "roundRect";
  }

  const fill = style["background-color"] && style["background-color"] !== "transparent"
    ? style["background-color"]
    : "none";

  let stroke: string | undefined;
  let strokeWidth: number | undefined;
  if (style.border) {
    const widthMatch = style.border.match(/(\d+(\.\d+)?)px/);
    const colorMatch = style.border.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
    if (widthMatch) {
      strokeWidth = Number(widthMatch[1]);
    }
    if (colorMatch) {
      stroke = colorMatch[1];
    }
  }

  const borderRadius = radius ? parsePx(radius) || undefined : undefined;

  return {
    kind,
    fill,
    stroke,
    strokeWidth,
    borderRadius,
  };
}

function parseBounds(style: Record<string, string>): { x: number; y: number; width: number; height: number } {
  const x = parsePercent(style.left, "x") ?? 0;
  const y = parsePercent(style.top, "y") ?? 0;
  const width = parsePercent(style.width, "x") ?? 0;
  const height = parsePercent(style.height, "y") ?? 0;
  return { x, y, width, height };
}

export function htmlToScene(html: string): SlideSource {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root");
  const elements: EditableElement[] = [];

  let background: SlideBackground = { type: "none" };
  if (root) {
    const children = Array.from(root.children) as HTMLElement[];
    for (const child of children) {
      const bg = parseBackground(child);
      if (bg) {
        background = bg;
        continue;
      }
      const style = parseStyle(child.getAttribute("style") || "");
      const bounds = parseBounds(style);
      const rotation = parseRotation(style.transform);
      const zIndex = style["z-index"] ? Number(style["z-index"]) : elements.length;
      const id = child.getAttribute("data-el-id") || crypto.randomUUID();

      if (child.tagName === "IMG") {
        const image: ImageElement = {
          url: child.getAttribute("src") || "",
          alt: child.getAttribute("alt") || undefined,
          objectFit: (style["object-fit"] as ImageElement["objectFit"]) || "cover",
        };
        elements.push({
          id,
          type: "image",
          bounds,
          zIndex,
          rotation,
          image,
        });
        continue;
      }

      const textContent = child.textContent?.trim() || "";
      if (textContent.length > 0 || child.getAttribute("data-el-type") === "text") {
        const text: TextElement = {
          content: child.textContent || "",
          style: parseTextStyle(style),
        };
        elements.push({
          id,
          type: "text",
          bounds,
          zIndex,
          rotation,
          text,
        });
        continue;
      }

      const shape: ShapeElement = parseShapeStyle(child, style);
      const lineCandidate =
        shape.kind === "rect" &&
        (bounds.height <= (shape.strokeWidth || 1) / CANONICAL_HEIGHT_PX * 100 ||
          bounds.width <= (shape.strokeWidth || 1) / CANONICAL_WIDTH_PX * 100);
      if (lineCandidate) {
        shape.kind = "line";
      }

      elements.push({
        id,
        type: "shape",
        bounds,
        zIndex,
        rotation,
        shape,
      });
    }
  }

  return { background, elements };
}
