import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, normalize, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { convertPdfPageToPng, convertPptxToPdf } from "./convert";
import { generatePptxPreview, type PreviewSection } from "./preview";

type BrowserChoice = "chrome" | "chromium";

type ImageSize = {
  width: number;
  height: number;
};

type CompareMetric = {
  raw: number | null;
  normalized: number | null;
};

type SlideComparison = {
  sectionId: string;
  label: string;
  slideIndex: number;
  expectedPath: string;
  actualPath: string;
  diffPath: string;
  resizedExpected: boolean;
  metric: CompareMetric;
};

type TemplateCapture = {
  sectionId: string;
  label: string;
  kind: "master" | "layout";
  imagePath: string;
};

type VisualDiffReport = {
  pptxPath: string;
  outputDir: string;
  browser: BrowserChoice;
  previewPath: string;
  slideCount: number;
  mastersCount: number;
  layoutsCount: number;
  templateCount: number;
  rasterizedSlides: number;
  rasterizedShapes: number;
  summary: {
    comparedSlides: number;
    averageNormalizedRmse: number | null;
    maxNormalizedRmse: number | null;
  };
  slides: SlideComparison[];
  templates: TemplateCapture[];
};

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const isDebug = process.env.SLIDEAI_IMPORT_DEBUG === "true";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function toRelativePath(rootDir: string, filePath: string): string {
  return relative(rootDir, filePath).replaceAll("\\", "/");
}

function formatMetric(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

function debugLog(message: string): void {
  if (isDebug) {
    console.log(`[pptx-visual-diff] ${message}`);
  }
}

async function runCommandAllowingDiff(
  command: string,
  args: string[],
  errorPrefix: string
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode > 1) {
        reject(new Error(`${errorPrefix}: ${stderr || stdout}`));
        return;
      }
      resolve({ code: exitCode, stdout, stderr });
    });
    proc.on("error", (err) => {
      const wrapped = new Error(`${errorPrefix}: ${err.message}`) as Error & {
        code?: string;
      };
      wrapped.code = (err as NodeJS.ErrnoException).code;
      reject(wrapped);
    });
  });
}

async function runFirstAvailable(
  commands: Array<{ command: string; args: string[] }>,
  errorPrefix: string
): Promise<CommandResult> {
  let lastError: unknown = null;
  for (const spec of commands) {
    try {
      return await runCommandAllowingDiff(spec.command, spec.args, errorPrefix);
    } catch (err) {
      const errno = err as NodeJS.ErrnoException;
      if (errno?.code === "ENOENT") {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : "no available image tool";
  throw new Error(`${errorPrefix}: ${detail}`);
}

async function getImageSize(imagePath: string): Promise<ImageSize> {
  const result = await runFirstAvailable(
    [
      { command: "magick", args: ["identify", "-format", "%w %h", imagePath] },
      { command: "identify", args: ["-format", "%w %h", imagePath] },
    ],
    "Image identify failed"
  );
  const match = result.stdout.trim().match(/(\d+)\s+(\d+)/);
  if (!match) {
    throw new Error(`Failed to read image size for ${imagePath}`);
  }
  return {
    width: parseInt(match[1], 10),
    height: parseInt(match[2], 10),
  };
}

async function resizeImage(srcPath: string, destPath: string, size: ImageSize): Promise<void> {
  await runFirstAvailable(
    [
      {
        command: "magick",
        args: [srcPath, "-filter", "Lanczos", "-resize", `${size.width}x${size.height}!`, destPath],
      },
      {
        command: "convert",
        args: [srcPath, "-filter", "Lanczos", "-resize", `${size.width}x${size.height}!`, destPath],
      },
    ],
    "Image resize failed"
  );
}

function parseRmseMetric(output: string): CompareMetric {
  const trimmed = output.trim();
  const match = trimmed.match(/([0-9]+(?:\.[0-9]+)?)\s*\(([0-9]+(?:\.[0-9]+)?)\)/);
  if (!match) {
    return { raw: null, normalized: null };
  }
  return {
    raw: Number(match[1]),
    normalized: Number(match[2]),
  };
}

async function compareImages(
  expectedPath: string,
  actualPath: string,
  diffPath: string
): Promise<CompareMetric> {
  const result = await runFirstAvailable(
    [
      {
        command: "magick",
        args: ["compare", "-metric", "RMSE", expectedPath, actualPath, diffPath],
      },
      {
        command: "compare",
        args: ["-metric", "RMSE", expectedPath, actualPath, diffPath],
      },
    ],
    "Image compare failed"
  );
  return parseRmseMetric(result.stderr || result.stdout);
}

async function renderSectionsToPng(
  indexHtmlPath: string,
  slideSizePx: ImageSize,
  sections: PreviewSection[],
  outputDir: string
): Promise<{ browser: BrowserChoice; imageBySectionId: Map<string, string> }> {
  const browserLaunches = [
    {
      browser: "chrome" as const,
      launch: () => chromium.launch({ channel: "chrome", headless: true }),
    },
    {
      browser: "chromium" as const,
      launch: () => chromium.launch({ headless: true }),
    },
  ];

  let lastError: unknown = null;
  for (const launch of browserLaunches) {
    try {
      const browser = await launch.launch();
      try {
        const context = await browser.newContext({
          viewport: {
            width: slideSizePx.width + 96,
            height: slideSizePx.height + 96,
          },
        });
        const page = await context.newPage();
        await page.goto(pathToFileURL(indexHtmlPath).href, { waitUntil: "load" });
        await page.evaluate(async () => {
          await Promise.all(
            Array.from(document.images).map((img) => {
              if (img.complete) return Promise.resolve();
              return new Promise<void>((resolve) => {
                const done = () => resolve();
                img.addEventListener("load", done, { once: true });
                img.addEventListener("error", done, { once: true });
              });
            })
          );
          if (document.fonts) {
            await document.fonts.ready;
          }
        });

        const imageBySectionId = new Map<string, string>();
        for (const section of sections) {
          const imagePath = join(outputDir, `${section.fileStem}.png`);
          await page.locator(section.selector).screenshot({
            path: imagePath,
            animations: "disabled",
          });
          imageBySectionId.set(section.id, imagePath);
        }

        await context.close();
        return { browser: launch.browser, imageBySectionId };
      } finally {
        await browser.close();
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to launch a browser");
}

function renderReportHtml(report: VisualDiffReport): string {
  const slideMarkup = report.slides
    .map((slide) => {
      const expectedPath = escapeHtml(slide.expectedPath);
      const actualPath = escapeHtml(slide.actualPath);
      const diffPath = escapeHtml(slide.diffPath);
      const resizedNote = slide.resizedExpected ? "resized to match actual capture" : "native size";
      return `
<article class="card">
  <h2>${escapeHtml(slide.label)}</h2>
  <p class="meta">RMSE ${formatMetric(slide.metric.normalized)} (${resizedNote})</p>
  <div class="grid">
    <figure>
      <figcaption>Reference</figcaption>
      <img src="${expectedPath}" alt="Reference image for ${escapeHtml(slide.label)}" />
    </figure>
    <figure>
      <figcaption>Imported HTML</figcaption>
      <img src="${actualPath}" alt="Imported HTML image for ${escapeHtml(slide.label)}" />
    </figure>
    <figure>
      <figcaption>Diff</figcaption>
      <img src="${diffPath}" alt="Diff image for ${escapeHtml(slide.label)}" />
    </figure>
  </div>
</article>`;
    })
    .join("\n");

  const templateMarkup = report.templates
    .map((template) => `
<article class="card">
  <h2>${escapeHtml(template.label)}</h2>
  <p class="meta">${escapeHtml(template.kind)}</p>
  <figure class="single">
    <img src="${escapeHtml(template.imagePath)}" alt="${escapeHtml(template.label)}" />
  </figure>
</article>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(basename(report.pptxPath))} visual diff</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #121418;
        --panel: #1d222b;
        --panel-border: rgba(255, 255, 255, 0.08);
        --text: #eef2f7;
        --muted: #98a2b3;
        --accent: #7dd3fc;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px;
        background: radial-gradient(circle at top, #1f2733 0%, var(--bg) 55%);
        color: var(--text);
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      }
      h1, h2 {
        margin: 0;
      }
      a {
        color: var(--accent);
      }
      .summary {
        display: grid;
        gap: 8px;
        margin: 0 0 24px;
        padding: 20px;
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 16px;
      }
      .section {
        margin-top: 32px;
        display: grid;
        gap: 16px;
      }
      .card {
        padding: 20px;
        background: rgba(29, 34, 43, 0.92);
        border: 1px solid var(--panel-border);
        border-radius: 16px;
        display: grid;
        gap: 16px;
      }
      .meta {
        margin: 0;
        color: var(--muted);
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }
      figure {
        margin: 0;
        display: grid;
        gap: 8px;
      }
      figcaption {
        color: var(--muted);
        font-size: 14px;
      }
      img {
        width: 100%;
        height: auto;
        background: #fff;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
      }
      .single {
        max-width: 720px;
      }
      @media (max-width: 720px) {
        body {
          padding: 20px;
        }
      }
    </style>
  </head>
  <body>
    <section class="summary">
      <h1>${escapeHtml(basename(report.pptxPath))} visual diff</h1>
      <p class="meta">Browser: ${report.browser} | Slides: ${report.slideCount} | Masters: ${report.mastersCount} | Layouts: ${report.layoutsCount}</p>
      <p class="meta">Average normalized RMSE: ${formatMetric(report.summary.averageNormalizedRmse)} | Max normalized RMSE: ${formatMetric(report.summary.maxNormalizedRmse)}</p>
      <p class="meta">Preview: <a href="${escapeHtml(report.previewPath)}">open generated HTML</a></p>
    </section>

    <section class="section">
      <h2>Slide Comparisons</h2>
      ${slideMarkup}
    </section>

    <section class="section">
      <h2>Template Captures</h2>
      ${templateMarkup}
    </section>
  </body>
</html>`;
}

async function main(): Promise<void> {
  const [, , pptxArg, outArg] = process.argv;
  if (!pptxArg) {
    throw new Error("Usage: bun server/import/pptx-visual-diff.ts <pptx-path> [output-dir]");
  }

  const pptxPath = normalize(pptxArg);
  const pptxBase = basename(pptxPath, ".pptx");
  const outputDir = normalize(outArg ?? join(process.cwd(), ".tmp", `${pptxBase}-visual-diff`));
  const previewDir = join(outputDir, "preview");
  const actualDir = join(outputDir, "actual");
  const expectedDir = join(outputDir, "expected");
  const diffDir = join(outputDir, "diff");

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(previewDir, { recursive: true });
  await mkdir(actualDir, { recursive: true });
  await mkdir(expectedDir, { recursive: true });
  await mkdir(diffDir, { recursive: true });

  const pdfPath = await convertPptxToPdf(pptxPath, outputDir);
  await rm(join(outputDir, ".lo-profile"), { recursive: true, force: true });
  debugLog(`Converted PPTX to PDF at ${pdfPath}`);
  const preview = await generatePptxPreview({
    pptxPath,
    outputDir: previewDir,
    pdfPath,
  });
  debugLog(`Generated preview with ${preview.sections.length} sections`);
  const rendered = await renderSectionsToPng(
    preview.indexHtmlPath,
    preview.slideSizePx,
    preview.sections,
    actualDir
  );
  debugLog(`Rendered preview sections through ${rendered.browser}`);

  const slides: SlideComparison[] = [];
  const templates: TemplateCapture[] = [];

  for (const section of preview.sections) {
    const actualPath = rendered.imageBySectionId.get(section.id);
    if (!actualPath) {
      throw new Error(`Missing rendered image for section ${section.id}`);
    }

    if (section.kind === "slide") {
      const slideIndex = section.slideIndex ?? 0;
      debugLog(`Preparing comparison for ${section.id}`);
      const expectedPath = await convertPdfPageToPng(
        pdfPath,
        slideIndex,
        expectedDir,
        section.fileStem,
        96
      );
      const actualSize = await getImageSize(actualPath);
      const expectedSize = await getImageSize(expectedPath);
      let compareSourcePath = expectedPath;
      let resizedExpected = false;

      if (
        actualSize.width !== expectedSize.width ||
        actualSize.height !== expectedSize.height
      ) {
        compareSourcePath = join(expectedDir, `${section.fileStem}-resized.png`);
        await resizeImage(expectedPath, compareSourcePath, actualSize);
        resizedExpected = true;
      }

      const diffPath = join(diffDir, `${section.fileStem}.png`);
      debugLog(`Running compare for ${section.id}`);
      const metric = await compareImages(compareSourcePath, actualPath, diffPath);
      debugLog(`Compared ${section.id} with normalized RMSE ${formatMetric(metric.normalized)}`);
      slides.push({
        sectionId: section.id,
        label: section.label,
        slideIndex,
        expectedPath: toRelativePath(outputDir, compareSourcePath),
        actualPath: toRelativePath(outputDir, actualPath),
        diffPath: toRelativePath(outputDir, diffPath),
        resizedExpected,
        metric,
      });
    } else {
      templates.push({
        sectionId: section.id,
        label: section.label,
        kind: section.kind,
        imagePath: toRelativePath(outputDir, actualPath),
      });
    }
  }

  const normalizedMetrics = slides
    .map((slide) => slide.metric.normalized)
    .filter((value): value is number => value !== null);
  const averageNormalizedRmse = normalizedMetrics.length
    ? normalizedMetrics.reduce((sum, value) => sum + value, 0) / normalizedMetrics.length
    : null;
  const maxNormalizedRmse = normalizedMetrics.length
    ? Math.max(...normalizedMetrics)
    : null;

  const report: VisualDiffReport = {
    pptxPath,
    outputDir,
    browser: rendered.browser,
    previewPath: toRelativePath(outputDir, preview.indexHtmlPath),
    slideCount: preview.slideCount,
    mastersCount: preview.mastersCount,
    layoutsCount: preview.layoutsCount,
    templateCount: preview.templateCount,
    rasterizedSlides: preview.rasterizedSlides,
    rasterizedShapes: preview.rasterizedShapes,
    summary: {
      comparedSlides: slides.length,
      averageNormalizedRmse,
      maxNormalizedRmse,
    },
    slides,
    templates,
  };

  const reportJsonPath = join(outputDir, "report.json");
  const reportHtmlPath = join(outputDir, "report.html");
  debugLog("Writing report artifacts");
  await writeFile(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
  await writeFile(reportHtmlPath, renderReportHtml(report), "utf-8");
  debugLog("Report artifacts written");

  console.log(
    [
      "Visual diff summary:",
      `browser=${report.browser}`,
      `slides=${report.slideCount}`,
      `masters=${report.mastersCount}`,
      `layouts=${report.layoutsCount}`,
      `avgRmse=${formatMetric(report.summary.averageNormalizedRmse)}`,
      `maxRmse=${formatMetric(report.summary.maxNormalizedRmse)}`,
      `output=${outputDir}`,
    ].join(" ")
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
