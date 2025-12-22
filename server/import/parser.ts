// PPTX XML Parser

import { logInfo, logWarn } from "../logger";

import type {
  SlideSize,
  ExtractedSlide,
  ExtractedElement,
  ElementType,
  Bounds,
  TextData,
  TextRun,
  Paragraph,
  ImageData,
  ShapeData,
  Background,
  Theme,
  SlideRelationships,
  PlaceholderInfo,
} from "./types";
import { EMU_PER_POINT } from "./types";
import { resolveColor } from "./theme";

// Default slide size (10" x 7.5" in EMU)
const DEFAULT_SLIDE_SIZE: SlideSize = {
  width: 9144000,
  height: 6858000,
};

// Generate unique element IDs
let elementIdCounter = 0;
function generateElementId(type: string, slideIndex: number): string {
  return `${type}-${slideIndex}-${++elementIdCounter}`;
}

// Reset counter for each import session
export function resetElementIdCounter(): void {
  elementIdCounter = 0;
}

/**
 * Parse presentation.xml to get slide size and order
 */
export function parsePresentation(xml: string): { slideSize: SlideSize; slideOrder: string[] } {
  // Parse slide size: <p:sldSz cx="10080625" cy="5670550"/>
  const sizeMatch = xml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  const slideSize: SlideSize = sizeMatch
    ? { width: parseInt(sizeMatch[1]), height: parseInt(sizeMatch[2]) }
    : DEFAULT_SLIDE_SIZE;

  // Parse slide order: <p:sldId id="256" r:id="rId3"/>
  const slideOrder: string[] = [];
  const slideIdRegex = /<p:sldId[^>]*r:id="([^"]+)"/g;
  let match;
  while ((match = slideIdRegex.exec(xml)) !== null) {
    slideOrder.push(match[1]);
  }

  return { slideSize, slideOrder };
}

/**
 * Parse relationships file to map rId to target path
 */
export function parseRelationships(xml: string): SlideRelationships {
  const rels = new Map<string, string>();
  const relRegex = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let match;
  while ((match = relRegex.exec(xml)) !== null) {
    rels.set(match[1], match[2]);
  }
  return rels;
}

/**
 * Parse a single slide XML into ExtractedSlide
 */
export type ParseSlideOptions = {
  includeEmptyPlaceholders?: boolean;
};

export function parseSlide(
  xml: string,
  index: number,
  slideSize: SlideSize,
  theme: Theme,
  relationships: SlideRelationships,
  options: ParseSlideOptions = {}
): ExtractedSlide {
  const elements: ExtractedElement[] = [];
  let zIndex = 0;

  logInfo("Parsing slide", { index, xmlLength: xml.length, slideSize });

  // Parse background
  const background = parseBackground(xml, theme);
  logInfo("Parsed background", { index, background });

  // Parse shape tree: <p:spTree>...</p:spTree>
  const spTreeMatch = xml.match(/<p:spTree>([\s\S]*)<\/p:spTree>/);
  if (spTreeMatch) {
    const spTreeContent = spTreeMatch[1];
    logInfo("Found spTree", { index, contentLength: spTreeContent.length });
    parseShapeTree(
      spTreeContent,
      elements,
      zIndex,
      slideSize,
      theme,
      relationships,
      undefined,
      index,
      options
    );
  } else {
    logWarn("No spTree found in slide", { index });
  }

  logInfo("Slide parsing complete", {
    index,
    elementCount: elements.length,
    elementTypes: elements.map(e => e.type),
    elementSummary: elements.map(e => ({
      type: e.type,
      bounds: e.bounds,
      hasText: e.text ? e.text.paragraphs.length : 0,
      textPreview: e.text?.paragraphs[0]?.runs[0]?.text?.slice(0, 30),
    }))
  });

  return {
    index,
    elements,
    background,
  };
}

/**
 * Parse shape tree content recursively
 */
function parseShapeTree(
  xml: string,
  elements: ExtractedElement[],
  startZIndex: number,
  slideSize: SlideSize,
  theme: Theme,
  relationships: SlideRelationships,
  parentTransform?: { offX: number; offY: number; scaleX: number; scaleY: number },
  slideIndex?: number,
  options: ParseSlideOptions = {}
): number {
  let zIndex = startZIndex;

  // Count what we find for debugging
  let groupCount = 0;
  let shapeCount = 0;
  let picCount = 0;

  // Parse elements in document order to preserve z-order.
  const orderedElements = extractTopLevelElements(xml);
  for (const el of orderedElements) {
    if (el.tag === "p:grpSp") {
      groupCount++;
      zIndex = parseGroup(
        el.innerXml,
        elements,
        zIndex,
        slideSize,
        theme,
        relationships,
        parentTransform,
        slideIndex,
        options
      );
      continue;
    }

    if (el.tag === "p:sp") {
      shapeCount++;
      const element = parseShape(
        el.innerXml,
        zIndex++,
        slideSize,
        theme,
        relationships,
        parentTransform,
        slideIndex,
        options
      );
      if (element) {
        elements.push(element);
        logInfo("Parsed shape element", {
          slideIndex,
          type: element.type,
          bounds: element.bounds,
          textParas: element.text?.paragraphs.length,
          textPreview: element.text?.paragraphs[0]?.runs[0]?.text?.slice(0, 50),
        });
      } else {
        logInfo("Shape returned null", {
          slideIndex,
          shapeXmlPreview: el.innerXml.slice(0, 200),
        });
      }
      continue;
    }

    if (el.tag === "p:pic") {
      picCount++;
      const element = parsePicture(
        el.innerXml,
        zIndex++,
        slideSize,
        relationships,
        parentTransform,
        slideIndex,
        options
      );
      if (element) {
        elements.push(element);
        logInfo("Parsed picture element", {
          slideIndex,
          type: element.type,
          bounds: element.bounds,
        });
      }
    }
  }

  logInfo("parseShapeTree summary", {
    slideIndex,
    groupCount,
    shapeCount,
    picCount,
    totalElements: elements.length,
    hasParentTransform: !!parentTransform,
  });

  return zIndex;
}

type TopLevelPptElement = {
  tag: "p:grpSp" | "p:sp" | "p:pic";
  innerXml: string;
};

function extractTopLevelElements(xml: string): TopLevelPptElement[] {
  const result: TopLevelPptElement[] = [];
  const openTagRegex = /<p:(grpSp|sp|pic)(?=[\s>])/g;

  let cursor = 0;
  while (cursor < xml.length) {
    openTagRegex.lastIndex = cursor;
    const match = openTagRegex.exec(xml);
    if (!match) break;

    const localName = match[1] as "grpSp" | "sp" | "pic";
    const tag = `p:${localName}` as TopLevelPptElement["tag"];
    const openStart = match.index;

    const openEnd = xml.indexOf(">", openStart);
    if (openEnd === -1) break;

    const closeTag = `</${tag}>`;
    const endIndex = findMatchingCloseTagIndex(xml, tag, openEnd + 1);
    if (endIndex === null) {
      // If we can't find a matching close tag, stop parsing to avoid infinite loops.
      break;
    }

    const innerStart = openEnd + 1;
    const innerEnd = endIndex - closeTag.length;
    result.push({ tag, innerXml: xml.slice(innerStart, innerEnd) });

    cursor = endIndex;
  }

  return result;
}

function findMatchingCloseTagIndex(
  xml: string,
  tag: TopLevelPptElement["tag"],
  startSearchIndex: number
): number | null {
  const openRe = new RegExp(`<${tag}(?=[\\s>])`, "g");
  const closeTag = `</${tag}>`;

  let depth = 1;
  let cursor = startSearchIndex;

  while (depth > 0) {
    openRe.lastIndex = cursor;
    const nextOpen = openRe.exec(xml);
    const nextOpenIndex = nextOpen ? nextOpen.index : -1;
    const nextCloseIndex = xml.indexOf(closeTag, cursor);

    if (nextCloseIndex === -1) return null;

    if (nextOpenIndex !== -1 && nextOpenIndex < nextCloseIndex) {
      depth++;
      cursor = nextOpenIndex + 1;
      continue;
    }

    depth--;
    cursor = nextCloseIndex + closeTag.length;
  }

  return cursor;
}

/**
 * Parse a group element and flatten its children
 */
function parseGroup(
  xml: string,
  elements: ExtractedElement[],
  startZIndex: number,
  slideSize: SlideSize,
  theme: Theme,
  relationships: SlideRelationships,
  parentTransform?: { offX: number; offY: number; scaleX: number; scaleY: number },
  slideIndex?: number,
  options: ParseSlideOptions = {}
): number {
  // Parse group transform
  // <p:grpSpPr>
  //   <a:xfrm>
  //     <a:off x="4080600" y="619200"/>
  //     <a:ext cx="3798360" cy="491400"/>
  //     <a:chOff x="4080600" y="619200"/>
  //     <a:chExt cx="3798360" cy="491400"/>
  //   </a:xfrm>
  // </p:grpSpPr>

  const grpSpPrMatch = xml.match(/<p:grpSpPr>([\s\S]*?)<\/p:grpSpPr>/);
  if (!grpSpPrMatch) {
    return startZIndex;
  }

  const xfrmMatch = grpSpPrMatch[1].match(/<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/);
  if (!xfrmMatch) {
    return startZIndex;
  }

  const xfrmXml = xfrmMatch[1];

  // Group position/size
  const offMatch = xfrmXml.match(/<a:off x="(\d+)" y="(\d+)"/);
  const extMatch = xfrmXml.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
  // Child coordinate system
  const chOffMatch = xfrmXml.match(/<a:chOff x="(\d+)" y="(\d+)"/);
  const chExtMatch = xfrmXml.match(/<a:chExt cx="(\d+)" cy="(\d+)"/);

  if (!offMatch || !extMatch || !chOffMatch || !chExtMatch) {
    return startZIndex;
  }

  const groupOff = { x: parseInt(offMatch[1]), y: parseInt(offMatch[2]) };
  const groupExt = { cx: parseInt(extMatch[1]), cy: parseInt(extMatch[2]) };
  const childOff = { x: parseInt(chOffMatch[1]), y: parseInt(chOffMatch[2]) };
  const childExt = { cx: parseInt(chExtMatch[1]), cy: parseInt(chExtMatch[2]) };

  // Calculate transform to convert child coords to slide coords
  const scaleX = childExt.cx > 0 ? groupExt.cx / childExt.cx : 1;
  const scaleY = childExt.cy > 0 ? groupExt.cy / childExt.cy : 1;
  const offX = groupOff.x - childOff.x * scaleX;
  const offY = groupOff.y - childOff.y * scaleY;

  // Apply parent transform if exists
  let transform = { offX, offY, scaleX, scaleY };
  if (parentTransform) {
    transform = {
      offX: parentTransform.offX + offX * parentTransform.scaleX,
      offY: parentTransform.offY + offY * parentTransform.scaleY,
      scaleX: scaleX * parentTransform.scaleX,
      scaleY: scaleY * parentTransform.scaleY,
    };
  }

  // Parse children with transform applied
  logInfo("Parsing group children", { slideIndex, transform });
  return parseShapeTree(
    xml,
    elements,
    startZIndex,
    slideSize,
    theme,
    relationships,
    transform,
    slideIndex,
    options
  );
}

/**
 * Parse a shape element (p:sp)
 */
function parsePlaceholder(xml: string): PlaceholderInfo | undefined {
  const phMatch = xml.match(/<p:ph([^>]*)\/?>/);
  if (!phMatch) return undefined;

  const attrs = phMatch[1];
  const typeMatch = attrs.match(/type="([^"]+)"/);
  const idxMatch = attrs.match(/idx="([^"]+)"/);
  const nameMatch = xml.match(/<p:cNvPr[^>]*name="([^"]+)"/);

  const placeholder: PlaceholderInfo = {};
  if (typeMatch) placeholder.type = typeMatch[1];
  if (idxMatch) placeholder.idx = idxMatch[1];
  if (nameMatch) placeholder.name = nameMatch[1];

  if (!placeholder.type && !placeholder.idx && !placeholder.name) {
    return undefined;
  }

  return placeholder;
}

function parseShape(
  xml: string,
  zIndex: number,
  slideSize: SlideSize,
  theme: Theme,
  relationships: SlideRelationships,
  parentTransform?: { offX: number; offY: number; scaleX: number; scaleY: number },
  slideIndex?: number,
  options: ParseSlideOptions = {}
): ExtractedElement | null {
  // Parse shape properties
  const spPrMatch = xml.match(/<p:spPr>([\s\S]*?)<\/p:spPr>/);
  if (!spPrMatch) {
    logInfo("No spPr found in shape", { slideIndex, xmlPreview: xml.slice(0, 150) });
    return null;
  }

  const spPrXml = spPrMatch[1];

  // Parse transform
  const { bounds, rotation } = parseTransform(spPrXml, slideSize, parentTransform);
  if (!bounds) {
    logInfo("No bounds found in shape", { slideIndex, spPrXmlPreview: spPrXml.slice(0, 200) });
    return null;
  }

  logInfo("Shape bounds parsed", { slideIndex, bounds, rotation });
  const placeholder = parsePlaceholder(xml);

  // Check if this is an image (has blipFill)
  const blipFillMatch = spPrXml.match(/<a:blipFill[^>]*>([\s\S]*?)<\/a:blipFill>/);
  if (blipFillMatch) {
    const blipMatch = blipFillMatch[1].match(/<a:blip[^>]*r:embed="([^"]+)"/);
    if (blipMatch) {
      const rId = blipMatch[1];
      return {
        id: generateElementId("image", slideIndex ?? 0),
        type: "image",
        bounds,
        zIndex,
        rotation,
        placeholder,
        image: { rId },
      };
    }
  }

  // Parse shape type
  const shapeType = parseShapeType(spPrXml);
  const customGeometry = parseCustomGeometry(spPrXml);

  // Parse fill
  const fill = parseFill(spPrXml, theme);

  // Parse stroke
  let { stroke, strokeWidth, lineCap, lineHead, lineTail } = parseStroke(spPrXml, theme);
  const flipH = /<a:xfrm[^>]*flipH="1"/.test(spPrXml);
  const flipV = /<a:xfrm[^>]*flipV="1"/.test(spPrXml);
  if (shapeType === "line" && (flipH || flipV)) {
    const tmp = lineHead;
    lineHead = lineTail;
    lineTail = tmp;
  }

  // Parse text body
  const txBodyMatch = xml.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/);
  const textData = txBodyMatch ? parseTextBody(txBodyMatch[1], theme) : null;

  // Determine element type
  let type: ElementType = "shape";
  const hasText = textData && hasActualText(textData);
  if (hasText) {
    type = "text";
  } else if (shapeType === "line") {
    type = "line";
  }

  // Skip empty shapes with no fill/stroke (empty placeholders)
  const hasFill = fill && fill !== "none";
  const hasStroke = stroke && stroke !== "none";
  const isPlaceholder = !!(placeholder?.type || placeholder?.idx || placeholder?.name);
  if (type === "shape" && !hasFill && !hasStroke && !(options.includeEmptyPlaceholders && isPlaceholder)) {
    logInfo("Skipping empty placeholder shape", { slideIndex, shapeType, fill, stroke });
    return null;
  }

  const element: ExtractedElement = {
    id: generateElementId(type, slideIndex ?? 0),
    type,
    bounds,
    zIndex,
    rotation,
    placeholder,
  };

  // Always include text data if present
  if (hasText && textData) {
    element.text = textData;
  }

  // Always include shape data if there's a meaningful shape (fill, stroke, or non-rect type)
  const hasMeaningfulShape = hasFill || hasStroke || (shapeType !== "rect" && shapeType !== "custom");
  if (hasMeaningfulShape || type === "line") {
    element.shape = {
      shapeType,
      fill,
      stroke,
      strokeWidth,
      lineCap,
      lineHead,
      lineTail,
      svgPath: customGeometry?.path,
      svgViewBox: customGeometry?.viewBox,
    };
  }

  // Log when we have both text and shape (like colored circles with numbers)
  if (hasText && hasMeaningfulShape) {
    logInfo("Element has both text and shape", {
      slideIndex,
      shapeType,
      fill,
      textPreview: textData?.paragraphs[0]?.runs[0]?.text,
    });
  }

  return element;
}

function parseCustomGeometry(xml: string): { path: string; viewBox: { width: number; height: number } } | null {
  const custMatch = xml.match(/<a:custGeom>([\s\S]*?)<\/a:custGeom>/);
  if (!custMatch) return null;

  const pathRegex = /<a:path[^>]*w="(\d+)"[^>]*h="(\d+)"[^>]*>([\s\S]*?)<\/a:path>/g;
  let pathMatch;
  let viewBox: { width: number; height: number } | null = null;
  const dParts: string[] = [];

  while ((pathMatch = pathRegex.exec(custMatch[1])) !== null) {
    if (!viewBox) {
      viewBox = { width: parseInt(pathMatch[1], 10), height: parseInt(pathMatch[2], 10) };
    }
    const pathXml = pathMatch[3];
    const cmdRegex = /<a:(moveTo|lnTo|cubicBezTo)>([\s\S]*?)<\/a:\1>|<a:close\s*\/>/g;
    let cmdMatch;
    while ((cmdMatch = cmdRegex.exec(pathXml)) !== null) {
      if (!cmdMatch[1] && cmdMatch[0].startsWith("<a:close")) {
        dParts.push("Z");
        continue;
      }

      const cmd = cmdMatch[1];
      const content = cmdMatch[2] || "";
      const ptRegex = /<a:pt[^>]*x="(-?\d+)"[^>]*y="(-?\d+)"/g;
      const pts: Array<{ x: number; y: number }> = [];
      let ptMatch;
      while ((ptMatch = ptRegex.exec(content)) !== null) {
        pts.push({ x: parseInt(ptMatch[1], 10), y: parseInt(ptMatch[2], 10) });
      }

      if (cmd === "moveTo" && pts[0]) {
        dParts.push(`M ${pts[0].x} ${pts[0].y}`);
      } else if (cmd === "lnTo" && pts[0]) {
        dParts.push(`L ${pts[0].x} ${pts[0].y}`);
      } else if (cmd === "cubicBezTo" && pts.length >= 3) {
        dParts.push(`C ${pts[0].x} ${pts[0].y} ${pts[1].x} ${pts[1].y} ${pts[2].x} ${pts[2].y}`);
      }
    }
  }

  if (!viewBox || dParts.length === 0) return null;
  return { path: dParts.join(" "), viewBox };
}

/**
 * Parse a picture element (p:pic)
 */
function parsePicture(
  xml: string,
  zIndex: number,
  slideSize: SlideSize,
  relationships: SlideRelationships,
  parentTransform?: { offX: number; offY: number; scaleX: number; scaleY: number },
  slideIndex?: number,
  options: ParseSlideOptions = {}
): ExtractedElement | null {
  // Parse shape properties
  const spPrMatch = xml.match(/<p:spPr>([\s\S]*?)<\/p:spPr>/);
  if (!spPrMatch) {
    return null;
  }

  const { bounds, rotation } = parseTransform(spPrMatch[1], slideSize, parentTransform);
  if (!bounds) {
    return null;
  }

  // Parse blip fill
  const blipMatch = xml.match(/<a:blip[^>]*r:embed="([^"]+)"/);
  if (!blipMatch) {
    return null;
  }

  const placeholder = parsePlaceholder(xml);

  return {
    id: generateElementId("image", slideIndex ?? 0),
    type: "image",
    bounds,
    zIndex,
    rotation,
    placeholder,
    image: { rId: blipMatch[1] },
  };
}

/**
 * Parse transform (position, size, rotation) from spPr XML
 */
function parseTransform(
  xml: string,
  slideSize: SlideSize,
  parentTransform?: { offX: number; offY: number; scaleX: number; scaleY: number }
): { bounds: Bounds | null; rotation: number | undefined } {
  const xfrmMatch = xml.match(/<a:xfrm([^>]*)>([\s\S]*?)<\/a:xfrm>/);
  if (!xfrmMatch) {
    return { bounds: null, rotation: undefined };
  }

  const xfrmAttrs = xfrmMatch[1];
  const xfrmContent = xfrmMatch[2];

  // Parse rotation (in 60000ths of a degree)
  const rotMatch = xfrmAttrs.match(/rot="(-?\d+)"/);
  const rotation = rotMatch ? parseInt(rotMatch[1]) / 60000 : undefined;

  // Parse position and size
  const offMatch = xfrmContent.match(/<a:off x="(\d+)" y="(\d+)"/);
  const extMatch = xfrmContent.match(/<a:ext cx="(\d+)" cy="(\d+)"/);

  if (!offMatch || !extMatch) {
    return { bounds: null, rotation };
  }

  let x = parseInt(offMatch[1]);
  let y = parseInt(offMatch[2]);
  let width = parseInt(extMatch[1]);
  let height = parseInt(extMatch[2]);

  // Apply parent transform if exists
  if (parentTransform) {
    x = parentTransform.offX + x * parentTransform.scaleX;
    y = parentTransform.offY + y * parentTransform.scaleY;
    width = width * parentTransform.scaleX;
    height = height * parentTransform.scaleY;
  }

  // Convert EMU to percentage
  const bounds: Bounds = {
    x: (x / slideSize.width) * 100,
    y: (y / slideSize.height) * 100,
    width: (width / slideSize.width) * 100,
    height: (height / slideSize.height) * 100,
  };

  return { bounds, rotation };
}

/**
 * Parse shape type from spPr XML
 */
function parseShapeType(xml: string): string {
  // Preset geometry: <a:prstGeom prst="rect">
  const prstMatch = xml.match(/<a:prstGeom prst="([^"]+)"/);
  if (prstMatch) {
    return prstMatch[1];
  }

  // Custom geometry
  if (xml.includes("<a:custGeom>")) {
    return "custom";
  }

  return "rect";
}

/**
 * Parse fill from spPr XML
 */
function parseFill(xml: string, theme: Theme): string | undefined {
  // Solid fill: <a:solidFill><a:srgbClr val="RRGGBB"/></a:solidFill>
  const solidFillMatch = xml.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
  if (solidFillMatch) {
    const color = resolveColor(solidFillMatch[1], theme);
    if (color) {
      return color;
    }
  }

  // No fill
  if (xml.includes("<a:noFill/>") || xml.includes("<a:noFill />")) {
    return "none";
  }

  return undefined;
}

/**
 * Parse stroke from spPr XML
 */
function parseStroke(
  xml: string,
  theme: Theme
): {
  stroke?: string;
  strokeWidth?: number;
  lineCap?: ShapeData["lineCap"];
  lineHead?: ShapeData["lineHead"];
  lineTail?: ShapeData["lineTail"];
} {
  const lnMatch = xml.match(/<a:ln([^>]*)>([\s\S]*?)<\/a:ln>/);
  if (!lnMatch) {
    return {};
  }

  const lnAttrs = lnMatch[1];
  const lnContent = lnMatch[2];

  // Check for no fill (no stroke)
  if (lnContent.includes("<a:noFill/>") || lnContent.includes("<a:noFill />")) {
    return {};
  }

  // Parse width (in EMU)
  const widthMatch = lnAttrs.match(/w="(\d+)"/);
  const strokeWidth = widthMatch ? parseInt(widthMatch[1]) / EMU_PER_POINT : undefined;

  // Parse color
  const solidFillMatch = lnContent.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
  const stroke = solidFillMatch ? resolveColor(solidFillMatch[1], theme) || undefined : undefined;

  const capMatch = lnAttrs.match(/cap="([^"]+)"/);
  let lineCap: ShapeData["lineCap"];
  if (capMatch) {
    if (capMatch[1] === "rnd") lineCap = "round";
    if (capMatch[1] === "sq") lineCap = "square";
    if (capMatch[1] === "flat") lineCap = "flat";
  }

  const headMatch = lnContent.match(/<a:headEnd[^>]*type="([^"]+)"/);
  const tailMatch = lnContent.match(/<a:tailEnd[^>]*type="([^"]+)"/);
  const lineHead = headMatch?.[1] === "oval" ? "oval" : undefined;
  const lineTail = tailMatch?.[1] === "oval" ? "oval" : undefined;

  return { stroke, strokeWidth, lineCap, lineHead, lineTail };
}

/**
 * Parse text body
 */
function parseTextBody(xml: string, theme: Theme): TextData {
  const paragraphs: Paragraph[] = [];
  let verticalAlign: TextData["verticalAlign"];
  let insets: TextData["insets"];
  let anchorCtr: boolean | undefined;

  const bodyPrMatch = xml.match(/<a:bodyPr([^>]*)>/) || xml.match(/<a:bodyPr([^>]*)\/>/);
  if (bodyPrMatch) {
    const attrs = bodyPrMatch[1] || "";
    const lInsMatch = attrs.match(/lIns="(-?\d+)"/);
    const rInsMatch = attrs.match(/rIns="(-?\d+)"/);
    const tInsMatch = attrs.match(/tIns="(-?\d+)"/);
    const bInsMatch = attrs.match(/bIns="(-?\d+)"/);
    if (lInsMatch || rInsMatch || tInsMatch || bInsMatch) {
      insets = {};
      if (lInsMatch) insets.l = parseInt(lInsMatch[1], 10) / EMU_PER_POINT;
      if (rInsMatch) insets.r = parseInt(rInsMatch[1], 10) / EMU_PER_POINT;
      if (tInsMatch) insets.t = parseInt(tInsMatch[1], 10) / EMU_PER_POINT;
      if (bInsMatch) insets.b = parseInt(bInsMatch[1], 10) / EMU_PER_POINT;
    }
    const anchorMatch = attrs.match(/anchor="([^"]+)"/);
    if (anchorMatch) {
      const anchor = anchorMatch[1];
      if (anchor === "ctr") {
        verticalAlign = "middle";
      } else if (anchor === "b") {
        verticalAlign = "bottom";
      } else if (anchor === "t") {
        verticalAlign = "top";
      }
    }
    if (/\banchorCtr="1"\b/.test(attrs)) {
      anchorCtr = true;
    }
  }

  // Parse paragraphs: <a:p>...</a:p>
  const paraRegex = /<a:p>([\s\S]*?)<\/a:p>/g;
  let paraMatch;
  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const para = parseParagraph(paraMatch[1], theme);
    if (para) {
      paragraphs.push(para);
    }
  }

  return { paragraphs, verticalAlign, anchorCtr, insets };
}

/**
 * Parse a single paragraph
 */
function parseParagraph(xml: string, theme: Theme): Paragraph | null {
  const runs: TextRun[] = [];

  // Parse paragraph properties
  const pPrMatch = xml.match(/<a:pPr([^>]*)>([\s\S]*?)<\/a:pPr>/) || xml.match(/<a:pPr([^>]*)\/>/);
  let align: Paragraph["align"] = undefined;
  let level = 0;
  let bullet: Paragraph["bullet"];

  if (pPrMatch) {
    const attrs = pPrMatch[1] || "";
    const content = pPrMatch[2] || "";
    const alignMatch = attrs.match(/algn="([^"]+)"/);
    if (alignMatch) {
      const alignMap: Record<string, Paragraph["align"]> = {
        l: "left",
        ctr: "center",
        r: "right",
        just: "justify",
      };
      align = alignMap[alignMatch[1]] || "left";
    }

    const lvlMatch = attrs.match(/lvl="(\d+)"/);
    if (lvlMatch) {
      level = parseInt(lvlMatch[1]);
    }

    const buCharMatch = content.match(/<a:buChar[^>]*char="([^"]+)"/);
    if (buCharMatch && !content.includes("<a:buNone")) {
      bullet = { type: "bullet", char: buCharMatch[1] };
    }
  }

  // Parse text runs: <a:r>...</a:r>
  const runRegex = /<a:r>([\s\S]*?)<\/a:r>/g;
  let runMatch;
  while ((runMatch = runRegex.exec(xml)) !== null) {
    const run = parseTextRun(runMatch[1], theme);
    if (run) {
      runs.push(run);
    }
  }

  // Skip empty paragraphs
  if (runs.length === 0) {
    return null;
  }

  return {
    runs,
    align,
    level,
    bullet,
  };
}

/**
 * Parse a text run
 */
function parseTextRun(xml: string, theme: Theme): TextRun | null {
  // Parse text content
  const textMatch = xml.match(/<a:t>([\s\S]*?)<\/a:t>/);
  if (!textMatch) {
    return null;
  }

  const text = decodeXmlEntities(textMatch[1]);
  if (!text) {
    return null;
  }

  // Parse run properties
  const rPrMatch = xml.match(/<a:rPr([^>]*)>([\s\S]*?)<\/a:rPr>/) || xml.match(/<a:rPr([^>]*)\/>/);

  let fontSize: number | undefined;
  let fontFamily: string | undefined;
  let bold = false;
  let italic = false;
  let underline = false;
  let color: string | undefined;

  if (rPrMatch) {
    const attrs = rPrMatch[1] || "";
    const content = rPrMatch[2] || "";

    // Font size (in 100ths of a point)
    const szMatch = attrs.match(/sz="(\d+)"/);
    if (szMatch) {
      fontSize = parseInt(szMatch[1]) / 100;
    }

    // Bold / italic
    bold = parseBoolAttr(attrs, "b");
    italic = parseBoolAttr(attrs, "i");

    // Underline
    underline = /u="sng"/.test(attrs) || /u="dbl"/.test(attrs);

    // Font family
    const latinMatch = content.match(/<a:latin typeface="([^"]+)"/);
    if (latinMatch) {
      fontFamily = latinMatch[1];
    }

    // Color
    const solidFillMatch = content.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
    if (solidFillMatch) {
      color = resolveColor(solidFillMatch[1], theme) || undefined;
    }
  }

  return {
    text,
    fontSize,
    fontFamily,
    bold,
    italic,
    underline,
    color,
  };
}

function parseBoolAttr(attrs: string, name: string): boolean {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]+)"`));
  if (!match) return false;
  const value = match[1].toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

/**
 * Parse background from slide XML
 */
function parseBackground(xml: string, theme: Theme): Background {
  // Check for cSld bg property
  const bgMatch = xml.match(/<p:bg>([\s\S]*?)<\/p:bg>/);
  if (!bgMatch) {
    return { type: "none" };
  }

  const bgXml = bgMatch[1];

  // Solid fill
  const solidFillMatch = bgXml.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
  if (solidFillMatch) {
    const color = resolveColor(solidFillMatch[1], theme);
    if (color) {
      return { type: "solid", color };
    }
  }

  // Gradient fill
  const gradFillMatch = bgXml.match(/<a:gradFill[^>]*>([\s\S]*?)<\/a:gradFill>/);
  if (gradFillMatch) {
    const gradXml = gradFillMatch[1];
    const stops: Array<{ position: number; color: string }> = [];

    const gsRegex = /<a:gs[^>]*pos="(\d+)"[^>]*>([\s\S]*?)<\/a:gs>/g;
    let gsMatch;
    while ((gsMatch = gsRegex.exec(gradXml)) !== null) {
      const pos = parseInt(gsMatch[1], 10);
      const color = resolveColor(gsMatch[2], theme);
      if (!color) continue;
      stops.push({ position: Math.max(0, Math.min(100, pos / 1000)), color });
    }

    if (stops.length >= 2) {
      const linMatch = gradXml.match(/<a:lin[^>]*ang="(-?\d+)"/);
      const angle = linMatch ? parseInt(linMatch[1], 10) / 60000 : 0;
      return { type: "gradient", gradient: { angle, stops } };
    }
  }

  // Image fill
  const blipFillMatch = bgXml.match(/<a:blipFill[^>]*>([\s\S]*?)<\/a:blipFill>/);
  if (blipFillMatch) {
    const blipMatch = blipFillMatch[1].match(/<a:blip[^>]*r:embed="([^"]+)"/);
    if (blipMatch) {
      return { type: "image", rId: blipMatch[1] };
    }
  }

  return { type: "none" };
}

/**
 * Check if text data has actual text content
 */
function hasActualText(textData: TextData): boolean {
  for (const para of textData.paragraphs) {
    for (const run of para.runs) {
      if (run.text.trim()) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Decode XML entities
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
