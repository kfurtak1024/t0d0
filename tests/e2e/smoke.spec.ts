import { expect, test } from "./fixtures";
import { clearStorage, addItem, rowOf, tickOf } from "./helpers";

/*
 * The one path every change must keep working: add a row, tick it, and see the
 * day report it.
 */

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("adds, ticks, and reports progress", async ({ page }) => {
  await addItem(page, "shopping");
  await addItem(page, "laundry");

  await expect(page.locator(".list .task")).toHaveCount(2);
  await expect(page.locator("#frac")).toHaveText("0 of 2");

  await tickOf(page, "shopping").click();

  await expect(rowOf(page, "shopping")).toHaveClass(/done/);
  await expect(page.locator("#frac")).toHaveText("1 of 2");
});
