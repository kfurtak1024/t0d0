import { expect, test } from "@playwright/test";
import { clearStorage, addItem } from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("adds, ticks, and reports progress", async ({ page }) => {
  await addItem(page, "shopping");
  await addItem(page, "laundry");

  await expect(page.locator(".list .task")).toHaveCount(2);
  await expect(page.locator("#frac")).toHaveText("0 of 2");

  await page.locator(".task", { hasText: "shopping" }).locator(".ring").click();

  await expect(page.locator(".task", { hasText: "shopping" })).toHaveClass(/done/);
  await expect(page.locator("#frac")).toHaveText("1 of 2");
});

test("a counted item needs one tap per unit", async ({ page }) => {
  await addItem(page, "make calls [3]");

  const row = page.locator(".task", { hasText: "make calls" });
  await expect(row.locator(".count")).toHaveText("0/3");
  await expect(row.locator(".label")).toContainText("[3]");

  for (let i = 0; i < 3; i++) await row.locator(".ring").click();

  await expect(row.locator(".count")).toHaveText("3/3");
  await expect(row).toHaveClass(/done/);
});

test("tapping the count steps back down", async ({ page }) => {
  await addItem(page, "make calls [3]");
  const row = page.locator(".task", { hasText: "make calls" });

  await row.locator(".ring").click();
  await row.locator(".ring").click();
  await expect(row.locator(".count")).toHaveText("2/3");

  await row.locator(".count").click();
  await expect(row.locator(".count")).toHaveText("1/3");
});

test("groups hold their items and report their own count", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  const group = page.locator(".group", { hasText: "Morning" });
  await expect(group.locator(".items .task")).toHaveCount(2);
  await expect(group.locator(".gcount")).toHaveText("0/2");

  await group.locator(".task", { hasText: "eat breakfast" }).locator(".ring").click();
  await expect(group.locator(".gcount")).toHaveText("1/2");
});

test("the destination picker appears with the first group and steers new items", async ({
  page,
}) => {
  await addItem(page, "shopping");
  await expect(page.locator("#destrow")).toBeHidden();

  await addItem(page, "# Morning");
  await expect(page.locator("#destrow")).toBeVisible();
  await expect(page.locator("#dest")).toHaveValue(/.+/);

  // Back to the root, and the next item lands outside the group.
  await page.locator("#dest").selectOption("");
  await addItem(page, "loose");
  await expect(page.locator(".list > .task", { hasText: "loose" })).toBeVisible();
});

test("the day closes with a summary and clears the ticks", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  await page.locator(".task", { hasText: "eat breakfast" }).locator(".ring").click();
  await page.locator("#closeday").click();

  const sheet = page.locator("#veil");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".score")).toHaveText("1 of 2");

  await sheet.locator(".confirm").click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#frac")).toHaveText("0 of 2");
  await expect(page.locator(".list .task")).toHaveCount(2);
});

test("deleting is undoable", async ({ page }) => {
  await addItem(page, "shopping");
  const row = page.locator(".task", { hasText: "shopping" });

  await row.hover();
  await row.locator(".kill").click();
  await expect(page.locator(".list .task")).toHaveCount(0);

  await page.locator(".toast-action").click();
  await expect(page.locator(".task", { hasText: "shopping" })).toBeVisible();
});

test("the closer only appears once there is something to close", async ({ page }) => {
  await expect(page.locator("#closeday")).toBeHidden();
  await addItem(page, "shopping");
  await expect(page.locator("#closeday")).toBeVisible();
});

test("a finished top-level item gets the same green frame as a cleared group", async ({ page }) => {
  await addItem(page, "shopping");
  const row = page.locator(".list > .task", { hasText: "shopping" });

  const plain = await row.evaluate((el) => getComputedStyle(el).boxShadow);
  await row.locator(".ring").click();
  await expect(row).toHaveClass(/done/);

  const finished = await row.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(finished).not.toBe(plain);
  // Same completion green the group frame uses.
  expect(finished).toMatch(/oklch/);
});
