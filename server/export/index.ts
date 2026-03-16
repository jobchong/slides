import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { imageSize } from "image-size";

import type { Slide, SlideSource } from "../../app/src/types";
import type { EditableElement, EditableShapeElement } from "../import/types";
import { buildCustomDashXml, matchDashPatternPreset } from "../pptx-dash";
import { renderHtmlToPng } from "./html-to-image";
import { boundsToInches, fontSizePxToPt, normalizeColorInfo, WIDE_SLIDE_INCHES } from "./utils";

const EMU_PER_INCH = 914400;
const SLIDE_PIXEL_SIZE = { width: 1280, height: 720 };
const EXPORT_OBJECT_PREFIX = "slideai-";
const SAFE_UPLOAD_FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_ASSET_REDIRECTS = 4;
const CSS_URL_PATTERN = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

export type ExportAssetUrlOptions = {
  gatewayBaseUrl: string;
  requestBaseUrl?: string;
  publicBaseUrl?: string | null;
  s3PublicBaseUrl?: string | null;
};

export class InvalidExportAssetUrlError extends Error {
  constructor(url: string) {
    super(`Unsupported export asset URL: ${url}`);
    this.name = "InvalidExportAssetUrlError";
  }
}

type DashPatch = {
  slideIndex: number;
  objectName: string;
  dashXml: string;
};

type ShapePoint = NonNullable<PptxGenJS.ShapeProps["points"]>[number];
type ShapeWithTextOptions = PptxGenJS.ShapeProps &
  Partial<PptxGenJS.TextPropsOptions> & {
    _bodyProp?: Record<string, string | number | boolean | undefined>;
  };
type SlideObjectWithText = {
  text?: string | number | PptxGenJS.TextProps[] | null;
};

function normalizeBaseUrl(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function extractFilenameUnderBase(url: URL, baseUrl: string): string | null {
  if (url.search || url.hash) {
    return null;
  }

  const parsedBase = new URL(baseUrl);
  const basePath = parsedBase.pathname.replace(/\/$/, "");
  const expectedPrefix = `${basePath || ""}/`;
  if (url.origin !== parsedBase.origin || !url.pathname.startsWith(expectedPrefix)) {
    return null;
  }

  const filename = url.pathname.slice(expectedPrefix.length);
  if (!SAFE_UPLOAD_FILENAME_PATTERN.test(filename)) {
    return null;
  }

  return filename;
}

function resolveExportAssetUrl(url: string, options: ExportAssetUrlOptions): string {
  if (url.startsWith("data:")) {
    return url;
  }

  const gatewayBaseUrl = normalizeBaseUrl(options.gatewayBaseUrl);
  if (!gatewayBaseUrl) {
    throw new Error("Export gateway base URL must be an absolute URL.");
  }

  if (url.startsWith("/")) {
    const filename = extractFilenameUnderBase(new URL(url, gatewayBaseUrl), `${gatewayBaseUrl}/images`);
    if (!filename) {
      throw new InvalidExportAssetUrlError(url);
    }
    return `${gatewayBaseUrl}/images/${filename}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidExportAssetUrlError(url);
  }

  const allowedGatewayBases = [
    gatewayBaseUrl,
    normalizeBaseUrl(options.requestBaseUrl),
    normalizeBaseUrl(options.publicBaseUrl),
  ].filter((value): value is string => Boolean(value));

  for (const base of allowedGatewayBases) {
    const filename = extractFilenameUnderBase(parsed, `${base}/images`);
    if (filename) {
      return `${gatewayBaseUrl}/images/${filename}`;
    }
  }

  const s3PublicBaseUrl = normalizeBaseUrl(options.s3PublicBaseUrl);
  if (s3PublicBaseUrl) {
    const filename = extractFilenameUnderBase(parsed, s3PublicBaseUrl);
    if (filename) {
      return `${s3PublicBaseUrl}/${filename}`;
    }
  }

  throw new InvalidExportAssetUrlError(url);
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith("2001:db8")) return false;
  return true;
}

function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isPublicIpv4(address);
  }
  if (version === 6) {
    return isPublicIpv6(address);
  }
  return false;
}

async function isPublicHostname(hostname: string): Promise<boolean> {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa")
  ) {
    return false;
  }

  const version = isIP(hostname);
  if (version) {
    return isPublicIpAddress(hostname);
  }

  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every((record) => isPublicIpAddress(record.address));
  } catch {
    return false;
  }
}

async function resolvePublicRemoteAssetUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidExportAssetUrlError(url);
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new InvalidExportAssetUrlError(url);
  }
  if (parsed.username || parsed.password) {
    throw new InvalidExportAssetUrlError(url);
  }
  if (parsed.port && !["80", "443"].includes(parsed.port)) {
    throw new InvalidExportAssetUrlError(url);
  }
  if (!(await isPublicHostname(parsed.hostname))) {
    throw new InvalidExportAssetUrlError(url);
  }

  return parsed.toString();
}

async function resolveHtmlExportAssetUrl(
  url: string,
  options: ExportAssetUrlOptions
): Promise<string> {
  if (url.startsWith("data:")) {
    return url;
  }

  try {
    return resolveExportAssetUrl(url, options);
  } catch (error) {
    if (url.startsWith("/")) {
      throw error;
    }
  }

  return resolvePublicRemoteAssetUrl(url);
}

async function fetchImageResponse(
  url: string,
  options: ExportAssetUrlOptions,
  redirects = 0
): Promise<Response> {
  const response = await fetch(url, { redirect: "manual" });
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.has("location")
  ) {
    if (redirects >= MAX_ASSET_REDIRECTS) {
      throw new Error("Too many redirects while fetching export image.");
    }

    const nextUrl = new URL(response.headers.get("location")!, url).toString();
    const validatedNextUrl = await resolveHtmlExportAssetUrl(nextUrl, options);
    return fetchImageResponse(validatedNextUrl, options, redirects + 1);
  }

  return response;
}

async function responseToDataUrl(response: Response): Promise<string> {
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const b64 = buffer.toString("base64");
  return `data:${contentType};base64,${b64}`;
}

async function imageUrlToData(url: string, options: ExportAssetUrlOptions): Promise<string> {
  if (url.startsWith("data:")) return url;
  const resolved = resolveExportAssetUrl(url, options);
  const response = await fetchImageResponse(resolved, options);
  return responseToDataUrl(response);
}

async function htmlAssetUrlToData(url: string, options: ExportAssetUrlOptions): Promise<string> {
  if (url.startsWith("data:")) return url;
  const resolved = await resolveHtmlExportAssetUrl(url, options);
  const response = await fetchImageResponse(resolved, options);
  return responseToDataUrl(response);
}

async function inlineCssAssetUrls(
  css: string,
  options: ExportAssetUrlOptions,
  cache: Map<string, Promise<string>>
): Promise<string> {
  const matches = Array.from(css.matchAll(CSS_URL_PATTERN));
  if (matches.length === 0) {
    return css;
  }

  let output = "";
  let lastIndex = 0;
  for (const match of matches) {
    const [fullMatch, quote, rawValue] = match;
    const start = match.index ?? 0;
    const end = start + fullMatch.length;
    output += css.slice(lastIndex, start);

    const candidate = rawValue.trim();
    if (!candidate || candidate.startsWith("#") || candidate.startsWith("data:")) {
      output += fullMatch;
      lastIndex = end;
      continue;
    }

    let dataPromise = cache.get(candidate);
    if (!dataPromise) {
      dataPromise = htmlAssetUrlToData(candidate, options);
      cache.set(candidate, dataPromise);
    }
    const dataUrl = await dataPromise;
    const wrapped = quote ? `${quote}${dataUrl}${quote}` : `"${dataUrl}"`;
    output += `url(${wrapped})`;
    lastIndex = end;
  }

  output += css.slice(lastIndex);
  return output;
}

export async function inlineHtmlExportAssetUrls(
  html: string,
  options: ExportAssetUrlOptions
): Promise<string> {
  const cache = new Map<string, Promise<string>>();
  const rewriter = new HTMLRewriter()
    .on("img", {
      async element(element) {
        const src = element.getAttribute("src");
        if (!src || src.startsWith("data:")) {
          return;
        }

        let dataPromise = cache.get(src);
        if (!dataPromise) {
          dataPromise = htmlAssetUrlToData(src, options);
          cache.set(src, dataPromise);
        }
        element.setAttribute("src", await dataPromise);
      },
    })
    .on("image", {
      async element(element) {
        for (const attr of ["href", "xlink:href"]) {
          const value = element.getAttribute(attr);
          if (!value || value.startsWith("data:")) {
            continue;
          }

          let dataPromise = cache.get(value);
          if (!dataPromise) {
            dataPromise = htmlAssetUrlToData(value, options);
            cache.set(value, dataPromise);
          }
          element.setAttribute(attr, await dataPromise);
        }
      },
    })
    .on("[style]", {
      async element(element) {
        const style = element.getAttribute("style");
        if (!style || !style.includes("url(")) {
          return;
        }

        element.setAttribute("style", await inlineCssAssetUrls(style, options, cache));
      },
    });

  const transformed = rewriter.transform(new Response(html));
  return transformed.text();
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

async function addSlideBackground(
  slide: PptxGenJS.Slide,
  source: SlideSource,
  assetUrlOptions: ExportAssetUrlOptions
) {
  const background = source.background;
  if (background.type === "solid") {
    const fill = normalizeColorInfo(background.color);
    if (fill.color) {
      slide.background = { color: fill.color, transparency: fill.transparency };
    }
    return;
  }

  if (background.type === "gradient") {
    const svg = buildGradientSvg(background.angle, background.stops);
    await addBackgroundImage(slide, svgToDataUrl(svg));
    return;
  }

  if (background.type === "image" || background.type === "rasterized") {
    const data = await imageUrlToData(background.url, assetUrlOptions);
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

function getObjectName(element: EditableElement): string {
  return `${EXPORT_OBJECT_PREFIX}${element.id}`;
}

function getTextMargin(
  text: EditableElement["text"]
): PptxGenJS.TextPropsOptions["margin"] | undefined {
  const insets = text?.insets;
  if (!insets) {
    return undefined;
  }

  return [insets.l ?? 0, insets.r ?? 0, insets.b ?? 0, insets.t ?? 0];
}

function mapVerticalAlign(
  value: NonNullable<EditableElement["text"]>["style"]["verticalAlign"]
): "t" | "ctr" | "b" {
  if (value === "middle") {
    return "ctr";
  }
  if (value === "bottom") {
    return "b";
  }
  return "t";
}

function buildTextOptions(
  element: EditableElement,
  bounds: { x: number; y: number; w: number; h: number },
  objectName: string
): ShapeWithTextOptions {
  const text = element.text!;
  const textColor = normalizeColorInfo(text.style.color);
  const margin = getTextMargin(text);

  return {
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    objectName,
    fontFace: text.style.fontFamily,
    fontSize: fontSizePxToPt(text.style.fontSize),
    bold: text.style.fontWeight === "bold",
    italic: text.style.fontStyle === "italic",
    color: textColor.color,
    transparency: textColor.transparency,
    align: text.style.align,
    valign: text.style.verticalAlign,
    margin,
    rotate: element.rotation ?? undefined,
    _bodyProp: {
      wrap: true,
      anchor: mapVerticalAlign(text.style.verticalAlign),
      align: text.style.align,
    },
  };
}

function buildShapeOptions(
  shape: EditableShapeElement,
  bounds: { x: number; y: number; w: number; h: number },
  rotation: number | undefined,
  objectName: string
): { options: PptxGenJS.ShapeProps; dashXml?: string } {
  const fill =
    shape.fill && shape.fill !== "none" ? normalizeColorInfo(shape.fill) : {};
  const line = shape.stroke ? normalizeColorInfo(shape.stroke) : {};
  const dashType = shape.strokeDasharray
    ? matchDashPatternPreset(shape.strokeDasharray, shape.strokeWidth)
    : undefined;
  const dashXml =
    shape.strokeDasharray && !dashType
      ? buildCustomDashXml(shape.strokeDasharray, shape.strokeWidth)
      : undefined;

  return {
    options: {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      objectName,
      fill: fill.color
        ? { color: fill.color, transparency: fill.transparency }
        : undefined,
      line: line.color
        ? {
            color: line.color,
            transparency: line.transparency,
            width: shape.strokeWidth,
            dashType: dashType as PptxGenJS.ShapeLineProps["dashType"],
            beginArrowType:
              shape.lineHead === "oval" ? "oval" : shape.lineHead === "none" ? "none" : undefined,
            endArrowType:
              shape.lineTail === "oval" ? "oval" : shape.lineTail === "none" ? "none" : undefined,
          }
        : undefined,
      rotate: rotation ?? undefined,
    },
    dashXml,
  };
}

function getPrimitiveShapeType(
  pptx: PptxGenJS,
  shape: EditableShapeElement
): PptxGenJS.ShapeType | null {
  switch (shape.kind) {
    case "ellipse":
      return pptx.ShapeType.ellipse;
    case "roundRect":
      return pptx.ShapeType.roundRect;
    case "line":
      return pptx.ShapeType.line;
    case "rect":
      return pptx.ShapeType.rect;
    default:
      return null;
  }
}

function svgPathToCustomGeometryPoints(
  svgPath: string,
  svgViewBox: { width: number; height: number },
  bounds: { w: number; h: number }
): ShapePoint[] | null {
  if (svgViewBox.width <= 0 || svgViewBox.height <= 0) {
    return null;
  }

  const widthEmu = Math.round(bounds.w * EMU_PER_INCH);
  const heightEmu = Math.round(bounds.h * EMU_PER_INCH);
  if (widthEmu <= 0 || heightEmu <= 0) {
    return null;
  }

  const tokens = svgPath.match(/[MLCZ]|-?(?:\d+\.?\d*|\.\d+)/g);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  const scaleX = widthEmu / svgViewBox.width;
  const scaleY = heightEmu / svgViewBox.height;
  const points: ShapePoint[] = [];
  let index = 0;
  let command = "";

  while (index < tokens.length) {
    const token = tokens[index];
    if (isPathCommand(token)) {
      command = token;
      index += 1;
    } else if (!command) {
      return null;
    }

    if (command === "Z") {
      points.push({ close: true });
      command = "";
      continue;
    }

    if (command === "M") {
      const movePoint = readPoint(tokens, index, scaleX, scaleY);
      if (!movePoint) {
        return null;
      }
      points.push({
        x: movePoint.point.x,
        y: movePoint.point.y,
        moveTo: true,
      });
      index = movePoint.nextIndex;
      command = "L";
      continue;
    }

    if (command === "L") {
      const linePoint = readPoint(tokens, index, scaleX, scaleY);
      if (!linePoint) {
        return null;
      }
      points.push(linePoint.point);
      index = linePoint.nextIndex;
      continue;
    }

    if (command === "C") {
      const cubicCurve = readCubicCurve(tokens, index, scaleX, scaleY);
      if (!cubicCurve) {
        return null;
      }
      points.push(cubicCurve.point);
      index = cubicCurve.nextIndex;
      continue;
    }

    return null;
  }

  return points.length > 0 ? points : null;
}

function readPoint(
  tokens: string[],
  index: number,
  scaleX: number,
  scaleY: number
): { point: { x: number; y: number }; nextIndex: number } | null {
  if (!isNumberToken(tokens[index]) || !isNumberToken(tokens[index + 1])) {
    return null;
  }

  return {
    point: {
      x: Math.round(parseFloat(tokens[index]) * scaleX),
      y: Math.round(parseFloat(tokens[index + 1]) * scaleY),
    },
    nextIndex: index + 2,
  };
}

function readCubicCurve(
  tokens: string[],
  index: number,
  scaleX: number,
  scaleY: number
): { point: ShapePoint; nextIndex: number } | null {
  if (
    !isNumberToken(tokens[index]) ||
    !isNumberToken(tokens[index + 1]) ||
    !isNumberToken(tokens[index + 2]) ||
    !isNumberToken(tokens[index + 3]) ||
    !isNumberToken(tokens[index + 4]) ||
    !isNumberToken(tokens[index + 5])
  ) {
    return null;
  }

  return {
    point: {
      x: Math.round(parseFloat(tokens[index + 4]) * scaleX),
      y: Math.round(parseFloat(tokens[index + 5]) * scaleY),
      curve: {
        type: "cubic",
        x1: Math.round(parseFloat(tokens[index]) * scaleX),
        y1: Math.round(parseFloat(tokens[index + 1]) * scaleY),
        x2: Math.round(parseFloat(tokens[index + 2]) * scaleX),
        y2: Math.round(parseFloat(tokens[index + 3]) * scaleY),
      },
    },
    nextIndex: index + 6,
  };
}

function isPathCommand(token: string | undefined): token is "M" | "L" | "C" | "Z" {
  return token === "M" || token === "L" || token === "C" || token === "Z";
}

function isNumberToken(token: string | undefined): boolean {
  return token !== undefined && !isPathCommand(token);
}

function setLatestShapeText(
  slide: PptxGenJS.Slide,
  text: string | number | PptxGenJS.TextProps[]
) {
  const slideObjects = (slide as unknown as { _slideObjects?: SlideObjectWithText[] })._slideObjects;
  const latestObject = slideObjects?.[slideObjects.length - 1];
  if (latestObject) {
    latestObject.text = text;
  }
}

function addShapeWithOptionalText(
  slide: PptxGenJS.Slide,
  shapeType: PptxGenJS.ShapeType,
  options: ShapeWithTextOptions,
  text?: string | number | PptxGenJS.TextProps[]
) {
  slide.addShape(shapeType, options as PptxGenJS.ShapeProps);
  if (text !== undefined) {
    setLatestShapeText(slide, text);
  }
}

function buildShapedTextExport(
  pptx: PptxGenJS,
  element: EditableElement,
  bounds: { x: number; y: number; w: number; h: number },
  objectName: string
): { shapeType: PptxGenJS.ShapeType; options: ShapeWithTextOptions; dashXml?: string } | null {
  if (!element.shape || !element.text || element.shape.kind === "line") {
    return null;
  }

  const { options: shapeOptions, dashXml } = buildShapeOptions(
    element.shape,
    bounds,
    element.rotation,
    objectName
  );
  const textOptions = buildTextOptions(element, bounds, objectName);
  const primitiveShapeType = getPrimitiveShapeType(pptx, element.shape);
  if (primitiveShapeType) {
    return {
      shapeType: primitiveShapeType,
      options: { ...shapeOptions, ...textOptions },
      dashXml,
    };
  }

  if (element.shape.kind !== "custom" || !element.shape.svgPath || !element.shape.svgViewBox) {
    return null;
  }

  const points = svgPathToCustomGeometryPoints(
    element.shape.svgPath,
    element.shape.svgViewBox,
    bounds
  );
  if (!points) {
    return null;
  }

  return {
    shapeType: "custGeom" as PptxGenJS.ShapeType,
    options: { ...shapeOptions, ...textOptions, points },
    dashXml,
  };
}

function queueDashPatch(
  dashPatches: DashPatch[],
  slideIndex: number,
  objectName: string,
  dashXml: string | undefined
) {
  if (!dashXml) {
    return;
  }

  dashPatches.push({ slideIndex, objectName, dashXml });
}

async function addEditableElement(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  element: EditableElement,
  assetUrlOptions: ExportAssetUrlOptions,
  slideIndex: number,
  dashPatches: DashPatch[]
) {
  const bounds = boundsToInches(element.bounds);
  const objectName = getObjectName(element);

  if (element.type === "text" && element.text) {
    const shapedText = buildShapedTextExport(pptx, element, bounds, objectName);
    if (shapedText) {
      addShapeWithOptionalText(slide, shapedText.shapeType, shapedText.options, element.text.content);
      queueDashPatch(dashPatches, slideIndex, objectName, shapedText.dashXml);
      return;
    }

    slide.addText(element.text.content, buildTextOptions(element, bounds, objectName));
    return;
  }

  if (element.type === "shape" && element.shape) {
    if (element.shape.kind === "custom" && element.shape.svgPath && element.shape.svgViewBox) {
      const dashAttr = element.shape.strokeDasharray
        ? ` stroke-dasharray="${element.shape.strokeDasharray}"`
        : "";
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${element.shape.svgViewBox.width}" height="${element.shape.svgViewBox.height}" viewBox="0 0 ${element.shape.svgViewBox.width} ${element.shape.svgViewBox.height}">
  <path d="${element.shape.svgPath}" fill="${element.shape.fill || "none"}" stroke="${element.shape.stroke || "none"}" stroke-width="${element.shape.strokeWidth || 1}"${dashAttr} />
</svg>`;
      slide.addImage({
        data: svgToDataUrl(svg),
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h,
        rotate: element.rotation ?? 0,
      });
      return;
    }

    const shapeType = getPrimitiveShapeType(pptx, element.shape);
    if (!shapeType) {
      return;
    }

    const { options, dashXml } = buildShapeOptions(
      element.shape,
      bounds,
      element.rotation,
      objectName
    );
    slide.addShape(shapeType, options);
    queueDashPatch(dashPatches, slideIndex, objectName, dashXml);
    return;
  }

  if (element.type === "image" && element.image) {
    const data = await imageUrlToData(element.image.url, assetUrlOptions);
    if (element.image.objectFit === "contain") {
      const buffer = Buffer.from(data.split(",")[1] || "", "base64");
      const dimensions = imageSize(buffer);
      if (dimensions.width && dimensions.height) {
        const sized = computeContainSizing(bounds, { width: dimensions.width, height: dimensions.height });
        slide.addImage({
          data,
          x: sized.x,
          y: sized.y,
          w: sized.w,
          h: sized.h,
          rotate: element.rotation ?? 0,
        });
        return;
      }
    }

    slide.addImage({
      data,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      rotate: element.rotation ?? 0,
    });
  }
}

function patchShapeDashXml(xml: string, patch: DashPatch): string {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (shapeXml) => {
    if (!shapeXml.includes(`name="${patch.objectName}"`)) {
      return shapeXml;
    }

    return shapeXml.replace(/(<a:ln\b[^>]*>)([\s\S]*?)(<\/a:ln>)/, (_match, open, body, close) => {
      return `${open}${replaceDashMarkup(body, patch.dashXml)}${close}`;
    });
  });
}

function replaceDashMarkup(lineBody: string, dashXml: string): string {
  const withoutDashMarkup = lineBody
    .replace(/<a:prstDash\b[^>]*\/>/g, "")
    .replace(/<a:custDash>[\s\S]*?<\/a:custDash>/g, "");

  const arrowheadMatch = withoutDashMarkup.match(/<a:(?:headEnd|tailEnd)\b/);
  if (!arrowheadMatch || arrowheadMatch.index === undefined) {
    return `${withoutDashMarkup}${dashXml}`;
  }

  return `${withoutDashMarkup.slice(0, arrowheadMatch.index)}${dashXml}${withoutDashMarkup.slice(arrowheadMatch.index)}`;
}

async function applyDashPatches(buffer: ArrayBuffer, dashPatches: DashPatch[]): Promise<Uint8Array> {
  if (dashPatches.length === 0) {
    return new Uint8Array(buffer);
  }

  const zip = await JSZip.loadAsync(buffer);
  const slidePatches = new Map<number, DashPatch[]>();

  for (const patch of dashPatches) {
    const existing = slidePatches.get(patch.slideIndex);
    if (existing) {
      existing.push(patch);
    } else {
      slidePatches.set(patch.slideIndex, [patch]);
    }
  }

  for (const [slideIndex, patches] of slidePatches) {
    const slideXmlPath = `ppt/slides/slide${slideIndex + 1}.xml`;
    const file = zip.file(slideXmlPath);
    if (!file) {
      continue;
    }

    let slideXml = await file.async("string");
    for (const patch of patches) {
      slideXml = patchShapeDashXml(slideXml, patch);
    }
    zip.file(slideXmlPath, slideXml);
  }

  return zip.generateAsync({ type: "uint8array" });
}

async function renderHtmlSlide(html: string, assetUrlOptions: ExportAssetUrlOptions): Promise<string> {
  const inlinedHtml = await inlineHtmlExportAssetUrls(html, assetUrlOptions);
  const buffer = await renderHtmlToPng(inlinedHtml, {
    width: SLIDE_PIXEL_SIZE.width,
    height: SLIDE_PIXEL_SIZE.height,
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function exportDeckToPptx(
  slides: Slide[],
  assetUrlOptionsOrBaseUrl: string | ExportAssetUrlOptions
): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const dashPatches: DashPatch[] = [];
  const assetUrlOptions: ExportAssetUrlOptions =
    typeof assetUrlOptionsOrBaseUrl === "string"
      ? {
          gatewayBaseUrl: assetUrlOptionsOrBaseUrl,
          requestBaseUrl: assetUrlOptionsOrBaseUrl,
          publicBaseUrl: process.env.PUBLIC_BASE_URL,
          s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
        }
      : {
          ...assetUrlOptionsOrBaseUrl,
          requestBaseUrl:
            assetUrlOptionsOrBaseUrl.requestBaseUrl ?? assetUrlOptionsOrBaseUrl.gatewayBaseUrl,
          publicBaseUrl: assetUrlOptionsOrBaseUrl.publicBaseUrl ?? process.env.PUBLIC_BASE_URL,
          s3PublicBaseUrl:
            assetUrlOptionsOrBaseUrl.s3PublicBaseUrl ?? process.env.S3_PUBLIC_BASE_URL,
        };

  for (const [slideIndex, slide] of slides.entries()) {
    const pptxSlide = pptx.addSlide();

    if (!slide.source) {
      const data = await renderHtmlSlide(slide.html || "", assetUrlOptions);
      await addBackgroundImage(pptxSlide, data);
      continue;
    }

    await addSlideBackground(pptxSlide, slide.source, assetUrlOptions);

    const sorted = [...slide.source.elements].sort((a, b) => a.zIndex - b.zIndex);
    for (const element of sorted) {
      await addEditableElement(
        pptx,
        pptxSlide,
        element as EditableElement,
        assetUrlOptions,
        slideIndex,
        dashPatches
      );
    }
  }

  const buffer = await pptx.write({ outputType: "arraybuffer" });
  return applyDashPatches(buffer as ArrayBuffer, dashPatches);
}
