import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile, readdir, unlink, rmdir } from "node:fs/promises";
import { join, normalize, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";

import type { Background, ExtractedElement, SlideRelationships, SlideSource } from "./types";
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
import { EMU_PER_INCH } from "./types";
import { rasterizeSlideIfNeeded } from "./rasterize";

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
  const MAX_ZIP_ENTRIES = 10_000;
  if (entries.length > MAX_ZIP_ENTRIES) {
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

async function main(): Promise<void> {
  const [, , pptxArg, outArg] = process.argv;
  if (!pptxArg) {
    throw new Error("Usage: bun server/import/pptx-to-html.ts <pptx-path> [output-dir]");
  }

  const cwd = process.cwd();
  const pptxPath = normalize(pptxArg);
  const pptxBase = basename(pptxPath, ".pptx");
  const tmpRoot = outArg ? normalize(outArg) : join(cwd, ".tmp");
  const outputDir = outArg ? tmpRoot : join(tmpRoot, pptxBase);
  const assetsDir = join(outputDir, "assets");
  const workDir = join(tmpRoot, `.work-${randomUUID()}`);

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

    const isPlaceholderElement = (element: ExtractedElement): boolean => {
      return Boolean(
        element.placeholder?.type || element.placeholder?.idx || element.placeholder?.name
      );
    };

    const cloneElement = (element: ExtractedElement): ExtractedElement => {
      return {
        ...element,
        image: element.image ? { ...element.image } : undefined,
        shape: element.shape ? { ...element.shape } : undefined,
        placeholder: element.placeholder ? { ...element.placeholder } : undefined,
      };
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

    const pickBackground = (...candidates: Array<Background | undefined>): Background => {
      for (const candidate of candidates) {
        if (!candidate) continue;
        if (candidate.type !== "none") return candidate;
      }
      return { type: "none" };
    };

    const slideHtml: string[] = [];
    const templateHtml: string[] = [];
    let rasterizedSlides = 0;
    let rasterizedShapes = 0;
    let pdfPromise: Promise<string> | null = null;
    const getPdfPath = async (): Promise<string> => {
      if (!pdfPromise) {
        const pdfOverride = join(tmpRoot, `${pptxBase}.pdf`);
        pdfPromise = (await Bun.file(pdfOverride).exists())
          ? Promise.resolve(pdfOverride)
          : convertPptxToPdf(pptxPath, workDir);
      }
      return pdfPromise ?? Promise.reject(new Error("Failed to resolve PDF path."));
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

      const maxZ = (elements: ExtractedElement[]): number => {
        if (elements.length === 0) return -1;
        return Math.max(...elements.map((el) => el.zIndex));
      };
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

      slideHtml.push(
        `<section class="slide" data-slide-index="${i + 1}">\n${renderSlideHtml(source)}\n</section>`
      );
    }

    const renderTemplateSection = (label: string, source: { background: Background; elements: ExtractedElement[] }) => {
      const elements = source.elements
        .map((el) => convertToEditable(el, theme))
        .filter((el): el is NonNullable<typeof el> => el !== null);

      return `<section class="slide" data-template="${label}">\n${renderSlideHtml({
        background: convertBackground(source.background),
        elements,
        import: { slideIndex: -1 },
      })}\n</section>`;
    };

    for (const master of templateRegistry.masters) {
      const [masterElements, masterBackground] = await Promise.all([
        resolveTemplateElements(master),
        resolveTemplateBackground(master),
      ]);
      templateHtml.push(
        renderTemplateSection(`master:${master.name ?? master.path}`, {
          background: pickBackground(masterBackground),
          elements: masterElements,
        })
      );
    }

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

      templateHtml.push(
        renderTemplateSection(`layout:${layout.name ?? layout.path}`, {
          background: mergedBackground,
          elements: mergedElements,
        })
      );
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
    <title>${pptxBase}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    ${slideHtml.join("\n")}
    ${templateHtml.join("\n")}
  </body>
</html>
`.trimStart();

    await writeFile(join(outputDir, "styles.css"), css, "utf-8");
    await writeFile(join(outputDir, "index.html"), html, "utf-8");
    console.log(
      [
        "Import summary:",
        `slides=${slideOrder.length}`,
        `masters=${templateRegistry.masters.length}`,
        `layouts=${templateRegistry.layouts.length}`,
        `rasterized=${rasterizedSlides}`,
        `rasterizedShapes=${rasterizedShapes}`,
      ].join(" ")
    );
  } finally {
    await cleanupDir(workDir);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
