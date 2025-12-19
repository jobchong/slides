import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

async function runCommand(
  command: string,
  args: string[],
  errorPrefix: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, {
      env: {
        ...process.env,
        SAL_USE_VCLPLUGIN: "svp",
        SAL_DISABLE_OPENGL: "true",
        LIBO_HEADLESS: "1",
      },
    });
    let stderr = "";
    let stdout = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
        reject(new Error(`${errorPrefix}: ${detail}`));
        return;
      }
      resolve();
    });

    proc.on("error", (err) => {
      reject(new Error(`${errorPrefix}: ${err.message}`));
    });
  });
}

export async function convertPptxToPdf(
  pptxPath: string,
  outputDir: string
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const pptxName = basename(pptxPath, ".pptx");
  const pdfPath = join(outputDir, `${pptxName}.pdf`);
  const profileDir = join(outputDir, ".lo-profile");
  await mkdir(profileDir, { recursive: true });
  const profileUrl = pathToFileURL(profileDir).href;
  const macSoffice = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  const sofficeCommand = existsSync(macSoffice) ? macSoffice : "soffice";

  if (!(await Bun.file(pdfPath).exists())) {
    await runCommand(
      sofficeCommand,
      [
        "--headless",
        "--nologo",
        "--nolockcheck",
        "--nodefault",
        "--norestore",
        `-env:UserInstallation=${profileUrl}`,
        "--convert-to",
        "pdf",
        "--outdir",
        outputDir,
        pptxPath,
      ],
      "LibreOffice conversion failed"
    );
  }

  return pdfPath;
}

export async function convertPdfPageToPng(
  pdfPath: string,
  pageIndex: number,
  outputDir: string,
  outBasename: string,
  dpi = 150
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const outPath = join(outputDir, `${outBasename}.png`);

  if (!(await Bun.file(outPath).exists())) {
    await runCommand(
      "pdftoppm",
      [
        "-png",
        "-r",
        String(dpi),
        "-f",
        String(pageIndex + 1),
        "-l",
        String(pageIndex + 1),
        "-singlefile",
        pdfPath,
        join(outputDir, outBasename),
      ],
      "pdftoppm failed"
    );
  }

  return outPath;
}
