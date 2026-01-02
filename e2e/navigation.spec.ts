import { test, expect } from "@playwright/test";

test.describe("Keyboard Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".slide")).toBeVisible();

    // Add multiple slides for navigation testing
    await page.click('button[aria-label="Add new slide after current"]');
    await page.click('button[aria-label="Add new slide after current"]');
    await expect(page.locator(".slide-thumbnail")).toHaveCount(3);
  });

  test("should navigate with arrow keys", async ({ page }) => {
    // Start at slide 3
    await expect(page.locator(".slide-navigation")).toContainText("3 / 3");

    // Navigate left
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".slide-navigation")).toContainText("2 / 3");

    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".slide-navigation")).toContainText("1 / 3");

    // Navigate right
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".slide-navigation")).toContainText("2 / 3");
  });

  test("should not go past first slide", async ({ page }) => {
    // Go to first slide
    await page.keyboard.press("Home");
    await expect(page.locator(".slide-navigation")).toContainText("1 / 3");

    // Try to go further left
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".slide-navigation")).toContainText("1 / 3");
  });

  test("should not go past last slide", async ({ page }) => {
    // Already at last slide (3)
    await expect(page.locator(".slide-navigation")).toContainText("3 / 3");

    // Try to go further right
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".slide-navigation")).toContainText("3 / 3");
  });

  test("should jump to first slide with Home", async ({ page }) => {
    await expect(page.locator(".slide-navigation")).toContainText("3 / 3");
    await page.keyboard.press("Home");
    await expect(page.locator(".slide-navigation")).toContainText("1 / 3");
  });

  test("should jump to last slide with End", async ({ page }) => {
    await page.keyboard.press("Home");
    await expect(page.locator(".slide-navigation")).toContainText("1 / 3");

    await page.keyboard.press("End");
    await expect(page.locator(".slide-navigation")).toContainText("3 / 3");
  });

  test("should add slide with Ctrl+M", async ({ page }) => {
    await page.keyboard.press("Control+m");
    await expect(page.locator(".slide-thumbnail")).toHaveCount(4);
  });

  test("should add slide with Meta+M on Mac", async ({ page }) => {
    await page.keyboard.press("Meta+m");
    await expect(page.locator(".slide-thumbnail")).toHaveCount(4);
  });
});

test.describe("Click Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".slide")).toBeVisible();

    // Add slides
    await page.click('button[aria-label="Add new slide after current"]');
    await page.click('button[aria-label="Add new slide after current"]');
  });

  test("should navigate with prev/next buttons", async ({ page }) => {
    await expect(page.locator(".slide-navigation")).toContainText("3 / 3");

    await page.click('[aria-label="Previous slide"]');
    await expect(page.locator(".slide-navigation")).toContainText("2 / 3");

    await page.click('[aria-label="Previous slide"]');
    await expect(page.locator(".slide-navigation")).toContainText("1 / 3");

    await page.click('[aria-label="Next slide"]');
    await expect(page.locator(".slide-navigation")).toContainText("2 / 3");
  });
});
