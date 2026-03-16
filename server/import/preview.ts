import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, unlink, rmdir, writeFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

import type { Background, ExtractedElement, SlideRelationships, SlideSource, SlideSize } from "./types";
import { EMU_PER_INCH } from "./types";
import { parsePresentation, parseRelationships, parseSlide, resetElementIdCounter } from "./parser";
import { parseTheme, getDefaultTheme } from "./theme";
import { convertBackground, convertToEditable } from "./converter";
import { convertPptxToPdf } from "./convert";
import { renderSlideHtml } from "./render";
import type { TemplateLayout, TemplateSlide } from "./template-parser";
import {
  extractTemplatesFromDir,
  findRelationshipTargetByType,
  resolveRelationshipTargetPath,
} from "./template-parser";
import { rasterizeSlideIfNeeded } from "./rasterize";

export type PreviewSectionKind = "slide" | "master" | "layout";

export type PreviewSection = {
  id: string;
  kind: PreviewSectionKind;
  label: string;
  selector: string;
  fileStem: string;
  slideIndex?: number;
};

export type GeneratePptxPreviewOptions = {
  pptxPath: string;
  outputDir?: string;
  pdfPath?: string;
};

export type GeneratePptxPreviewResult = {
  pptxPath: string;
  pptxBase: string;
  outputDir: string;
  assetsDir: string;
  indexHtmlPath: string;
  stylesPath: string;
  slideSize: SlideSize;
  slideSizePx: { width: number; height: number };
  slideCount: number;
  mastersCount: number;
  layoutsCount: number;
  templateCount: number;
  rasterizedSlides: number;
  rasterizedShapes: number;
  sections: PreviewSection[];
};

async function runCommand(command: string, args: string[], errorPrefix: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args);
    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${errorPrefix}: ${stderr}`));
        return;
      }
      resolve();
    });
    proc.on("error", (err) => {
      reject(new Error(`${errorPrefix}: ${err.message}`));
    });
  });
}

async function unzipPptx(pptxPath: string, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  const listEntries = (): Promise<string[]> =>
    new Promise((resolve, reject) => {
      const proc = spawn("unzip", ["-Z1", pptxPath]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to inspect PPTX contents: ${stderr}`));
          return;
        }
        const entries = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        resolve(entries);
      });
      proc.on("error", (err) => {
        reject(new Error(`Failed to run unzip: ${err.message}`));
      });
    });

  const isSafeZipEntry = (entry: string): boolean => {
    if (entry.length > 1024) return false;
    if (entry.includes("\0")) return false;
    if (entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry)) {
      return false;
    }
    const parts = entry.replace(/\\/g, "/").split("/");
    if (parts.some((part) => part === "..")) return false;
    return true;
  };

  const entries = await listEntries();
  const maxZipEntries = 10_000;
  if (entries.length > maxZipEntries) {
    throw new Error(`PPTX contains too many entries (${entries.length})`);
  }
  const badEntry = entries.find((entry) => !isSafeZipEntry(entry));
  if (badEntry) {
    throw new Error(`Invalid PPTX entry path: ${badEntry}`);
  }

  await runCommand("unzip", ["-o", "-q", pptxPath, "-d", outputDir], "Failed to unzip PPTX");
}

async function readPptxFile(pptxDir: string, relativePath: string): Promise<string | null> {
  const normalized = normalize(relativePath).replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return null;
  }
  try {
    return await readFile(join(pptxDir, normalized), "utf-8");
  } catch {
    return null;
  }
}

function resolveExtractedPath(rootDir: string, relativePath: string): string | null {
  const normalized = normalize(relativePath).replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return null;
  }
  const candidate = normalize(join(rootDir, normalized));
  const rootPrefix = normalize(rootDir.endsWith("/") ? rootDir : `${rootDir}/`);
  if (!candidate.startsWith(rootPrefix)) return null;
  return candidate;
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    const files = await readdir(dir, { withFileTypes: true });
    for (const file of files) {
      const path = join(dir, file.name);
      if (file.isDirectory()) {
        await cleanupDir(path);
      } else {
        await unlink(path);
      }
    }
    await rmdir(dir);
  } catch {
    // Best-effort cleanup only.
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll("\"", "&quot;");
}

function sectionMarkup(
  id: string,
  html: string,
  attributes: Record<string, string>
): string {
  const attributeMarkup = Object.entries({
    "data-section-id": id,
    ...attributes,
  })
    .map(([key, value]) => `${key}="${escapeHtmlAttribute(value)}"`)
    .join(" ");
  return `<section class="slide" ${attributeMarkup}>\n${html}\n</section>`;
}

function cloneElement(element: ExtractedElement): ExtractedElement {
  return {
    ...element,
    image: element.image ? { ...element.image } : undefined,
    shape: element.shape ? { ...element.shape } : undefined,
    placeholder: element.placeholder ? { ...element.placeholder } : undefined,
  };
}

function isPlaceholderElement(element: ExtractedElement): boolean {
  return Boolean(
    element.placeholder?.type || element.placeholder?.idx || element.placeholder?.name
  );
}

function maxZ(elements: ExtractedElement[]): number {
  if (elements.length === 0) return -1;
  return Math.max(...elements.map((el) => el.zIndex));
}

function pickBackground(...candidates: Array<Background | undefined>): Background {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.type !== "none") return candidate;
  }
  return { type: "none" };
}

export async function generatePptxPreview(
  options: GeneratePptxPreviewOptions
): Promise<GeneratePptxPreviewResult> {
  const pptxPath = normalize(options.pptxPath);
  const pptxBase = basename(pptxPath, ".pptx");
  const outputDir = normalize(options.outputDir ?? join(process.cwd(), ".tmp", pptxBase));
  const assetsDir = join(outputDir, "assets");
  const workDir = join(outputDir, `.work-${randomUUID()}`);

  await mkdir(outputDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });
  await unzipPptx(pptxPath, workDir);

  try {
    resetElementIdCounter();

    const presentationXml = await readPptxFile(workDir, "ppt/presentation.xml");
    if (!presentationXml) {
      throw new Error("Invalid PPTX: missing ppt/presentation.xml");
    }

    const { slideSize, slideOrder } = parsePresentation(presentationXml);
    const themeXml = await readPptxFile(workDir, "ppt/theme/theme1.xml");
    const theme = themeXml ? parseTheme(themeXml) : getDefaultTheme();

    const presRelsXml = await readPptxFile(workDir, "ppt/_rels/presentation.xml.rels");
    const presRels = presRelsXml ? parseRelationships(presRelsXml) : new Map<string, string>();

    const templateRegistry = await extractTemplatesFromDir(
      workDir,
      presentationXml,
      slideSize,
      theme
    );
    const mastersByPath = new Map(
      templateRegistry.masters.map((master) => [master.path, master])
    );
    const layoutsByPath = new Map(
      templateRegistry.layouts.map((layout) => [layout.path, layout])
    );

    const imageByTarget = new Map<string, string>();

    const resolveImageTarget = (rId: string, rels: SlideRelationships): string | undefined => {
      const target = rels.get(rId);
      if (!target) return undefined;
      return target.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "");
    };

    const resolveImageForRels = async (
      rId: string,
      rels: SlideRelationships
    ): Promise<string | undefined> => {
      const target = resolveImageTarget(rId, rels);
      if (!target) return undefined;
      if (imageByTarget.has(target)) return imageByTarget.get(target);

      const pptRoot = join(workDir, "ppt");
      const resolved = resolveExtractedPath(pptRoot, target);
      if (!resolved) return undefined;

      const extension = extname(target) || ".png";
      const fileBase = basename(target, extension);
      const filename = `${fileBase}-${randomUUID()}${extension}`;
      const dest = join(assetsDir, filename);
      await copyFile(resolved, dest);
      const url = `assets/${filename}`;
      imageByTarget.set(target, url);
      return url;
    };

    const resolveTemplateElements = async (
      template?: TemplateSlide | TemplateLayout
    ): Promise<ExtractedElement[]> => {
      if (!template) return [];
      const resolved: ExtractedElement[] = [];
      const sorted = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);
      for (const element of sorted) {
        if (isPlaceholderElement(element)) continue;
        const cloned = cloneElement(element);
        if (cloned.type === "image" && cloned.image?.rId) {
          const url = await resolveImageForRels(cloned.image.rId, template.relationships);
          if (url) {
            cloned.image.url = url;
          }
        }
        resolved.push(cloned);
      }
      return resolved;
    };

    const resolveTemplateBackground = async (
      template?: TemplateSlide | TemplateLayout
    ): Promise<Background | undefined> => {
      if (!template) return undefined;
      const background: Background = { ...template.background };
      if (background.type === "image" && background.rId) {
        const url = await resolveImageForRels(background.rId, template.relationships);
        if (url) {
          background.imageUrl = url;
        }
      }
      return background;
    };

    const slideMarkup: string[] = [];
    const templateMarkup: string[] = [];
    const sections: PreviewSection[] = [];
    let rasterizedSlides = 0;
    let rasterizedShapes = 0;
    let pdfPromise: Promise<string> | null = null;

    const getPdfPath = async (): Promise<string> => {
      if (!pdfPromise) {
        pdfPromise = options.pdfPath
          ? Promise.resolve(options.pdfPath)
          : convertPptxToPdf(pptxPath, workDir);
      }
      return pdfPromise;
    };

    const saveImage = async (
      filePath: string,
      baseName: string,
      ext: string
    ): Promise<string> => {
      const filename = `${baseName}-${randomUUID()}.${ext}`;
      const dest = join(assetsDir, filename);
      await copyFile(filePath, dest);
      return `assets/${filename}`;
    };

    for (let i = 0; i < slideOrder.length; i++) {
      const slideRId = slideOrder[i];
      const slidePath = presRels.get(slideRId);
      if (!slidePath) {
        throw new Error(`Slide ${i + 1}: path not found in relationships`);
      }

      const slideFilePath = resolveRelationshipTargetPath("ppt/presentation.xml", slidePath);
      const slideXml = await readPptxFile(workDir, slideFilePath);
      if (!slideXml) {
        throw new Error(`Missing slide XML: ${slideFilePath}`);
      }

      const slideRelsPath = slideFilePath.replace(
        /slides\/slide(\d+)\.xml$/,
        "slides/_rels/slide$1.xml.rels"
      );
      const slideRelsXml = await readPptxFile(workDir, slideRelsPath);
      const slideRels = slideRelsXml ? parseRelationships(slideRelsXml) : new Map<string, string>();

      const layoutTarget = slideRelsXml
        ? findRelationshipTargetByType(slideRelsXml, "slideLayout")
        : undefined;
      const layoutPath = layoutTarget
        ? resolveRelationshipTargetPath(slideFilePath, layoutTarget)
        : undefined;
      const layoutTemplate = layoutPath ? layoutsByPath.get(layoutPath) : undefined;
      const masterTemplate = layoutTemplate?.masterPath
        ? mastersByPath.get(layoutTemplate.masterPath)
        : undefined;

      const extractedSlide = parseSlide(slideXml, i, slideSize, theme, slideRels);

      for (const element of extractedSlide.elements) {
        if (element.type === "image" && element.image?.rId) {
          const url = await resolveImageForRels(element.image.rId, slideRels);
          if (url) {
            element.image.url = url;
          }
        }
      }

      if (extractedSlide.background.type === "image" && extractedSlide.background.rId) {
        const backgroundUrl = await resolveImageForRels(extractedSlide.background.rId, slideRels);
        if (backgroundUrl) {
          extractedSlide.background.imageUrl = backgroundUrl;
        }
      }

      const [masterElements, layoutElements, masterBackground, layoutBackground] = await Promise.all([
        resolveTemplateElements(masterTemplate),
        resolveTemplateElements(layoutTemplate),
        resolveTemplateBackground(masterTemplate),
        resolveTemplateBackground(layoutTemplate),
      ]);

      const masterOffset = 0;
      const layoutOffset = masterOffset + maxZ(masterElements) + 1;
      const slideOffset = layoutOffset + maxZ(layoutElements) + 1;
      const mergedElements = [
        ...masterElements.map((el) => ({ ...el, zIndex: el.zIndex + masterOffset })),
        ...layoutElements.map((el) => ({ ...el, zIndex: el.zIndex + layoutOffset })),
        ...extractedSlide.elements.map((el) => ({ ...el, zIndex: el.zIndex + slideOffset })),
      ];

      const mergedBackground = pickBackground(
        extractedSlide.background,
        layoutBackground,
        masterBackground
      );

      const elements = mergedElements
        .map((el) =>
          convertToEditable(el, theme, (rId) => {
            const target = resolveImageTarget(rId, slideRels);
            return target ? imageByTarget.get(target) : undefined;
          })
        )
        .filter((el): el is NonNullable<typeof el> => el !== null);

      let source: SlideSource = {
        background: convertBackground(mergedBackground),
        elements,
        import: { slideIndex: i },
      };

      const rasterResult = await rasterizeSlideIfNeeded({
        source,
        slideIndex: i,
        pptxPath,
        workDir,
        saveImage,
        getPdfPath,
      });
      source = rasterResult.source;
      if (rasterResult.rasterized) {
        rasterizedSlides++;
        if (rasterResult.mode === "shapes") {
          rasterizedShapes++;
        }
      }

      const sectionId = `slide-${String(i + 1).padStart(2, "0")}`;
      sections.push({
        id: sectionId,
        kind: "slide",
        label: `Slide ${i + 1}`,
        selector: `[data-section-id="${sectionId}"]`,
        fileStem: sectionId,
        slideIndex: i,
      });
      slideMarkup.push(
        sectionMarkup(sectionId, renderSlideHtml(source), {
          "data-slide-index": String(i + 1),
        })
      );
    }

    const renderTemplateSection = (
      template: { background: Background; elements: ExtractedElement[] }
    ): string => {
      const elements = template.elements
        .map((el) => convertToEditable(el, theme))
        .filter((el): el is NonNullable<typeof el> => el !== null);

      return renderSlideHtml({
        background: convertBackground(template.background),
        elements,
        import: { slideIndex: -1 },
      });
    };

    let masterIndex = 0;
    for (const master of templateRegistry.masters) {
      const [masterElements, masterBackground] = await Promise.all([
        resolveTemplateElements(master),
        resolveTemplateBackground(master),
      ]);
      const sectionId = `master-${String(masterIndex + 1).padStart(2, "0")}`;
      const label = master.name ?? master.path;
      sections.push({
        id: sectionId,
        kind: "master",
        label: `Master: ${label}`,
        selector: `[data-section-id="${sectionId}"]`,
        fileStem: sectionId,
      });
      templateMarkup.push(
        sectionMarkup(
          sectionId,
          renderTemplateSection({
            background: pickBackground(masterBackground),
            elements: masterElements,
          }),
          {
            "data-template-kind": "master",
            "data-template": label,
          }
        )
      );
      masterIndex++;
    }

    let layoutIndex = 0;
    for (const layout of templateRegistry.layouts) {
      const master = layout.masterPath ? mastersByPath.get(layout.masterPath) : undefined;
      const [layoutElements, masterElements, layoutBackground, masterBackground] = await Promise.all([
        resolveTemplateElements(layout),
        resolveTemplateElements(master),
        resolveTemplateBackground(layout),
        resolveTemplateBackground(master),
      ]);

      const mergedElements = [...masterElements, ...layoutElements].map((element, index) => ({
        ...element,
        zIndex: index,
      }));
      const mergedBackground = pickBackground(layoutBackground, masterBackground);
      const sectionId = `layout-${String(layoutIndex + 1).padStart(2, "0")}`;
      const label = layout.name ?? layout.path;
      sections.push({
        id: sectionId,
        kind: "layout",
        label: `Layout: ${label}`,
        selector: `[data-section-id="${sectionId}"]`,
        fileStem: sectionId,
      });
      templateMarkup.push(
        sectionMarkup(
          sectionId,
          renderTemplateSection({
            background: mergedBackground,
            elements: mergedElements,
          }),
          {
            "data-template-kind": "layout",
            "data-template": label,
          }
        )
      );
      layoutIndex++;
    }

    const pxPerInch = 96;
    const widthPx = Math.round((slideSize.width / EMU_PER_INCH) * pxPerInch);
    const heightPx = Math.round((slideSize.height / EMU_PER_INCH) * pxPerInch);

    const css = `
:root {
  --slide-width: ${widthPx}px;
  --slide-height: ${heightPx}px;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px;
  background: #111111;
  display: flex;
  flex-direction: column;
  gap: 32px;
  align-items: center;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.slide {
  width: var(--slide-width);
  height: var(--slide-height);
  background: #ffffff;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
`.trimStart();

    const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pptxBase)}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    ${slideMarkup.join("\n")}
    ${templateMarkup.join("\n")}
  </body>
</html>
`.trimStart();

    const indexHtmlPath = join(outputDir, "index.html");
    const stylesPath = join(outputDir, "styles.css");
    await writeFile(stylesPath, css, "utf-8");
    await writeFile(indexHtmlPath, html, "utf-8");

    return {
      pptxPath,
      pptxBase,
      outputDir,
      assetsDir,
      indexHtmlPath,
      stylesPath,
      slideSize,
      slideSizePx: { width: widthPx, height: heightPx },
      slideCount: slideOrder.length,
      mastersCount: templateRegistry.masters.length,
      layoutsCount: templateRegistry.layouts.length,
      templateCount: templateRegistry.masters.length + templateRegistry.layouts.length,
      rasterizedSlides,
      rasterizedShapes,
      sections,
    };
  } finally {
    await cleanupDir(workDir);
  }
}
