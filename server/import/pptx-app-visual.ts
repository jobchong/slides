import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, normalize, relative } from "node:path";

import { chromium, type Browser, type Page } from "playwright";

import type { DeckState, Slide } from "../../app/src/types";

type BrowserChoice = "chrome" | "chromium";

type SlideCapture = {
  index: number;
  label: string;
  slideImagePath: string;
  appImagePath: string;
  htmlPath: string;
  sourcePath: string | null;
};

type AppVisualReport = {
  pptxPath: string;
  outputDir: string;
  appUrl: string;
  browser: BrowserChoice;
  viewport: { width: number; height: number };
  startedDevServer: boolean;
  devServerLogPath: string | null;
  deckStatePath: string;
  slideCount: number;
  captures: SlideCapture[];
};

const DEFAULT_APP_URL = process.env.SLIDEAI_APP_URL || "http://localhost:4000";
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const HEALTHCHECK_TIMEOUT_MS = 120_000;
const IMPORT_TIMEOUT_MS = 120_000;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAppHealth(appUrl: string, timeoutMs = HEALTHCHECK_TIMEOUT_MS): Promise<void> {
  const healthUrl = new URL("/health", appUrl).toString();
  const startedAt = Date.now();
  let lastError = "unknown error";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for app health at ${healthUrl}: ${lastError}`);
}

function startDevServer(logPath: string): ChildProcess {
  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = spawn("bun", ["run", "dev"], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  return child;
}

function stopDevServer(child: ChildProcess | null): void {
  if (!child?.pid) return;

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitForPageAssets(page: Page): Promise<void> {
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
}

async function launchBrowser(): Promise<{
  browser: Browser;
  browserChoice: BrowserChoice;
}> {
  const launches = [
    {
      browserChoice: "chrome" as const,
      launch: () => chromium.launch({ channel: "chrome", headless: true }),
    },
    {
      browserChoice: "chromium" as const,
      launch: () => chromium.launch({ headless: true }),
    },
  ];

  let lastError: unknown = null;
  for (const spec of launches) {
    try {
      return {
        browser: await spec.launch(),
        browserChoice: spec.browserChoice,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to launch a browser");
}

function parseDeckState(raw: string | null): DeckState {
  if (!raw) {
    throw new Error("The app did not persist a deck state to localStorage.");
  }

  const parsed = JSON.parse(raw) as DeckState;
  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error("The imported deck state is missing slides.");
  }
  if (!parsed.slides.every((slide) => typeof slide.html === "string" && slide.html.includes('data-slide-source="true"'))) {
    throw new Error("The persisted deck state does not contain fully imported slide HTML.");
  }

  return parsed;
}

async function waitForPersistedDeckState(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem("slideai:deck:v1");
      if (!raw) return false;

      try {
        const state = JSON.parse(raw);
        const thumbnails = document.querySelectorAll('[role="option"]').length;
        return (
          Array.isArray(state.slides) &&
          state.slides.length > 0 &&
          state.slides.length === thumbnails &&
          state.slides.every(
            (slide: { html?: string }) =>
              typeof slide.html === "string" &&
              slide.html.includes('data-slide-source="true"')
          )
        );
      } catch {
        return false;
      }
    },
    { timeout: IMPORT_TIMEOUT_MS }
  );
}

function renderReportHtml(report: AppVisualReport): string {
  const capturesMarkup = report.captures
    .map((capture) => `
<article class="card">
  <h2>${escapeHtml(capture.label)}</h2>
  <p class="meta">
    <a href="${escapeHtml(capture.htmlPath)}">HTML</a>
    ${capture.sourcePath ? ` | <a href="${escapeHtml(capture.sourcePath)}">source JSON</a>` : ""}
  </p>
  <div class="grid">
    <figure>
      <figcaption>Main slide capture</figcaption>
      <img src="${escapeHtml(capture.slideImagePath)}" alt="${escapeHtml(capture.label)} slide capture" />
    </figure>
    <figure>
      <figcaption>Full app capture</figcaption>
      <img src="${escapeHtml(capture.appImagePath)}" alt="${escapeHtml(capture.label)} app capture" />
    </figure>
  </div>
</article>`)
    .join("\n");

  const logMarkup = report.devServerLogPath
    ? `<p class="meta">Dev server log: <a href="${escapeHtml(report.devServerLogPath)}">open log</a></p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(basename(report.pptxPath))} app visual report</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #101418;
        --panel: #1b232c;
        --panel-border: rgba(255, 255, 255, 0.08);
        --text: #eef2f7;
        --muted: #98a2b3;
        --accent: #7dd3fc;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px;
        background: radial-gradient(circle at top, #1d2733 0%, var(--bg) 55%);
        color: var(--text);
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      }
      a {
        color: var(--accent);
      }
      .summary,
      .card {
        background: rgba(27, 35, 44, 0.94);
        border: 1px solid var(--panel-border);
        border-radius: 16px;
      }
      .summary {
        margin-bottom: 24px;
        padding: 20px;
      }
      .section {
        display: grid;
        gap: 16px;
      }
      .card {
        padding: 20px;
      }
      .meta {
        color: var(--muted);
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
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
        border-radius: 12px;
        background: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
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
      <h1>${escapeHtml(basename(report.pptxPath))} app visual report</h1>
      <p class="meta">App URL: ${escapeHtml(report.appUrl)} | Browser: ${report.browser} | Viewport: ${report.viewport.width}x${report.viewport.height}</p>
      <p class="meta">Slides: ${report.slideCount} | Started dev server: ${report.startedDevServer ? "yes" : "no"}</p>
      <p class="meta">Deck state: <a href="${escapeHtml(report.deckStatePath)}">open JSON</a></p>
      ${logMarkup}
    </section>
    <section class="section">
      ${capturesMarkup}
    </section>
  </body>
</html>`;
}

async function captureSlideArtifacts(
  page: Page,
  slide: Slide,
  slideIndex: number,
  outputDir: string
): Promise<SlideCapture> {
  const padded = String(slideIndex + 1).padStart(2, "0");
  const label = `Slide ${slideIndex + 1}`;
  const htmlDir = join(outputDir, "html");
  const sourceDir = join(outputDir, "source");
  const slidesDir = join(outputDir, "slides");
  const appDir = join(outputDir, "app");
  const htmlPath = join(htmlDir, `slide-${padded}.html`);
  const sourcePath = slide.source ? join(sourceDir, `slide-${padded}.json`) : null;
  const slideImagePath = join(slidesDir, `slide-${padded}.png`);
  const appImagePath = join(appDir, `slide-${padded}.png`);

  await writeFile(htmlPath, slide.html, "utf-8");
  if (sourcePath) {
    await writeFile(sourcePath, JSON.stringify(slide.source, null, 2), "utf-8");
  }

  const thumbnails = page.locator('[role="option"]');
  await thumbnails.nth(slideIndex).click();
  await page.waitForFunction(
    (index) => {
      const options = Array.from(document.querySelectorAll('[role="option"]'));
      return options[index]?.getAttribute("aria-selected") === "true";
    },
    slideIndex,
    { timeout: IMPORT_TIMEOUT_MS }
  );
  await page.locator('.slide [data-slide-source="true"]').waitFor({
    state: "visible",
    timeout: IMPORT_TIMEOUT_MS,
  });
  await waitForPageAssets(page);

  await page.locator(".slide").screenshot({
    path: slideImagePath,
    animations: "disabled",
  });
  await page.locator(".app").screenshot({
    path: appImagePath,
    animations: "disabled",
  });

  return {
    index: slideIndex,
    label,
    slideImagePath: toRelativePath(outputDir, slideImagePath),
    appImagePath: toRelativePath(outputDir, appImagePath),
    htmlPath: toRelativePath(outputDir, htmlPath),
    sourcePath: sourcePath ? toRelativePath(outputDir, sourcePath) : null,
  };
}

async function main(): Promise<void> {
  const [, , pptxArg, outArg] = process.argv;
  if (!pptxArg) {
    throw new Error("Usage: bun server/import/pptx-app-visual.ts <pptx-path> [output-dir]");
  }

  const pptxPath = normalize(pptxArg);
  const pptxBase = basename(pptxPath, ".pptx");
  const outputDir = normalize(outArg ?? join(process.cwd(), ".tmp", `${pptxBase}-app-visual`));
  const appUrl = DEFAULT_APP_URL;

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(join(outputDir, "app"), { recursive: true });
  await mkdir(join(outputDir, "slides"), { recursive: true });
  await mkdir(join(outputDir, "html"), { recursive: true });
  await mkdir(join(outputDir, "source"), { recursive: true });

  let devServer: ChildProcess | null = null;
  let startedDevServer = false;
  const devServerLogPath = join(outputDir, "dev-server.log");

  try {
    try {
      await waitForAppHealth(appUrl, 1500);
    } catch {
      devServer = startDevServer(devServerLogPath);
      startedDevServer = true;
      await waitForAppHealth(appUrl);
    }

    const cleanup = () => stopDevServer(devServer);
    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(143);
    });

    const { browser, browserChoice } = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: DEFAULT_VIEWPORT,
      });
      const page = await context.newPage();
      await page.goto(appUrl, { waitUntil: "load", timeout: IMPORT_TIMEOUT_MS });
      await page.locator(".slide").waitFor({ state: "visible", timeout: IMPORT_TIMEOUT_MS });

      const importDialog = page.getByRole("dialog", { name: "Importing Presentation" });
      const fileInput = page.locator('input[type="file"][accept=".pptx"]');
      await fileInput.setInputFiles(pptxPath);
      await importDialog.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      await importDialog.waitFor({ state: "hidden", timeout: IMPORT_TIMEOUT_MS }).catch(() => {});
      await page.locator('.slide [data-slide-source="true"]').waitFor({
        state: "visible",
        timeout: IMPORT_TIMEOUT_MS,
      });
      await waitForPageAssets(page);
      await waitForPersistedDeckState(page);
      await sleep(250);

      const deckState = parseDeckState(
        await page.evaluate(() => localStorage.getItem("slideai:deck:v1"))
      );

      const deckStatePath = join(outputDir, "deck-state.json");
      await writeFile(deckStatePath, JSON.stringify(deckState, null, 2), "utf-8");

      const captures: SlideCapture[] = [];
      for (let i = 0; i < deckState.slides.length; i++) {
        captures.push(await captureSlideArtifacts(page, deckState.slides[i], i, outputDir));
      }

      const report: AppVisualReport = {
        pptxPath,
        outputDir,
        appUrl,
        browser: browserChoice,
        viewport: DEFAULT_VIEWPORT,
        startedDevServer,
        devServerLogPath: startedDevServer ? toRelativePath(outputDir, devServerLogPath) : null,
        deckStatePath: toRelativePath(outputDir, deckStatePath),
        slideCount: deckState.slides.length,
        captures,
      };

      const reportJsonPath = join(outputDir, "report.json");
      const reportHtmlPath = join(outputDir, "report.html");
      await writeFile(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
      await writeFile(reportHtmlPath, renderReportHtml(report), "utf-8");

      console.log(
        [
          "App visual summary:",
          `browser=${browserChoice}`,
          `slides=${deckState.slides.length}`,
          `startedDevServer=${startedDevServer}`,
          `output=${outputDir}`,
        ].join(" ")
      );

      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    if (startedDevServer) {
      stopDevServer(devServer);
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
