import { spawn } from "node:child_process";
import { mkdir, readdir, unlink, rmdir, readFile, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { buildGatewayUrl, buildStoredImageUrl } from "./gateway";
import { logError, logInfo, logWarn } from "./logger";
import { renderSlideHtml } from "./import/render";
import { convertPptxToPdf } from "./import/convert";
import { rasterizeSlideIfNeeded } from "./import/rasterize";

// Import hybrid parsing modules
import type {
  ImportProgress,
  Theme,
  SlideRelationships,
  ImportOptions,
  SlideSource,
  ExtractedElement,
  Background,
} from "./import/types";
import { parseTheme, getDefaultTheme } from "./import/theme";
import { parsePresentation, parseRelationships, parseSlide, resetElementIdCounter } from "./import/parser";
import { convertToEditable, convertBackground } from "./import/converter";
import type { TemplateLayout, TemplateSlide } from "./import/template-parser";
import {
  extractTemplatesFromDir,
  findRelationshipTargetByType,
  resolveRelationshipTargetPath,
} from "./import/template-parser";

const s3Bucket = process.env.S3_BUCKET;
const s3Region = process.env.S3_REGION || "us-east-1";
const s3Endpoint = process.env.S3_ENDPOINT;
const s3ForcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";

let s3Client: S3Client | null = null;
function getS3Client(): S3Client | null {
  if (!s3Bucket) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: s3Region,
      endpoint: s3Endpoint,
      forcePathStyle: s3ForcePathStyle,
    });
  }
  return s3Client;
}

async function saveUploadBytes(
  req: Request,
  uploadDir: string,
  filename: string,
  bytes: Uint8Array,
  contentType?: string
): Promise<string> {
  const client = getS3Client();
  if (client && s3Bucket) {
    const key = `uploads/${filename}`;
    await client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType || "application/octet-stream",
      })
    );
    return buildStoredImageUrl(req, filename);
  }

  const uploadPath = join(uploadDir, filename);
  await writeFile(uploadPath, bytes);
  return buildGatewayUrl(req, filename);
}

/**
 * Unzip PPTX and read its contents
 */
async function unzipPptx(
  pptxPath: string,
  outputDir: string
): Promise<void> {
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
    // Prevent absolute paths and Windows paths.
    if (entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry)) {
      return false;
    }
    // Prevent traversal attempts.
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

  return new Promise((resolve, reject) => {
    const unzip = spawn("unzip", ["-o", "-q", pptxPath, "-d", outputDir]);

    let stderr = "";
    unzip.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    unzip.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to unzip PPTX: ${stderr}`));
        return;
      }
      resolve();
    });

    unzip.on("error", (err) => {
      reject(new Error(`Failed to run unzip: ${err.message}`));
    });
  });
}

/**
 * Read a file from the unzipped PPTX, returns null if not found
 */
async function readPptxFile(
  pptxDir: string,
  relativePath: string
): Promise<string | null> {
  const normalized = normalize(relativePath).replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    logWarn("Blocked unsafe PPTX path read attempt", { relativePath });
    return null;
  }
  try {
    const content = await readFile(join(pptxDir, normalized), "utf-8");
    return content;
  } catch {
    return null;
  }
}

/**
 * Main import function using deterministic parsing only.
 */
export async function* importPptx(
  pptxPath: string,
  tempDir: string,
  req: Request,
  options: ImportOptions = {}
): AsyncGenerator<ImportProgress> {
  const envConcurrency = Number(process.env.IMPORT_CONCURRENCY);
  const effectiveOptions: ImportOptions = {
    ...options,
    concurrency: options.concurrency ?? (Number.isFinite(envConcurrency) ? envConcurrency : 2),
  };

  const importId = crypto.randomUUID();
  const workDir = join(tempDir, `import-${importId}`);
  const uploadDir = join(tempDir, "..");

  try {
    yield { type: "progress", status: "Extracting PPTX contents..." };

    // Reset element ID counter for this import session
    resetElementIdCounter();

    // Unzip PPTX
    await mkdir(uploadDir, { recursive: true });
    await unzipPptx(pptxPath, workDir);

    // Read presentation.xml for slide size and order
    const presentationXml = await readPptxFile(workDir, "ppt/presentation.xml");
    if (!presentationXml) {
      throw new Error("Invalid PPTX: missing presentation.xml");
    }

    const { slideSize, slideOrder } = parsePresentation(presentationXml);
    logInfo("Parsed presentation", {
      slideCount: slideOrder.length,
      slideSize,
    });

    // Read theme
    const themeXml = await readPptxFile(workDir, "ppt/theme/theme1.xml");
    const theme: Theme = themeXml ? parseTheme(themeXml) : getDefaultTheme();

    // Read presentation relationships to get slide file paths
    const presRelsXml = await readPptxFile(
      workDir,
      "ppt/_rels/presentation.xml.rels"
    );
    const presRels = presRelsXml
      ? parseRelationships(presRelsXml)
      : new Map<string, string>();

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

    const total = slideOrder.length;
    let rasterizedSlides = 0;
    let rasterizedShapes = 0;

    yield { type: "progress", status: "Parsing slides...", total };

    const MAX_CONCURRENCY = 8;
    const concurrency = Math.min(
      MAX_CONCURRENCY,
      Math.max(1, Number(effectiveOptions.concurrency || 1))
    );

    const resolveExtractedPath = (rootDir: string, relativePath: string): string | null => {
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
    };

    const guessImageContentType = (ext: string): string => {
      const lower = ext.toLowerCase();
      if (lower === "jpg" || lower === "jpeg") return "image/jpeg";
      if (lower === "png") return "image/png";
      if (lower === "webp") return "image/webp";
      if (lower === "gif") return "image/gif";
      if (lower === "svg") return "image/svg+xml";
      return "application/octet-stream";
    };

    // Helper to resolve image rIds to URLs
    const imageByTarget = new Map<string, string>();

    const resolveImageTarget = (
      rId: string,
      rels: SlideRelationships
    ): string | undefined => {
      const imagePath = rels.get(rId);
      if (!imagePath) return undefined;
      return imagePath.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "");
    };

    const uploadImage = async (
      rId: string,
      rels: SlideRelationships
    ): Promise<string | undefined> => {
      const cleanedRel = resolveImageTarget(rId, rels);
      if (!cleanedRel) return undefined;
      if (imageByTarget.has(cleanedRel)) {
        return imageByTarget.get(cleanedRel);
      }

      const pptRoot = join(workDir, "ppt");
      const resolved = resolveExtractedPath(pptRoot, cleanedRel);
      if (!resolved) return undefined;
      try {
        const imageBytes = new Uint8Array(await Bun.file(resolved).arrayBuffer());
        const ext = cleanedRel.split(".").pop() || "png";
        const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const url = await saveUploadBytes(
          req,
          uploadDir,
          filename,
          imageBytes,
          guessImageContentType(ext)
        );
        imageByTarget.set(cleanedRel, url);
        return url;
      } catch {
        return undefined;
      }
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
          const url = await uploadImage(cloned.image.rId, template.relationships);
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
        const url = await uploadImage(background.rId, template.relationships);
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

    let pdfPromise: Promise<string> | null = null;
    const getPdfPath = async (): Promise<string> => {
      if (!pdfPromise) {
        pdfPromise = convertPptxToPdf(pptxPath, workDir);
      }
      return pdfPromise;
    };

    const saveRasterImage = async (
      filePath: string,
      baseName: string,
      ext: string
    ): Promise<string> => {
      const imageBytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
      const filename = `${baseName}-${crypto.randomUUID()}.${ext}`;
      return saveUploadBytes(
        req,
        uploadDir,
        filename,
        imageBytes,
        guessImageContentType(ext)
      );
    };

    const startSlideTask = async (i: number) => {
      const slideRId = slideOrder[i];
      const slidePath = presRels.get(slideRId);

      if (!slidePath) {
        return { i, progress: { type: "error", error: `Slide ${i + 1}: path not found in relationships` } as ImportProgress };
      }

      const slideFilePath = resolveRelationshipTargetPath("ppt/presentation.xml", slidePath);

      try {
        const slideXml = await readPptxFile(workDir, slideFilePath);
        if (!slideXml) {
          throw new Error(`Missing slide XML: ${slideFilePath}`);
        }

        const slideRelsPath = slideFilePath.replace(
          /slides\/slide(\d+)\.xml$/,
          "slides/_rels/slide$1.xml.rels"
        );
        const slideRelsXml = await readPptxFile(workDir, slideRelsPath);
        const slideRels: SlideRelationships = slideRelsXml
          ? parseRelationships(slideRelsXml)
          : new Map();

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

        // Upload images used in the slide
        for (const element of extractedSlide.elements) {
          if (element.type === "image" && element.image?.rId) {
            await uploadImage(element.image.rId, slideRels);
          }
        }

        if (extractedSlide.background.type === "image" && extractedSlide.background.rId) {
          const backgroundUrl = await uploadImage(extractedSlide.background.rId, slideRels);
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

        // Convert extracted elements to editable format
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
          saveImage: saveRasterImage,
          getPdfPath,
        });
        source = rasterResult.source;
        if (rasterResult.rasterized) {
          rasterizedSlides++;
          if (rasterResult.mode === "shapes") {
            rasterizedShapes++;
          }
        }
        const html = renderSlideHtml(source);

        return {
          i,
          progress: {
            type: "slide",
            index: i,
            html,
            source,
          } as ImportProgress,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        return { i, progress: { type: "error", error: `Slide ${i + 1}: ${errorMsg}` } as ImportProgress };
      }
    };

    const running = new Map<number, Promise<{ i: number; progress: ImportProgress }>>();
    const completed = new Map<number, ImportProgress>();
    let nextToYield = 0;
    let nextIndex = 0;
    let completedCount = 0;

    const startTask = (i: number) => {
      running.set(i, startSlideTask(i));
    };

    // Start initial batch of tasks (no progress yet - nothing completed)
    while (nextIndex < total && running.size < concurrency) {
      startTask(nextIndex++);
    }

    yield {
      type: "progress",
      current: 0,
      total,
      status: `Converting ${total} slides...`,
    };

    while (running.size > 0) {
      const raced = await Promise.race(
        Array.from(running.values()).map((p) => p)
      );
      running.delete(raced.i);
      const progress = raced.progress;
      completed.set(raced.i, progress);
      completedCount++;

      // Report progress based on completed slides
      yield {
        type: "progress",
        current: completedCount,
        total,
        status: `Converted ${completedCount} of ${total} slides...`,
      };

      // Start next task if available
      while (nextIndex < total && running.size < concurrency) {
        startTask(nextIndex++);
      }

      // Yield completed slides in order
      while (completed.has(nextToYield)) {
        const ordered = completed.get(nextToYield)!;
        completed.delete(nextToYield);
        if (ordered.type === "slide") {
          logInfo("Slide converted", {
            index: nextToYield,
            htmlLength: ordered.html?.length,
          });
        } else if (ordered.type === "error") {
          logError("Failed to convert slide", { index: nextToYield, error: ordered.error });
        }
        yield ordered;
        nextToYield++;
      }
    }

    yield {
      type: "done",
      status: `Imported ${total} slides`,
    };

    logInfo("Import completed", {
      total,
      masters: templateRegistry.masters.length,
      layouts: templateRegistry.layouts.length,
      rasterized: rasterizedSlides,
      rasterizedShapes,
    });
  } finally {
    // Cleanup temp files
    try {
      const cleanupDir = async (dir: string) => {
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
          // Ignore errors
        }
      };
      await cleanupDir(workDir);
      logInfo("Cleaned up import temp files", { workDir });
    } catch {
      logWarn("Failed to clean up import temp files", { workDir });
    }
  }
}
