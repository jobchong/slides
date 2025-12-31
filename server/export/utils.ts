import type { Bounds } from "../import/types";

export const WIDE_SLIDE_INCHES = { width: 13.333, height: 7.5 };

export function boundsToInches(bounds: Bounds): { x: number; y: number; w: number; h: number } {
  return {
    x: (bounds.x / 100) * WIDE_SLIDE_INCHES.width,
    y: (bounds.y / 100) * WIDE_SLIDE_INCHES.height,
    w: (bounds.width / 100) * WIDE_SLIDE_INCHES.width,
    h: (bounds.height / 100) * WIDE_SLIDE_INCHES.height,
  };
}

export function fontSizePxToPt(px: number): number {
  const points = (px * 72) / 96;
  return Math.round(points * 100) / 100;
}

export function normalizeColor(color?: string): string | undefined {
  if (!color) return undefined;
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) {
    return trimmed.slice(1).toUpperCase();
  }
  return trimmed.toUpperCase();
}
