import { test, expect } from "@playwright/test";

test.describe("Export", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".slide")).toBeVisible();
  });

  test("should show exporting state during export", async ({ page }) => {
    // Mock the export endpoint to be slow
    await page.route("**/api/export", async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        body: Buffer.from("mock pptx content"),
      });
    });

    await page.click('button[aria-label="Export deck as PowerPoint file"]');

    // Should show exporting state
    await expect(page.locator('button[aria-label="Export deck as PowerPoint file"]')).toContainText(
      "Exporting..."
    );
    await expect(page.locator(".button-spinner")).toBeVisible();
  });

  test("should trigger download on successful export", async ({ page }) => {
    // Mock the export endpoint
    await page.route("**/api/export", async (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        body: Buffer.from("mock pptx content"),
      });
    });

    const downloadPromise = page.waitForEvent("download");
    await page.click('button[aria-label="Export deck as PowerPoint file"]');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("slides.pptx");
  });
});

test.describe("Import", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".slide")).toBeVisible();
  });

  test("should show import button", async ({ page }) => {
    await expect(page.locator('button[aria-label="Import PowerPoint file"]')).toBeVisible();
  });

  test("should have hidden file input", async ({ page }) => {
    const fileInput = page.locator('input[type="file"][accept=".pptx"]');
    await expect(fileInput).toBeAttached();
    await expect(fileInput).toBeHidden();
  });

  test("should show import progress modal during import", async ({ page }) => {
    // Mock the import endpoint to stream progress
    await page.route("**/api/import", async (route) => {
      const encoder = new TextEncoder();
      const body = encoder.encode(
        `data: ${JSON.stringify({ type: "progress", status: "Processing slide 1...", current: 1, total: 3 })}\n\n`
      );

      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: Buffer.from(body),
      });
    });

    // Trigger file input
    const fileInput = page.locator('input[type="file"][accept=".pptx"]');
    await fileInput.setInputFiles({
      name: "test.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from("mock pptx"),
    });

    // Should show import progress modal
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator("#import-progress-title")).toContainText("Importing Presentation");
  });

  test("should have cancel button in import progress", async ({ page }) => {
    await page.route("**/api/import", async (route) => {
      // Keep connection open
      await new Promise((r) => setTimeout(r, 10000));
    });

    const fileInput = page.locator('input[type="file"][accept=".pptx"]');
    await fileInput.setInputFiles({
      name: "test.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from("mock pptx"),
    });

    await expect(page.locator('button[aria-label="Cancel import"]')).toBeVisible();

    // Click cancel
    await page.click('button[aria-label="Cancel import"]');

    // Modal should close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });
});
