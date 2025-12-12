import { spawn } from "node:child_process";
import { mkdir, readdir, unlink, rmdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { logError, logInfo, logWarn } from "./logger";

const IMPORT_MODEL = "models/gemini-2.5-flash";

const IMPORT_SYSTEM_PROMPT = `You are converting a slide image to HTML. Output ONLY raw HTML that recreates the slide visually.

Rules:
- Use position: absolute on all elements with percentage-based top/left/right/bottom
- Use px for font-size, width, height
- Preserve the visual layout, colors, fonts, and positioning as closely as possible
- For images in the slide, use placeholder divs with background-color
- No markdown, no code fences, no explanations - just HTML
- The HTML will be rendered in a 16:9 container with position: relative

Example output format:
<div style="position: absolute; top: 10%; left: 5%; font-size: 48px; font-weight: 700; color: #1a1a2e;">
  Slide Title
</div>
<div style="position: absolute; top: 30%; left: 5%; font-size: 24px; color: #333;">
  • Bullet point one
</div>`;

interface ImportProgress {
  type: "progress" | "slide" | "error" | "done";
  current?: number;
  total?: number;
  status?: string;
  index?: number;
  html?: string;
  error?: string;
}

function requireGoogleApiKey(): string {
  const key =
    process.env.MODEL_API_KEY ||
    process.env.VITE_MODEL_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.VITE_GOOGLE_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_API_KEY (or MODEL_API_KEY) not set for import");
  }
  return key;
}

let googleClient: GoogleGenAI | null = null;
function getGoogleClient(): GoogleGenAI {
  if (!googleClient) {
    googleClient = new GoogleGenAI({ apiKey: requireGoogleApiKey() });
  }
  return googleClient;
}

async function convertPptxToImages(
  pptxPath: string,
  outputDir: string
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    // Use LibreOffice to convert PPTX to PDF first, then PDF to images
    // soffice --headless --convert-to pdf --outdir <outputDir> <pptxPath>
    const soffice = spawn("soffice", [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      outputDir,
      pptxPath,
    ]);

    let stderr = "";
    soffice.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    soffice.on("close", async (code) => {
      if (code !== 0) {
        logError("LibreOffice conversion failed", { code, stderr });
        reject(new Error(`LibreOffice conversion failed: ${stderr || `exit code ${code}`}`));
        return;
      }

      // Find the generated PDF
      const pptxName = basename(pptxPath, ".pptx");
      const pdfPath = join(outputDir, `${pptxName}.pdf`);

      // Convert PDF to images using pdftoppm (from poppler)
      const pdftoppm = spawn("pdftoppm", [
        "-png",
        "-r",
        "150", // 150 DPI - good balance of quality and size
        pdfPath,
        join(outputDir, "slide"),
      ]);

      let pdftoppmStderr = "";
      pdftoppm.stderr.on("data", (data) => {
        pdftoppmStderr += data.toString();
      });

      pdftoppm.on("close", async (pdfCode) => {
        if (pdfCode !== 0) {
          logError("pdftoppm conversion failed", { code: pdfCode, stderr: pdftoppmStderr });
          reject(new Error(`PDF to image conversion failed: ${pdftoppmStderr || `exit code ${pdfCode}`}`));
          return;
        }

        // Clean up PDF
        try {
          await unlink(pdfPath);
        } catch {
          // Ignore cleanup errors
        }

        // Find all generated PNG files
        try {
          const files = await readdir(outputDir);
          const pngFiles = files
            .filter((f) => f.endsWith(".png"))
            .sort() // slide-1.png, slide-2.png, etc.
            .map((f) => join(outputDir, f));

          if (pngFiles.length === 0) {
            reject(new Error("No slide images generated"));
            return;
          }

          logInfo("PPTX converted to images", { count: pngFiles.length });
          resolve(pngFiles);
        } catch (err) {
          reject(err);
        }
      });

      pdftoppm.on("error", (err) => {
        logError("pdftoppm spawn error", { error: err.message });
        reject(new Error(`Failed to run pdftoppm: ${err.message}. Is poppler installed?`));
      });
    });

    soffice.on("error", (err) => {
      logError("LibreOffice spawn error", { error: err.message });
      reject(new Error(`Failed to run LibreOffice: ${err.message}. Is LibreOffice installed?`));
    });
  });
}

async function convertImageToHtml(imagePath: string): Promise<string> {
  const imageData = await readFile(imagePath);
  const base64Image = imageData.toString("base64");

  const client = getGoogleClient();
  const response = await client.models.generateContent({
    model: IMPORT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image,
            },
          },
          {
            text: "Convert this slide to HTML. Output ONLY the HTML, no explanations.",
          },
        ],
      },
    ],
    config: {
      systemInstruction: IMPORT_SYSTEM_PROMPT,
      maxOutputTokens: 4096,
    },
  });

  return response.text?.trim() ?? "";
}

export async function* importPptx(
  pptxPath: string,
  tempDir: string
): AsyncGenerator<ImportProgress> {
  const importId = crypto.randomUUID();
  const workDir = join(tempDir, `import-${importId}`);

  try {
    yield { type: "progress", status: "Converting PPTX to images..." };

    const imagePaths = await convertPptxToImages(pptxPath, workDir);
    const total = imagePaths.length;

    logInfo("Starting slide conversion", { total, importId });

    for (let i = 0; i < imagePaths.length; i++) {
      yield {
        type: "progress",
        current: i + 1,
        total,
        status: `Converting slide ${i + 1} of ${total}...`,
      };

      try {
        const html = await convertImageToHtml(imagePaths[i]);
        yield { type: "slide", index: i, html };
        logInfo("Slide converted", { index: i, htmlLength: html.length });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        logError("Failed to convert slide", { index: i, error: errorMsg });
        yield { type: "error", error: `Slide ${i + 1}: ${errorMsg}` };
      }
    }

    yield { type: "done", status: `Imported ${total} slides` };
  } finally {
    // Cleanup temp files
    try {
      const files = await readdir(workDir);
      for (const file of files) {
        await unlink(join(workDir, file));
      }
      await rmdir(workDir);
      logInfo("Cleaned up import temp files", { workDir });
    } catch {
      logWarn("Failed to clean up import temp files", { workDir });
    }
  }
}
