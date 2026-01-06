import { test, expect } from "@playwright/test";

test.describe("Slide Operations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for app to be ready
    await expect(page.locator(".slide")).toBeVisible();
  });

  test("should display initial empty slide", async ({ page }) => {
    await expect(page.locator(".slide-thumbnail")).toHaveCount(1);
    await expect(page.locator(".slide")).toBeVisible();
  });

  test("should add a new slide", async ({ page }) => {
    await page.click('button[aria-label="Add new slide after current"]');
    await expect(page.locator(".slide-thumbnail")).toHaveCount(2);
  });

  test("should delete a slide", async ({ page }) => {
    // Add a second slide first
    await page.click('button[aria-label="Add new slide after current"]');
    await expect(page.locator(".slide-thumbnail")).toHaveCount(2);

    // Delete the second slide
    await page.click('[aria-label="Delete slide 2"]');
    await expect(page.locator(".slide-thumbnail")).toHaveCount(1);
  });

  test("should not delete last remaining slide", async ({ page }) => {
    // The delete button should not be visible when there's only one slide
    await expect(page.locator('[aria-label="Delete slide 1"]')).not.toBeVisible();
  });

  test("should duplicate a slide", async ({ page }) => {
    await page.click('button[aria-label="Duplicate current slide"]');
    await expect(page.locator(".slide-thumbnail")).toHaveCount(2);
  });

  test("should select slide by clicking thumbnail", async ({ page }) => {
    // Add slides
    await page.click('button[aria-label="Add new slide after current"]');
    await page.click('button[aria-label="Add new slide after current"]');
    await expect(page.locator(".slide-thumbnail")).toHaveCount(3);

    // Click first thumbnail
    await page.click('[aria-label="Slide 1"]');
    await expect(page.locator('[aria-label="Slide 1, selected"]')).toBeVisible();
  });

  test("should show slide navigation indicator", async ({ page }) => {
    await page.click('button[aria-label="Add new slide after current"]');
    await expect(page.locator(".slide-navigation")).toContainText("2 / 2");

    await page.click('[aria-label="Slide 1"]');
    await expect(page.locator(".slide-navigation")).toContainText("1 / 2");
  });
});
