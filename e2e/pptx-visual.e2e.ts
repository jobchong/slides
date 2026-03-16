import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pptxPath = path.resolve(__dirname, "..", "ppts", "test1.pptx");

test.describe("PPTX visual import", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("renders imported PPTX slide consistently through the app import flow", async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("http://localhost:4000");
    await expect(page.locator(".slide")).toBeVisible();

    const importDialog = page.getByRole("dialog", { name: "Importing Presentation" });
    const fileInput = page.locator('input[type="file"][accept=".pptx"]');
    await fileInput.setInputFiles(pptxPath);

    await importDialog.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    await importDialog.waitFor({ state: "hidden", timeout: 120000 }).catch(() => {});

    const slideContent = page.locator('.slide [data-slide-source="true"]');
    await expect(slideContent).toBeVisible({ timeout: 120000 });

    await page.waitForFunction(() => {
      const raw = localStorage.getItem("slideai:deck:v1");
      if (!raw) return false;

      try {
        const state = JSON.parse(raw);
        return (
          Array.isArray(state.slides) &&
          state.slides.length === 1 &&
          typeof state.slides[0]?.html === "string" &&
          state.slides[0].html.includes('data-slide-source="true"')
        );
      } catch {
        return false;
      }
    });

    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          });
        })
      );

      if (document.fonts) {
        await document.fonts.ready;
      }
    });

    await expect(page.locator(".slide")).toHaveScreenshot("pptx-import-test1.png", {
      animations: "disabled",
    });
  });
});
