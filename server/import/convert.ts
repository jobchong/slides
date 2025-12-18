import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

async function runCommand(
  command: string,
  args: string[],
  errorPrefix: string
): Promise<void> {
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

export async function convertPptxToPdf(
  pptxPath: string,
  outputDir: string
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const pptxName = basename(pptxPath, ".pptx");
  const pdfPath = join(outputDir, `${pptxName}.pdf`);

  if (!(await Bun.file(pdfPath).exists())) {
    await runCommand(
      "soffice",
      ["--headless", "--convert-to", "pdf", "--outdir", outputDir, pptxPath],
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

