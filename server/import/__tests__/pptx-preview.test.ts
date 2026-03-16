import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { generatePptxPreview } from "../preview";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pptxDir = join(repoRoot, "ppts");

describe("PPTX preview generation", () => {
  test("includes slide, master, and layout preview sections for template fixtures", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "slideai-preview-"));
    const pptxPath = join(pptxDir, "template1.pptx");

    try {
      const result = await generatePptxPreview({
        pptxPath,
        outputDir,
      });

      expect(result.slideCount).toBeGreaterThan(0);
      expect(result.mastersCount).toBeGreaterThan(0);
      expect(result.layoutsCount).toBeGreaterThan(0);

      expect(result.sections.filter((section) => section.kind === "slide")).toHaveLength(result.slideCount);
      expect(result.sections.filter((section) => section.kind === "master")).toHaveLength(result.mastersCount);
      expect(result.sections.filter((section) => section.kind === "layout")).toHaveLength(result.layoutsCount);

      const html = await readFile(result.indexHtmlPath, "utf-8");
      expect(html).toContain('data-section-id="slide-01"');
      expect(html).toContain('data-template-kind="master"');
      expect(html).toContain('data-template-kind="layout"');
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
