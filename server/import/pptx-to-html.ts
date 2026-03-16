import { normalize } from "node:path";

import { generatePptxPreview } from "./preview";

async function main(): Promise<void> {
  const [, , pptxArg, outArg] = process.argv;
  if (!pptxArg) {
    throw new Error("Usage: bun server/import/pptx-to-html.ts <pptx-path> [output-dir]");
  }

  const result = await generatePptxPreview({
    pptxPath: normalize(pptxArg),
    outputDir: outArg ? normalize(outArg) : undefined,
  });

  console.log(
    [
      "Import summary:",
      `slides=${result.slideCount}`,
      `masters=${result.mastersCount}`,
      `layouts=${result.layoutsCount}`,
      `rasterized=${result.rasterizedSlides}`,
      `rasterizedShapes=${result.rasterizedShapes}`,
      `output=${result.outputDir}`,
    ].join(" ")
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
