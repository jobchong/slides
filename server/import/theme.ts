// Theme parsing and color resolution

import type { Theme, ThemeColors, ThemeFonts } from "./types";

const DEFAULT_COLORS: ThemeColors = {
  dk1: "#000000",
  lt1: "#ffffff",
  dk2: "#44546a",
  lt2: "#e7e6e6",
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#a5a5a5",
  accent4: "#ffc000",
  accent5: "#5b9bd5",
  accent6: "#70ad47",
  hlink: "#0563c1",
  folHlink: "#954f72",
};

const DEFAULT_FONTS: ThemeFonts = {
  majorLatin: "Arial",
  minorLatin: "Arial",
};

/**
 * Parse theme XML and extract colors and fonts
 */
export function parseTheme(themeXml: string): Theme {
  const colors = { ...DEFAULT_COLORS };
  const fonts = { ...DEFAULT_FONTS };

  // Parse color scheme
  // <a:clrScheme name="...">
  //   <a:dk1><a:srgbClr val="000000"/></a:dk1>
  //   ...
  // </a:clrScheme>

  const colorNames = [
    "dk1", "lt1", "dk2", "lt2",
    "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
    "hlink", "folHlink",
  ];

  for (const name of colorNames) {
    const regex = new RegExp(`<a:${name}>([\\s\\S]*?)<\\/a:${name}>`, "i");
    const match = themeXml.match(regex);
    if (match) {
      const color = extractColorFromXml(match[1]);
      if (color) {
        colors[name] = color;
      }
    }
  }

  // Parse font scheme
  // <a:fontScheme name="...">
  //   <a:majorFont><a:latin typeface="Arial"/></a:majorFont>
  //   <a:minorFont><a:latin typeface="Arial"/></a:minorFont>
  // </a:fontScheme>

  const majorFontMatch = themeXml.match(/<a:majorFont>[\s\S]*?<a:latin typeface="([^"]+)"/);
  if (majorFontMatch) {
    fonts.majorLatin = majorFontMatch[1];
  }

  const minorFontMatch = themeXml.match(/<a:minorFont>[\s\S]*?<a:latin typeface="([^"]+)"/);
  if (minorFontMatch) {
    fonts.minorLatin = minorFontMatch[1];
  }

  return { colors, fonts };
}

/**
 * Extract color value from XML fragment
 */
function extractColorFromXml(xml: string): string | null {
  // Direct sRGB color: <a:srgbClr val="RRGGBB"/>
  const srgbMatch = xml.match(/<a:srgbClr val="([0-9a-fA-F]{6})"/);
  if (srgbMatch) {
    return "#" + srgbMatch[1].toLowerCase();
  }

  // System color: <a:sysClr val="windowText" lastClr="000000"/>
  const sysMatch = xml.match(/<a:sysClr[^>]*lastClr="([0-9a-fA-F]{6})"/);
  if (sysMatch) {
    return "#" + sysMatch[1].toLowerCase();
  }

  return null;
}

/**
 * Resolve a color reference from element XML
 */
export function resolveColor(colorXml: string, theme: Theme): string | null {
  // Direct sRGB color: <a:srgbClr val="RRGGBB"/>
  const srgbMatch = colorXml.match(/<a:srgbClr val="([0-9a-fA-F]{6})"/);
  if (srgbMatch) {
    let color = "#" + srgbMatch[1].toLowerCase();
    // Apply modifiers if present
    color = applyColorModifiers(color, colorXml);
    return color;
  }

  // Theme scheme color: <a:schemeClr val="accent1"/>
  const schemeMatch = colorXml.match(/<a:schemeClr val="([^"]+)"/);
  if (schemeMatch) {
    const schemeName = schemeMatch[1];
    let color = theme.colors[schemeName] || "#000000";
    // Apply modifiers if present
    color = applyColorModifiers(color, colorXml);
    return color;
  }

  return null;
}

/**
 * Apply luminance and other modifiers to a color
 */
function applyColorModifiers(color: string, xml: string): string {
  // Parse modifiers
  const lumModMatch = xml.match(/<a:lumMod val="(\d+)"/);
  const lumOffMatch = xml.match(/<a:lumOff val="(-?\d+)"/);
  const tintMatch = xml.match(/<a:tint val="(\d+)"/);
  const shadeMatch = xml.match(/<a:shade val="(\d+)"/);
  const alphaMatch = xml.match(/<a:alpha val="(\d+)"/);
  const alpha = alphaMatch ? Math.max(0, Math.min(1, parseInt(alphaMatch[1], 10) / 100000)) : null;

  if (!lumModMatch && !lumOffMatch && !tintMatch && !shadeMatch && alpha === null) {
    return color;
  }

  // Convert hex to RGB
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  // Convert to HSL for easier manipulation
  let [h, s, l] = rgbToHsl(r, g, b);

  // Apply luminance modifier (percentage, e.g., 75000 = 75%)
  if (lumModMatch) {
    const lumMod = parseInt(lumModMatch[1]) / 100000;
    l = l * lumMod;
  }

  // Apply luminance offset (percentage points)
  if (lumOffMatch) {
    const lumOff = parseInt(lumOffMatch[1]) / 100000;
    l = l + lumOff;
  }

  // Apply tint (blend toward white)
  if (tintMatch) {
    const tint = parseInt(tintMatch[1]) / 100000;
    l = l + (1 - l) * (1 - tint);
  }

  // Apply shade (blend toward black)
  if (shadeMatch) {
    const shade = parseInt(shadeMatch[1]) / 100000;
    l = l * shade;
  }

  // Clamp luminance
  l = Math.max(0, Math.min(1, l));

  // Convert back to RGB
  const [newR, newG, newB] = hslToRgb(h, s, l);
  if (alpha !== null && alpha < 1) {
    return `rgba(${newR}, ${newG}, ${newB}, ${Number(alpha.toFixed(3))})`;
  }

  return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
}

/**
 * Convert RGB to HSL
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return [h, s, l];
}

/**
 * Convert HSL to RGB
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Get default theme (for files without theme.xml)
 */
export function getDefaultTheme(): Theme {
  return {
    colors: { ...DEFAULT_COLORS },
    fonts: { ...DEFAULT_FONTS },
  };
}
