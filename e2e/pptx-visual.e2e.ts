import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePresentation, parseRelationships, parseSlide, resetElementIdCounter } from "../server/import/parser";
import { parseTheme, getDefaultTheme } from "../server/import/theme";
import { convertBackground, convertToEditable } from "../server/import/converter";
import { renderSlideHtml } from "../server/import/render";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pptxPath = path.resolve(__dirname, "..", "ppts", "test1.pptx");

async function readZipEntry(pptxFilePath: string, entryPath: string): Promise<string> {
  const proc = spawn("unzip", ["-p", pptxFilePath, entryPath]);
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

async function readZipEntryOptional(pptxFilePath: string, entryPath: string): Promise<string | null> {
  try {
    return await readZipEntry(pptxFilePath, entryPath);
  } catch {
    return null;
  }
}

async function renderSlidesForPptx(pptxFilePath: string): Promise<string[]> {
  resetElementIdCounter();

  const presentationXml = await readZipEntry(pptxFilePath, "ppt/presentation.xml");
  const { slideSize, slideOrder } = parsePresentation(presentationXml);

  const themeXml = await readZipEntryOptional(pptxFilePath, "ppt/theme/theme1.xml");
  const theme = themeXml ? parseTheme(themeXml) : getDefaultTheme();

  const presRelsXml = await readZipEntry(pptxFilePath, "ppt/_rels/presentation.xml.rels");
  const presRels = parseRelationships(presRelsXml);

  const rendered: string[] = [];

  for (let i = 0; i < slideOrder.length; i++) {
    const slideRId = slideOrder[i];
    const slidePath = presRels.get(slideRId);
    if (!slidePath) {
      throw new Error(`Slide ${i + 1}: missing relationship for ${slideRId}`);
    }

    const slideFilePath = slidePath.startsWith("/") ? slidePath.slice(1) : `ppt/${slidePath}`;
    const slideXml = await readZipEntry(pptxFilePath, slideFilePath);

    const slideRelsPath = slideFilePath.replace(
      /slides\/slide(\d+)\.xml$/,
      "slides/_rels/slide$1.xml.rels"
    );
    const slideRelsXml = await readZipEntryOptional(pptxFilePath, slideRelsPath);
    const slideRels = slideRelsXml ? parseRelationships(slideRelsXml) : new Map();

    const extractedSlide = parseSlide(slideXml, i, slideSize, theme, slideRels);

    const resolveImageUrl = (rId?: string): string | undefined => {
      if (!rId) return undefined;
      const target = slideRels.get(rId);
      if (!target) return undefined;
      return `assets/${path.basename(target)}`;
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

test.describe("PPTX visual import", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("renders imported PPTX slide consistently", async ({ page }) => {
    test.setTimeout(120000);
    const slidesHtml = await renderSlidesForPptx(pptxPath);

    await page.addInitScript((state) => {
      localStorage.setItem("slideai:deck:v1", JSON.stringify(state));
    }, {
      slides: slidesHtml.map((html, index) => ({ id: `slide-${index + 1}`, html })),
      currentSlideIndex: 0,
      messages: [],
      model: "auto",
    });

    await page.goto("/");
    await expect(page.locator(".slide")).toBeVisible();

    const slideContent = page.locator('.slide [data-slide-source="true"]');
    await expect(slideContent).toBeVisible({ timeout: 120000 });

    await page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
      }
    });

    await expect(page.locator(".slide")).toHaveScreenshot("pptx-import-test1.png", {
      animations: "disabled",
    });
  });
});
