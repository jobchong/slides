const POINTS_TO_PX = 96 / 72;

export const PRESET_DASH_RATIOS = {
  dot: [1, 1],
  dash: [3, 1],
  lgDash: [8, 3],
  dashDot: [3, 1, 1, 1],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDot: [1, 1],
  sysDash: [3, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
} as const;

export type PptxDashType = keyof typeof PRESET_DASH_RATIOS;

export function buildPresetDashPattern(name: string, strokeWidthPx: number): string | undefined {
  const pattern = PRESET_DASH_RATIOS[name as PptxDashType];
  if (!pattern) {
    return undefined;
  }

  return formatDashPattern(pattern.map((value) => value * strokeWidthPx));
}

export function parsePositivePercentage(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    return parseFloat(trimmed) / 100;
  }
  return parseFloat(trimmed) / 100000;
}

export function formatDashPattern(values: number[]): string | undefined {
  const finiteValues = values.filter((value) => Number.isFinite(value) && value > 0);
  if (finiteValues.length === 0) {
    return undefined;
  }

  return finiteValues
    .map((value) => {
      const rounded = Math.round(value * 100) / 100;
      return Number.isInteger(rounded) ? String(rounded) : String(rounded);
    })
    .join(" ");
}

export function matchDashPatternPreset(
  strokeDasharray: string,
  strokeWidthPt: number | undefined
): PptxDashType | undefined {
  const actualValues = parseDashPattern(strokeDasharray);
  if (actualValues.length === 0) {
    return undefined;
  }

  const strokeWidthPx = Math.max((strokeWidthPt || 1) * POINTS_TO_PX, 0.01);
  for (const [name, ratios] of Object.entries(PRESET_DASH_RATIOS) as Array<
    [PptxDashType, readonly number[]]
  >) {
    const expectedValues = ratios.map((value) => value * strokeWidthPx);
    if (dashPatternsMatch(actualValues, expectedValues)) {
      return name;
    }
  }

  return undefined;
}

export function buildCustomDashXml(
  strokeDasharray: string,
  strokeWidthPt: number | undefined
): string | undefined {
  const values = normalizeDashPairs(parseDashPattern(strokeDasharray));
  if (values.length === 0) {
    return undefined;
  }

  const strokeWidthPx = Math.max((strokeWidthPt || 1) * POINTS_TO_PX, 0.01);
  const dashStops: string[] = [];

  for (let index = 0; index < values.length; index += 2) {
    const dashLength = Math.max(1, Math.round((values[index] / strokeWidthPx) * 100000));
    const gapLength = Math.max(1, Math.round((values[index + 1] / strokeWidthPx) * 100000));
    dashStops.push(`<a:ds d="${dashLength}" sp="${gapLength}"/>`);
  }

  return dashStops.length > 0 ? `<a:custDash>${dashStops.join("")}</a:custDash>` : undefined;
}

function parseDashPattern(strokeDasharray: string): number[] {
  return strokeDasharray
    .split(/[\s,]+/)
    .map((value) => parseFloat(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function normalizeDashPairs(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  if (values.length % 2 === 0) {
    return values;
  }

  return [...values, ...values];
}

function dashPatternsMatch(actualValues: number[], expectedValues: number[]): boolean {
  if (actualValues.length !== expectedValues.length) {
    return false;
  }

  return actualValues.every((value, index) => {
    const expected = expectedValues[index];
    const tolerance = Math.max(0.2, expected * 0.15);
    return Math.abs(value - expected) <= tolerance;
  });
}
