import { spawn } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { SlideSource } from "./types";
import { convertPdfPageToPng, convertPptxToPdf } from "./convert";

type SaveImage = (filePath: string, baseName: string, ext: string) => Promise<string>;

type RasterizeSlideParams = {
  source: SlideSource;
  slideIndex: number;
  pptxPath: string;
  workDir: string;
  saveImage: SaveImage;
  getPdfPath?: () => Promise<string>;
};

type RasterizeResult = {
  source: SlideSource;
  rasterized: boolean;
  mode: "shapes" | null;
};

type CommandSpec = { command: string; args: string[] };

async function runCommand(
  command: string,
  args: string[],
  errorPrefix: string,
  withOutput = false
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(command, args);
    let stderr = "";
    let stdout = "";
    if (withOutput) {
      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${errorPrefix}: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
    proc.on("error", (err) => {
      reject(err);
    });
  });
}

async function runFirstAvailable(commands: CommandSpec[], errorPrefix: string, withOutput = false): Promise<string> {
  let lastError: unknown = null;
  for (const { command, args } of commands) {
    try {
      return await runCommand(command, args, errorPrefix, withOutput);
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

async function getImageSize(imagePath: string): Promise<{ width: number; height: number }> {
  const stdout = await runFirstAvailable(
    [
      { command: "magick", args: ["identify", "-format", "%w %h", imagePath] },
      { command: "identify", args: ["-format", "%w %h", imagePath] },
    ],
    "Image identify failed",
    true
  );
  const match = stdout.trim().match(/(\d+)\s+(\d+)/);
  if (!match) {
    throw new Error(`Failed to read image size for ${imagePath}`);
  }
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
}

async function cropImage(
  srcPath: string,
  destPath: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  await runFirstAvailable(
    [
      {
        command: "magick",
        args: ["convert", srcPath, "-crop", `${width}x${height}+${x}+${y}`, "+repage", destPath],
      },
      {
        command: "convert",
        args: [srcPath, "-crop", `${width}x${height}+${x}+${y}`, "+repage", destPath],
      },
    ],
    "Image crop failed"
  );
}

export async function rasterizeSlideIfNeeded({
  source,
  slideIndex,
  pptxPath,
  workDir,
  saveImage,
  getPdfPath,
}: RasterizeSlideParams): Promise<RasterizeResult> {
  const rasterizableShapes = source.elements.filter(
    (el) =>
      el.type === "shape" &&
      el.shape?.kind === "custom" &&
      (!el.shape.svgPath || !el.shape.svgViewBox)
  );

  if (rasterizableShapes.length === 0) {
    return { source, rasterized: false, mode: null };
  }

  const pdfPath = getPdfPath
    ? await getPdfPath()
    : await convertPptxToPdf(pptxPath, workDir);
  const slidePng = await convertPdfPageToPng(
    pdfPath,
    slideIndex,
    workDir,
    `slide-${slideIndex + 1}`,
    200
  );

  const { width: imgWidth, height: imgHeight } = await getImageSize(slidePng);
  const elementImages = new Map<string, string>();
  for (const shapeElement of rasterizableShapes) {
    const bounds = shapeElement.bounds;
    const cropX = Math.max(0, Math.round((bounds.x / 100) * imgWidth));
    const cropY = Math.max(0, Math.round((bounds.y / 100) * imgHeight));
    const cropW = Math.max(1, Math.round((bounds.width / 100) * imgWidth));
    const cropH = Math.max(1, Math.round((bounds.height / 100) * imgHeight));

    const cropPath = join(workDir, `shape-${slideIndex + 1}-${randomUUID()}.png`);
    await cropImage(slidePng, cropPath, cropX, cropY, cropW, cropH);
    const url = await saveImage(cropPath, `shape-${slideIndex + 1}`, "png");
    elementImages.set(shapeElement.id, url);
  }

  return {
    source: {
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
    },
    rasterized: true,
    mode: "shapes",
  };
}
