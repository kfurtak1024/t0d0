import { expect, test } from "./fixtures";
import { clearStorage, addItem, landReveal, tickOf } from "./helpers";

/*
 * The closer: when it appears, and the card it opens on the day.
 */

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("the day closes with a summary and clears the ticks", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  await tickOf(page, "eat breakfast").click();
  await page.locator("#closeday").click();

  const sheet = page.locator("#veil");
  await expect(sheet).toBeVisible();
  await landReveal(page);
  await expect(sheet.locator(".score")).toHaveText("1 of 2");

  await sheet.locator(".confirm").click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#frac")).toHaveText("0 of 2");
  await expect(page.locator(".list .task")).toHaveCount(2);
});

test("the closer only appears once there is something to close", async ({ page }) => {
  await expect(page.locator("#closeday")).toBeHidden();
  await addItem(page, "shopping");
  await expect(page.locator("#closeday")).toBeVisible();
});

test("the day card does not open with the destructive button focused", async ({ page }) => {
  await addItem(page, "shopping");
  await page.locator(".tick").first().click();
  await page.locator("#closeday").click();

  await expect(page.locator("#veil")).toBeVisible();
  const onConfirm = await page.evaluate(
    () => document.activeElement?.classList.contains("confirm") ?? false,
  );
  expect(onConfirm).toBe(false);

  // Enter on open must not clear the day.
  await page.keyboard.press("Enter");
  await expect(page.locator("#frac")).toHaveText("1 of 1");
});
