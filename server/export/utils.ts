import type { Bounds } from "../import/types";

type NormalizedColorInfo = {
  color?: string;
  transparency?: number;
};

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

function clampTransparency(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b]
    .map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function normalizeColorInfo(color?: string): NormalizedColorInfo {
  if (!color) return {};

  const trimmed = color.trim();
  const rgbaMatch = trimmed.match(/^rgba?\((.+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(",").map(part => part.trim());
    if (parts.length === 3 || parts.length === 4) {
      const rgb = parts.slice(0, 3).map(value => Number(value));
      if (rgb.every(value => Number.isFinite(value))) {
        const alphaRaw = parts[3];
        const alpha = alphaRaw === undefined
          ? 1
          : alphaRaw.endsWith("%")
            ? Number(alphaRaw.slice(0, -1)) / 100
            : Number(alphaRaw);
        const transparency = Number.isFinite(alpha) ? clampTransparency((1 - alpha) * 100) : undefined;
        return {
          color: rgbToHex(rgb[0], rgb[1], rgb[2]),
          transparency,
        };
      }
    }
  }

  const hex8Match = trimmed.match(/^#?([0-9a-fA-F]{8})$/);
  if (hex8Match) {
    const hex = hex8Match[1].toUpperCase();
    const alpha = parseInt(hex.slice(6, 8), 16) / 255;
    return {
      color: hex.slice(0, 6),
      transparency: clampTransparency((1 - alpha) * 100),
    };
  }

  if (trimmed.startsWith("#")) {
    return { color: trimmed.slice(1).toUpperCase() };
  }

  return { color: trimmed.toUpperCase() };
}

export function normalizeColor(color?: string): string | undefined {
  return normalizeColorInfo(color).color;
}
