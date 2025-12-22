import { normalize } from "node:path";

import { extractTemplatesFromPptx } from "./template-parser";

async function main(): Promise<void> {
  const [, , pptxArg] = process.argv;
  if (!pptxArg) {
    throw new Error("Usage: bun server/import/pptx-to-templates.ts <pptx-path>");
  }

  const templates = await extractTemplatesFromPptx(normalize(pptxArg));
  console.log(JSON.stringify(templates, null, 2));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
