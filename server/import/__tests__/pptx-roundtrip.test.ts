import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { parsePresentation, parseRelationships, parseSlide, resetElementIdCounter } from "../parser";
import { parseTheme, getDefaultTheme } from "../theme";
import { convertBackground, convertToEditable } from "../converter";
import { renderSlideHtml } from "../render";
import { exportDeckToPptx } from "../../export";
import type { Slide } from "../../../app/src/types";

type SlideSource = NonNullable<Slide["source"]>;

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

async function buildSlidesFromPptx(pptxPath: string): Promise<{ slides: Slide[]; html: string[] }> {
  resetElementIdCounter();

  const presentationXml = await readZipEntry(pptxPath, "ppt/presentation.xml");
  const { slideSize, slideOrder } = parsePresentation(presentationXml);

  const themeXml = await readZipEntryOptional(pptxPath, "ppt/theme/theme1.xml");
  const theme = themeXml ? parseTheme(themeXml) : getDefaultTheme();

  const presRelsXml = await readZipEntry(pptxPath, "ppt/_rels/presentation.xml.rels");
  const presRels = parseRelationships(presRelsXml);

  const slides: Slide[] = [];
  const html: string[] = [];

  for (let i = 0; i < slideOrder.length; i++) {
    const slideRId = slideOrder[i];
    const slidePath = presRels.get(slideRId);
    if (!slidePath) {
      throw new Error(`Slide ${i + 1}: missing relationship for ${slideRId}`);
    }

    const slideFilePath = slidePath.startsWith("/") ? slidePath.slice(1) : `ppt/${slidePath}`;
    const slideXml = await readZipEntry(pptxPath, slideFilePath);

    const slideRelsPath = slideFilePath.replace(
      /slides\/slide(\d+)\.xml$/,
      "slides/_rels/slide$1.xml.rels"
    );
    const slideRelsXml = await readZipEntryOptional(pptxPath, slideRelsPath);
    const slideRels = slideRelsXml ? parseRelationships(slideRelsXml) : new Map();

    const extractedSlide = parseSlide(slideXml, i, slideSize, theme, slideRels);

    const resolveImageUrl = (rId?: string): string | undefined => {
      if (!rId) return undefined;
      const target = slideRels.get(rId);
      if (!target) return undefined;
      return `assets/${basename(target)}`;
    };

    const elements = extractedSlide.elements
      .map((el) => convertToEditable(el, theme, resolveImageUrl))
      .filter((el): el is NonNullable<typeof el> => el !== null);

    const source = {
      background: convertBackground(extractedSlide.background),
      elements,
      import: { slideIndex: i },
    };

    const slideHtml = renderSlideHtml(source);
    slides.push({ id: `slide-${i}`, html: slideHtml, source });
    html.push(slideHtml);
  }

  return { slides, html };
}

const pptxFiles = ["test1.pptx", "test2.pptx", "test3.pptx"];

function round(value: number, precision = 4): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeBounds(bounds: { x: number; y: number; width: number; height: number }) {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(bounds.width),
    height: round(bounds.height),
  };
}

function normalizeTextElement(element: SlideSource["elements"][number]) {
  if (!element.text) return null;
  return {
    content: element.text.content,
    fontFamily: element.text.style.fontFamily,
    fontSize: round(element.text.style.fontSize, 2),
    fontWeight: element.text.style.fontWeight,
    fontStyle: element.text.style.fontStyle,
    color: element.text.style.color,
    align: element.text.style.align,
    verticalAlign: element.text.style.verticalAlign,
    bounds: normalizeBounds(element.bounds),
  };
}

function normalizeNonTextElement(element: SlideSource["elements"][number]) {
  if (element.type === "text") return null;
  return normalizeBounds(element.bounds);
}

function expectBoundsClose(actual: ReturnType<typeof normalizeBounds>, expected: ReturnType<typeof normalizeBounds>) {
  expect(actual.x).toBeCloseTo(expected.x, 2);
  expect(actual.y).toBeCloseTo(expected.y, 2);
  expect(actual.width).toBeCloseTo(expected.width, 2);
  expect(actual.height).toBeCloseTo(expected.height, 2);
}

function expectTextElementClose(
  actual: ReturnType<typeof normalizeTextElement>,
  expected: ReturnType<typeof normalizeTextElement>
) {
  if (!actual || !expected) return;
  expect(actual.content).toBe(expected.content);
  expect(actual.fontFamily).toBe(expected.fontFamily);
  expect(actual.fontSize).toBeCloseTo(expected.fontSize, 2);
  expect(actual.fontWeight).toBe(expected.fontWeight);
  expect(actual.fontStyle).toBe(expected.fontStyle);
  expect(actual.color).toBe(expected.color);
  expect(actual.align).toBe(expected.align);
  expect(actual.verticalAlign).toBe(expected.verticalAlign);
  expectBoundsClose(actual.bounds, expected.bounds);
}

describe("PPTX round-trip fidelity", () => {
  for (const pptxFile of pptxFiles) {
    const pptxPath = join(pptxDir, pptxFile);

    test(
      `round-trips ${pptxFile} through export`,
      async () => {
      const { slides: originalSlides, html: originalHtml } = await buildSlidesFromPptx(pptxPath);

      const exported = await exportDeckToPptx(originalSlides, "http://localhost:4000");

      const tempDir = await mkdtemp(join(tmpdir(), "slideai-roundtrip-"));
      const outputPath = join(tempDir, `roundtrip-${pptxFile}`);
      await writeFile(outputPath, exported);

      try {
        const { slides: roundTripSlides, html: roundTripHtml } = await buildSlidesFromPptx(outputPath);
        expect(roundTripHtml.length).toBe(originalHtml.length);

        for (let i = 0; i < originalHtml.length; i++) {
          const originalSource = originalSlides[i].source!;
          const roundTripSource = roundTripSlides[i].source!;

          const originalText = originalSource.elements
            .map(normalizeTextElement)
            .filter(Boolean)
            .sort((a, b) => (a!.content > b!.content ? 1 : -1));
          const roundTripText = roundTripSource.elements
            .map(normalizeTextElement)
            .filter(Boolean)
            .sort((a, b) => (a!.content > b!.content ? 1 : -1));

          expect(roundTripText.length).toBe(originalText.length);
          for (let j = 0; j < originalText.length; j++) {
            expectTextElementClose(roundTripText[j], originalText[j]);
          }

          const originalNonText = originalSource.elements
            .map(normalizeNonTextElement)
            .filter(Boolean)
            .sort((a, b) => (a!.x > b!.x ? 1 : -1));
          const roundTripNonText = roundTripSource.elements
            .map(normalizeNonTextElement)
            .filter(Boolean)
            .sort((a, b) => (a!.x > b!.x ? 1 : -1));

          expect(roundTripNonText.length).toBe(originalNonText.length);
          for (let j = 0; j < originalNonText.length; j++) {
            expectBoundsClose(roundTripNonText[j]!, originalNonText[j]!);
          }
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    { timeout: 60000 }
    );
  }
});
