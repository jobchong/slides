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

const PARALLELOGRAM_DEFAULTS = {
  adj: 25000,
};

const TRAPEZOID_DEFAULTS = {
  adj: 25000,
};

const CHEVRON_DEFAULTS = {
  adj: 50000,
};

const HOME_PLATE_DEFAULTS = {
  adj: 25000,
};

const HEXAGON_DEFAULTS = {
  adj: 25000,
  vf: 115470,
};

const OCTAGON_INSET_RATIO = 0.292893;

const PENTAGON_RATIOS = {
  shoulderY: 0.381966,
  baseInset: 0.190983,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function transformPoint(
  point: Point,
  size: GeometrySize,
  options: PresetShapeGeometryOptions
): Point {
  return {
    x: options.flipH ? size.width - point.x : point.x,
    y: options.flipV ? size.height - point.y : point.y,
  };
}

function buildPolygonGeometry(
  size: GeometrySize,
  points: Point[],
  options: PresetShapeGeometryOptions = {}
): PresetShapeGeometry {
  const svgPath = points
    .map((point, index) => {
      const transformed = transformPoint(point, size, options);
      return `${index === 0 ? "M" : "L"} ${roundCoordinate(transformed.x)} ${roundCoordinate(
        transformed.y
      )}`;
    })
    .join(" ");

  return {
    svgPath: `${svgPath} Z`,
    svgViewBox: { width: size.width, height: size.height },
  };
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
    case "diamond":
      return buildDiamondGeometry(size, options);
    case "triangle":
    case "upTriangle":
      return buildTriangleGeometry(size, options);
    case "downTriangle":
      return buildDownTriangleGeometry(size, options);
    case "leftTriangle":
      return buildLeftTriangleGeometry(size, options);
    case "rightTriangle":
      return buildPointRightTriangleGeometry(size, options);
    case "rtTriangle":
      return buildRightAngleTriangleGeometry(size, options);
    case "parallelogram":
      return buildParallelogramGeometry(size, adjustments, options);
    case "trapezoid":
      return buildTrapezoidGeometry(size, adjustments, options);
    case "homePlate":
      return buildHomePlateGeometry(size, adjustments, options);
    case "octagon":
      return buildOctagonGeometry(size, options);
    case "pentagon":
      return buildPentagonGeometry(size, options);
    case "chevron":
      return buildChevronGeometry(size, adjustments, options);
    case "hexagon":
      return buildHexagonGeometry(size, adjustments, options);
    case "line":
      return buildLineGeometry(options);
    default:
      return null;
  }
}

function buildDiamondGeometry(
  size: GeometrySize,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  return buildPolygonGeometry(
    size,
    [
      { x: width / 2, y: 0 },
      { x: width, y: height / 2 },
      { x: width / 2, y: height },
      { x: 0, y: height / 2 },
    ],
    options
  );
}

function buildTriangleGeometry(
  size: GeometrySize,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  return buildPolygonGeometry(
    size,
    [
      { x: width / 2, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    options
  );
}

function buildRightAngleTriangleGeometry(
  size: GeometrySize,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  return buildPolygonGeometry(
    size,
    [
      { x: 0, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    options
  );
}

function buildDownTriangleGeometry(
  size: GeometrySize,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  return buildPolygonGeometry(
    size,
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width / 2, y: height },
    ],
    options
  );
}

function buildLeftTriangleGeometry(
  size: GeometrySize,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  return buildPolygonGeometry(
    size,
    [
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height / 2 },
    ],
    options
  );
}

function buildPointRightTriangleGeometry(
  size: GeometrySize,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  return buildPolygonGeometry(
    size,
    [
      { x: 0, y: 0 },
      { x: width, y: height / 2 },
      { x: 0, y: height },
    ],
    options
  );
}

function buildParallelogramGeometry(
  size: GeometrySize,
  adjustments: ShapeAdjustments,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  const adj = clamp(adjustments.adj ?? PARALLELOGRAM_DEFAULTS.adj, 0, 50000);
  const offset = (width * adj) / 100000;

  return buildPolygonGeometry(
    size,
    [
      { x: offset, y: 0 },
      { x: width, y: 0 },
      { x: width - offset, y: height },
      { x: 0, y: height },
    ],
    options
  );
}

function buildTrapezoidGeometry(
  size: GeometrySize,
  adjustments: ShapeAdjustments,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  const adj = clamp(adjustments.adj ?? TRAPEZOID_DEFAULTS.adj, 0, 50000);
  const inset = (width * adj) / 100000;

  return buildPolygonGeometry(
    size,
    [
      { x: inset, y: 0 },
      { x: width - inset, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    options
  );
}

function buildHomePlateGeometry(
  size: GeometrySize,
  adjustments: ShapeAdjustments,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  const adj = clamp(adjustments.adj ?? HOME_PLATE_DEFAULTS.adj, 0, 50000);
  const bodyX = width - (width * adj) / 100000;

  return buildPolygonGeometry(
    size,
    [
      { x: 0, y: 0 },
      { x: bodyX, y: 0 },
      { x: width, y: height / 2 },
      { x: bodyX, y: height },
      { x: 0, y: height },
    ],
    options
  );
}

function buildOctagonGeometry(
  size: GeometrySize,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  const insetX = width * OCTAGON_INSET_RATIO;
  const insetY = height * OCTAGON_INSET_RATIO;

  return buildPolygonGeometry(
    size,
    [
      { x: insetX, y: 0 },
      { x: width - insetX, y: 0 },
      { x: width, y: insetY },
      { x: width, y: height - insetY },
      { x: width - insetX, y: height },
      { x: insetX, y: height },
      { x: 0, y: height - insetY },
      { x: 0, y: insetY },
    ],
    options
  );
}

function buildPentagonGeometry(
  size: GeometrySize,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  const shoulderY = height * PENTAGON_RATIOS.shoulderY;
  const baseInset = width * PENTAGON_RATIOS.baseInset;

  return buildPolygonGeometry(
    size,
    [
      { x: width / 2, y: 0 },
      { x: width, y: shoulderY },
      { x: width - baseInset, y: height },
      { x: baseInset, y: height },
      { x: 0, y: shoulderY },
    ],
    options
  );
}

function buildChevronGeometry(
  size: GeometrySize,
  adjustments: ShapeAdjustments,
  options: PresetShapeGeometryOptions
): PresetShapeGeometry {
  const { width, height } = size;
  const adj = clamp(adjustments.adj ?? CHEVRON_DEFAULTS.adj, 0, 100000);
  const inset = (width * adj) / 200000;
  const bodyX = width - inset;

  return buildPolygonGeometry(
    size,
    [
      { x: 0, y: 0 },
      { x: bodyX, y: 0 },
      { x: width, y: height / 2 },
      { x: bodyX, y: height },
      { x: 0, y: height },
      { x: inset, y: height / 2 },
    ],
    options
  );
}

function buildHexagonGeometry(
  size: GeometrySize,
  adjustments: ShapeAdjustments,
  options: PresetShapeGeometryOptions
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

  return buildPolygonGeometry(
    size,
    [
      { x: 0, y: roundCoordinate(vc) },
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: w, y: roundCoordinate(vc) },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ],
    options
  );
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
