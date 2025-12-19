import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile, readdir, unlink, rmdir } from "node:fs/promises";
import { join, normalize, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";

import { parsePresentation, parseRelationships, parseSlide, resetElementIdCounter } from "./parser";
import { parseTheme, getDefaultTheme } from "./theme";
import { convertBackground, convertToEditable } from "./converter";
import { convertPdfPageToPng, convertPptxToPdf } from "./convert";
import { renderSlideHtml } from "./render";
import { EMU_PER_INCH } from "./types";

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

async function getImageSize(imagePath: string): Promise<{ width: number; height: number }> {
  const proc = spawn("sips", ["-g", "pixelWidth", "-g", "pixelHeight", "-1", imagePath]);
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
        reject(new Error(`sips failed: ${stderr}`));
        return;
      }
      resolve();
    });
    proc.on("error", (err) => {
      reject(new Error(`sips failed: ${err.message}`));
    });
  });

  const widthMatch = stdout.match(/pixelWidth:\s+(\d+)/);
  const heightMatch = stdout.match(/pixelHeight:\s+(\d+)/);
  if (!widthMatch || !heightMatch) {
    throw new Error(`Failed to read image size for ${imagePath}`);
  }

  return { width: parseInt(widthMatch[1], 10), height: parseInt(heightMatch[1], 10) };
}

async function cropImage(
  srcPath: string,
  destPath: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  await runCommand(
    "sips",
    [
      "-c",
      String(height),
      String(width),
      "--cropOffset",
      String(y),
      String(x),
      "-o",
      destPath,
      srcPath,
    ],
    "sips crop failed"
  );
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

    const imageByTarget = new Map<string, string>();
    const resolveImageForSlide = async (
      rId: string,
      slideRels: Map<string, string>
    ): Promise<string | undefined> => {
      const target = slideRels.get(rId);
      if (!target) return undefined;
      if (imageByTarget.has(target)) return imageByTarget.get(target);

      const pptRoot = join(workDir, "ppt");
      const cleanedRel = target.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "");
      const resolved = resolveExtractedPath(pptRoot, cleanedRel);
      if (!resolved) return undefined;

      const extension = extname(cleanedRel) || ".png";
      const fileBase = basename(cleanedRel, extension);
      const filename = `${fileBase}-${randomUUID()}${extension}`;
      const dest = join(assetsDir, filename);
      await copyFile(resolved, dest);
      const url = `assets/${filename}`;
      imageByTarget.set(target, url);
      return url;
    };

    const slideHtml: string[] = [];
    for (let i = 0; i < slideOrder.length; i++) {
      const slideRId = slideOrder[i];
      const slidePath = presRels.get(slideRId);
      if (!slidePath) {
        throw new Error(`Slide ${i + 1}: path not found in relationships`);
      }

      const slideFilePath = slidePath.startsWith("/")
        ? slidePath.slice(1)
        : `ppt/${slidePath}`;

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

      const extractedSlide = parseSlide(slideXml, i, slideSize, theme, slideRels);

      const resolvedByRid = new Map<string, string>();
      for (const element of extractedSlide.elements) {
        if (element.type === "image" && element.image?.rId) {
          const url = await resolveImageForSlide(element.image.rId, slideRels);
          if (url) resolvedByRid.set(element.image.rId, url);
        }
      }

      const elements = extractedSlide.elements
        .map((el) => convertToEditable(el, theme, (rId) => resolvedByRid.get(rId)))
        .filter((el): el is NonNullable<typeof el> => el !== null);
      let source = {
        background: convertBackground(extractedSlide.background),
        elements,
        import: { slideIndex: i },
      };

      const customShapes = source.elements.filter(
        (el) => el.type === "shape" && el.shape?.kind === "custom" && el.shape.svgPath && el.shape.svgViewBox
      );
      const nonTextElements = source.elements.filter((el) => el.type !== "text");

      const shouldRasterizeNonText = nonTextElements.length > 8;
      if (customShapes.length > 0 || shouldRasterizeNonText) {
        const pdfOverride = join(tmpRoot, `${pptxBase}.pdf`);
        const pdfPath = (await Bun.file(pdfOverride).exists())
          ? pdfOverride
          : await convertPptxToPdf(pptxPath, workDir);
        const slidePng = await convertPdfPageToPng(
          pdfPath,
          i,
          workDir,
          `slide-${i + 1}`,
          200
        );

        if (shouldRasterizeNonText) {
          const slideFilename = `slide-${i + 1}-${randomUUID()}.png`;
          const slideDest = join(assetsDir, slideFilename);
          await copyFile(slidePng, slideDest);
          source = {
            ...source,
            background: { type: "rasterized", url: `assets/${slideFilename}` },
            // Slide-accurate: the raster already includes visible text.
            elements: [],
          };
        } else if (customShapes.length > 0) {
          const { width: imgWidth, height: imgHeight } = await getImageSize(slidePng);
          const elementImages = new Map<string, string>();
          for (const shapeElement of customShapes) {
            const bounds = shapeElement.bounds;
            const cropX = Math.max(0, Math.round((bounds.x / 100) * imgWidth));
            const cropY = Math.max(0, Math.round((bounds.y / 100) * imgHeight));
            const cropW = Math.max(1, Math.round((bounds.width / 100) * imgWidth));
            const cropH = Math.max(1, Math.round((bounds.height / 100) * imgHeight));

            const filename = `shape-${i + 1}-${randomUUID()}.png`;
            const dest = join(assetsDir, filename);
            await cropImage(slidePng, dest, cropX, cropY, cropW, cropH);
            elementImages.set(shapeElement.id, `assets/${filename}`);
          }

          source = {
            ...source,
            elements: source.elements.map((el) => {
              if (el.type === "shape" && elementImages.has(el.id)) {
                return {
                  id: el.id,
                  type: "image",
                  bounds: el.bounds,
                  zIndex: el.zIndex,
                  rotation: el.rotation,
                  image: {
                    url: elementImages.get(el.id)!,
                    objectFit: "fill",
                  },
                };
              }
              return el;
            }),
          };
        }
      }

      slideHtml.push(
        `<section class="slide" data-slide-index="${i + 1}">\n${renderSlideHtml(source)}\n</section>`
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
  </body>
</html>
`.trimStart();

    await writeFile(join(outputDir, "styles.css"), css, "utf-8");
    await writeFile(join(outputDir, "index.html"), html, "utf-8");
  } finally {
    await cleanupDir(workDir);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
