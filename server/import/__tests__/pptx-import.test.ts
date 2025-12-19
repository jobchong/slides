import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

import { parsePresentation, parseRelationships, parseSlide, resetElementIdCounter } from "../parser";
import { parseTheme, getDefaultTheme } from "../theme";
import { convertBackground, convertToEditable } from "../converter";
import { renderSlideHtml } from "../render";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pptxDir = join(repoRoot, "ppts");
const fixturesDir = join(repoRoot, "server", "import", "__fixtures__");

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

function normalizeOutput(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

async function renderSlidesForPptx(pptxPath: string): Promise<string[]> {
  resetElementIdCounter();

  const presentationXml = await readZipEntry(pptxPath, "ppt/presentation.xml");
  const { slideSize, slideOrder } = parsePresentation(presentationXml);

  const themeXml = await readZipEntryOptional(pptxPath, "ppt/theme/theme1.xml");
  const theme = themeXml ? parseTheme(themeXml) : getDefaultTheme();

  const presRelsXml = await readZipEntry(pptxPath, "ppt/_rels/presentation.xml.rels");
  const presRels = parseRelationships(presRelsXml);

  const rendered: string[] = [];

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

    rendered.push(renderSlideHtml(source));
  }

  return rendered;
}

const pptxFiles = ["test1.pptx", "test2.pptx", "test3.pptx"];

for (const pptxFile of pptxFiles) {
  const pptxPath = join(pptxDir, pptxFile);
  const pptxBase = pptxFile.replace(/\.pptx$/, "");

  describe(`PPTX import (${pptxFile})`, () => {
    test("renders deterministic HTML for each slide", async () => {
      const slides = await renderSlidesForPptx(pptxPath);
      expect(slides.length).toBeGreaterThan(0);

      for (let i = 0; i < slides.length; i++) {
        const fixturePath = join(fixturesDir, `${pptxBase}-slide-${i + 1}.html`);
        const expected = await readFile(fixturePath, "utf-8");
        expect(normalizeOutput(slides[i])).toBe(normalizeOutput(expected));
      }
    });
  });
}
