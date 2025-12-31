import pptxgen from "pptxgenjs";
import { imageSize } from "image-size";

import type { Slide, SlideSource } from "../../app/src/types";
import type { EditableElement } from "../import/types";
import { renderHtmlToPng } from "./html-to-image";
import { boundsToInches, fontSizePxToPt, normalizeColor, WIDE_SLIDE_INCHES } from "./utils";

const SLIDE_PIXEL_SIZE = { width: 1280, height: 720 };

async function imageUrlToData(url: string, baseUrl: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const resolved = url.startsWith("/") ? `${baseUrl}${url}` : url;
  const response = await fetch(resolved);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const b64 = buffer.toString("base64");
  return `data:${contentType};base64,${b64}`;
}

function svgToDataUrl(svg: string): string {
  const encoded = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}

async function addBackgroundImage(slide: PptxGenJS.Slide, data: string) {
  slide.addImage({ data, x: 0, y: 0, w: WIDE_SLIDE_INCHES.width, h: WIDE_SLIDE_INCHES.height });
}

function buildGradientSvg(angle: number, stops: { position: number; color: string }[]): string {
  const radians = ((90 - angle + 360) % 360) * (Math.PI / 180);
  const x1 = 0.5 - 0.5 * Math.cos(radians);
  const y1 = 0.5 - 0.5 * Math.sin(radians);
  const x2 = 0.5 + 0.5 * Math.cos(radians);
  const y2 = 0.5 + 0.5 * Math.sin(radians);
  const gradientStops = stops
    .map((stop) => `<stop offset="${stop.position}%" stop-color="${stop.color}" />`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_PIXEL_SIZE.width}" height="${SLIDE_PIXEL_SIZE.height}" viewBox="0 0 ${SLIDE_PIXEL_SIZE.width} ${SLIDE_PIXEL_SIZE.height}">
  <defs>
    <linearGradient id="bg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
      ${gradientStops}
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
</svg>`;
}

async function addSlideBackground(slide: PptxGenJS.Slide, source: SlideSource, baseUrl: string) {
  const background = source.background;
  if (background.type === "solid") {
    slide.background = { color: normalizeColor(background.color) };
    return;
  }

  if (background.type === "gradient") {
    const svg = buildGradientSvg(background.angle, background.stops);
    await addBackgroundImage(slide, svgToDataUrl(svg));
    return;
  }

  if (background.type === "image" || background.type === "rasterized") {
    const data = await imageUrlToData(background.url, baseUrl);
    await addBackgroundImage(slide, data);
  }
}

function computeContainSizing(
  bounds: { x: number; y: number; w: number; h: number },
  intrinsic: { width: number; height: number }
) {
  const scale = Math.min(bounds.w / intrinsic.width, bounds.h / intrinsic.height);
  const width = intrinsic.width * scale;
  const height = intrinsic.height * scale;
  return {
    x: bounds.x + (bounds.w - width) / 2,
    y: bounds.y + (bounds.h - height) / 2,
    w: width,
    h: height,
  };
}

async function addEditableElement(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  element: EditableElement,
  baseUrl: string
) {
  const bounds = boundsToInches(element.bounds);

  if (element.type === "text" && element.text) {
    slide.addText(element.text.content, {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      fontFace: element.text.style.fontFamily,
      fontSize: fontSizePxToPt(element.text.style.fontSize),
      bold: element.text.style.fontWeight === "bold",
      italic: element.text.style.fontStyle === "italic",
      color: normalizeColor(element.text.style.color),
      align: element.text.style.align,
      valign: element.text.style.verticalAlign,
      fill: element.shape?.fill && element.shape.fill !== "none" ? { color: normalizeColor(element.shape.fill) } : undefined,
      line: element.shape?.stroke ? { color: normalizeColor(element.shape.stroke), width: element.shape.strokeWidth } : undefined,
      rotate: element.rotation ? element.rotation : undefined,
    });
    return;
  }

  if (element.type === "shape" && element.shape) {
    if (element.shape.kind === "custom" && element.shape.svgPath && element.shape.svgViewBox) {
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${element.shape.svgViewBox.width}" height="${element.shape.svgViewBox.height}" viewBox="0 0 ${element.shape.svgViewBox.width} ${element.shape.svgViewBox.height}">
  <path d="${element.shape.svgPath}" fill="${element.shape.fill || "none"}" stroke="${element.shape.stroke || "none"}" stroke-width="${element.shape.strokeWidth || 1}" />
</svg>`;
      slide.addImage({ data: svgToDataUrl(svg), x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, rotate: element.rotation ?? 0 });
      return;
    }

    const shapeType =
      element.shape.kind === "ellipse"
        ? pptx.ShapeType.ellipse
        : element.shape.kind === "roundRect"
          ? pptx.ShapeType.roundRect
          : element.shape.kind === "line"
            ? pptx.ShapeType.line
            : pptx.ShapeType.rect;

    const options: PptxGenJS.ShapeProps = {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      fill: element.shape.fill && element.shape.fill !== "none" ? { color: normalizeColor(element.shape.fill) } : undefined,
      line: element.shape.stroke
        ? {
            color: normalizeColor(element.shape.stroke),
            width: element.shape.strokeWidth,
            dash: element.shape.strokeDasharray ? "dash" : undefined,
            cap: element.shape.lineCap === "round" ? "round" : element.shape.lineCap === "square" ? "square" : undefined,
          }
        : undefined,
      rotate: element.rotation ? element.rotation : undefined,
    };

    slide.addShape(shapeType, options);
    return;
  }

  if (element.type === "image" && element.image) {
    const data = await imageUrlToData(element.image.url, baseUrl);
    if (element.image.objectFit === "contain") {
      const buffer = Buffer.from(data.split(",")[1] || "", "base64");
      const dimensions = imageSize(buffer);
      if (dimensions.width && dimensions.height) {
        const sized = computeContainSizing(bounds, { width: dimensions.width, height: dimensions.height });
        slide.addImage({ data, x: sized.x, y: sized.y, w: sized.w, h: sized.h, rotate: element.rotation ?? 0 });
        return;
      }
    }

    slide.addImage({ data, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, rotate: element.rotation ?? 0 });
  }
}

async function renderHtmlSlide(html: string): Promise<string> {
  const buffer = await renderHtmlToPng(html, {
    width: SLIDE_PIXEL_SIZE.width,
    height: SLIDE_PIXEL_SIZE.height,
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function exportDeckToPptx(slides: Slide[], baseUrl: string): Promise<Uint8Array> {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";

  for (const slide of slides) {
    const pptxSlide = pptx.addSlide();

    if (!slide.source) {
      const data = await renderHtmlSlide(slide.html || "");
      await addBackgroundImage(pptxSlide, data);
      continue;
    }

    await addSlideBackground(pptxSlide, slide.source, baseUrl);

    const sorted = [...slide.source.elements].sort((a, b) => a.zIndex - b.zIndex);
    for (const element of sorted) {
      await addEditableElement(pptx, pptxSlide, element as EditableElement, baseUrl);
    }
  }

  const buffer = await pptx.write({ outputType: "arraybuffer" });
  return new Uint8Array(buffer as ArrayBuffer);
}
