type GeometrySize = {
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type ShapeAdjustments = Record<string, number>;

export type PresetShapeGeometry = {
  svgPath?: string;
  svgViewBox?: { width: number; height: number };
  lineStart?: Point;
  lineEnd?: Point;
};

type PresetShapeGeometryOptions = {
  flipH?: boolean;
  flipV?: boolean;
};

const HEXAGON_DEFAULTS = {
  adj: 25000,
  vf: 115470,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parsePresetAdjustments(xml: string): ShapeAdjustments {
  const adjustments: ShapeAdjustments = {};
  const prstGeomMatch = xml.match(/<a:prstGeom[^>]*>([\s\S]*?)<\/a:prstGeom>/);
  if (!prstGeomMatch) return adjustments;

  const gdRegex = /<a:gd[^>]*(?:name|na)="([^"]+)"[^>]*fmla="val (-?\d+)"/g;
  let match;
  while ((match = gdRegex.exec(prstGeomMatch[1])) !== null) {
    adjustments[match[1]] = parseInt(match[2], 10);
  }

  return adjustments;
}

export function buildPresetShapeGeometry(
  shapeType: string,
  size: GeometrySize,
  adjustments: ShapeAdjustments,
  options: PresetShapeGeometryOptions = {}
): PresetShapeGeometry | null {
  if (size.width <= 0 || size.height <= 0) return null;

  switch (shapeType) {
    case "hexagon":
      return buildHexagonGeometry(size, adjustments);
    case "line":
      return buildLineGeometry(options);
    default:
      return null;
  }
}

function buildHexagonGeometry(
  size: GeometrySize,
  adjustments: ShapeAdjustments
): PresetShapeGeometry {
  // ECMA-376 presetShapeDefinitions.xml <hexagon>.
  const w = size.width;
  const h = size.height;
  const ss = Math.min(w, h);
  const vc = h / 2;

  const maxAdj = ss === 0 ? 0 : (50000 * w) / ss;
  const a = clamp(adjustments.adj ?? HEXAGON_DEFAULTS.adj, 0, maxAdj);
  const vf = adjustments.vf ?? HEXAGON_DEFAULTS.vf;
  const shd2 = (h / 2) * vf / 100000;
  const dy1 = shd2 * Math.sin(Math.PI / 3);

  const x1 = roundCoordinate((ss * a) / 100000);
  const x2 = roundCoordinate(w - x1);
  const y1 = roundCoordinate(clamp(vc - dy1, 0, h));
  const y2 = roundCoordinate(clamp(vc + dy1, 0, h));

  return {
    svgPath: `M 0 ${roundCoordinate(vc)} L ${x1} ${y1} L ${x2} ${y1} L ${w} ${roundCoordinate(
      vc
    )} L ${x2} ${y2} L ${x1} ${y2} Z`,
    svgViewBox: { width: w, height: h },
  };
}

function buildLineGeometry(options: PresetShapeGeometryOptions): PresetShapeGeometry {
  const lineStart = {
    x: options.flipH ? 100 : 0,
    y: options.flipV ? 100 : 0,
  };
  const lineEnd = {
    x: options.flipH ? 0 : 100,
    y: options.flipV ? 0 : 100,
  };

  return {
    lineStart,
    lineEnd,
  };
}
