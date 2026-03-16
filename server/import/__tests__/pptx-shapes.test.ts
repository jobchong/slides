import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import { describe, expect, test } from "bun:test";

import { parsePresentation, parseRelationships, parseSlide, resetElementIdCounter } from "../parser";
import { parseTheme, getDefaultTheme } from "../theme";
import { convertBackground, convertToEditable } from "../converter";
import { renderSlideHtml } from "../render";
import type { ExtractedSlide, SlideSource, Theme } from "../types";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pptxDir = join(repoRoot, "ppts");

async function readZipEntry(pptxPath: string, entryPath: string): Promise<string> {
  const proc = spawn("unzip", ["-p", pptxPath, entryPath]);
  let stdout = "";
  let stderr = "";

  proc.stdout.on("data", (data) => {
    stdout += data.toString();
  });
  proc.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  await new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`unzip failed for ${entryPath}: ${stderr}`));
        return;
      }
      resolve();
    });
    proc.on("error", (err) => reject(err));
  });

  return stdout;
}

async function readZipEntryOptional(pptxPath: string, entryPath: string): Promise<string | null> {
  try {
    return await readZipEntry(pptxPath, entryPath);
  } catch {
    return null;
  }
}

async function loadSlide(
  pptxPath: string,
  slideIndex: number
): Promise<{ extractedSlide: ExtractedSlide; theme: Theme; slideRels: Map<string, string> }> {
  resetElementIdCounter();

  const presentationXml = await readZipEntry(pptxPath, "ppt/presentation.xml");
  const { slideSize, slideOrder } = parsePresentation(presentationXml);

  const themeXml = await readZipEntryOptional(pptxPath, "ppt/theme/theme1.xml");
  const theme = themeXml ? parseTheme(themeXml) : getDefaultTheme();

  const presRelsXml = await readZipEntry(pptxPath, "ppt/_rels/presentation.xml.rels");
  const presRels = parseRelationships(presRelsXml);
  const slideRId = slideOrder[slideIndex];
  const slidePath = presRels.get(slideRId);
  if (!slidePath) {
    throw new Error(`Slide ${slideIndex + 1}: missing relationship for ${slideRId}`);
  }

  const slideFilePath = slidePath.startsWith("/") ? slidePath.slice(1) : `ppt/${slidePath}`;
  const slideXml = await readZipEntry(pptxPath, slideFilePath);
  const slideRelsPath = slideFilePath.replace(
    /slides\/slide(\d+)\.xml$/,
    "slides/_rels/slide$1.xml.rels"
  );
  const slideRelsXml = await readZipEntryOptional(pptxPath, slideRelsPath);
  const slideRels = slideRelsXml ? parseRelationships(slideRelsXml) : new Map();

  return {
    extractedSlide: parseSlide(slideXml, slideIndex, slideSize, theme, slideRels),
    theme,
    slideRels,
  };
}

function buildSlideSource(
  extractedSlide: ExtractedSlide,
  theme: Theme,
  slideRels: Map<string, string>
): SlideSource {
  const resolveImageUrl = (rId?: string): string | undefined => {
    if (!rId) return undefined;
    const target = slideRels.get(rId);
    if (!target) return undefined;
    return `assets/${basename(target)}`;
  };

  return {
    background: convertBackground(extractedSlide.background),
    elements: extractedSlide.elements
      .map((el) => convertToEditable(el, theme, resolveImageUrl))
      .filter((el): el is NonNullable<typeof el> => el !== null),
    import: { slideIndex: extractedSlide.index },
  };
}

describe("PPTX preset shape import", () => {
  test("preserves hexagon presets as SVG-backed custom shapes", async () => {
    const pptxPath = join(pptxDir, "fullTemplate1.pptx");
    const { extractedSlide, theme, slideRels } = await loadSlide(pptxPath, 10);

    const hexagonElements = extractedSlide.elements.filter((el) => el.shape?.shapeType === "hexagon");
    expect(hexagonElements.length).toBeGreaterThan(0);

    for (const element of hexagonElements) {
      expect(typeof element.shape?.svgPath).toBe("string");
      expect(element.shape?.svgPath).toContain("L");
      expect(element.shape?.svgViewBox).toBeDefined();
    }

    const rendered = renderSlideHtml(buildSlideSource(extractedSlide, theme, slideRels));
    expect(rendered).toContain("<path d=\"M 0 ");
  });

  test("preserves preset line direction when xfrm flips are present", async () => {
    const pptxPath = join(pptxDir, "fullTemplate1.pptx");
    const { extractedSlide, theme, slideRels } = await loadSlide(pptxPath, 1);
    const source = buildSlideSource(extractedSlide, theme, slideRels);

    const flippedLine = source.elements.find(
      (el) =>
        el.type === "shape" &&
        el.shape?.kind === "line" &&
        !!el.shape.lineStart &&
        (el.shape.lineStart.x === 100 || el.shape.lineStart.y === 100)
    );

    expect(flippedLine).toBeDefined();
    expect(flippedLine?.shape?.lineEnd).toBeDefined();

    const rendered = renderSlideHtml({
      background: { type: "none" },
      elements: [flippedLine!],
      import: { slideIndex: 1 },
    });

    expect(rendered).toContain('x1="100"');
    expect(rendered).toContain('x2="0"');
  });
});
