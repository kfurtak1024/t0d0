import { expect, test } from "./fixtures";
import { clearStorage, addItem, groupOf, rowOf } from "./helpers";

/*
 * Groups and the list they sit in: counts, the destination picker, folding,
 * and the roles that make it a list.
 */

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("groups hold their items and report their own count", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  const group = groupOf(page, "Morning");
  await expect(group.locator(".items .task")).toHaveCount(2);
  await expect(group.locator(".gcount")).toHaveText("0/2");

  await group.getByRole("checkbox", { name: "eat breakfast", exact: true }).click();
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
  await expect(rowOf(page, "loose", ".list > .task")).toBeVisible();
});

test("an empty group says only that it is a group", async ({ page }) => {
  await addItem(page, "# Later");

  await page.locator(".ghead > .dots").click();
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toHaveText("Delete group");
});

test("a collapsed group leaves the tab order", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");

  const hidden = page.locator(".items [data-id] .tick").first();
  await expect(hidden).toBeVisible();

  await page.locator(".chev").click();
  await expect(page.locator(".group")).toHaveClass(/collapsed/);
  await expect(page.locator(".gbody")).toHaveAttribute("inert", "");

  // Not merely invisible — unreachable.
  const reachable = await page.evaluate(() => {
    const tick = document.querySelector<HTMLElement>(".items [data-id] .tick");
    tick?.focus();
    return document.activeElement === tick;
  });
  expect(reachable).toBe(false);
});

test("the list is a list", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");

  await expect(page.locator("#list")).toHaveRole("list");
  await expect(page.locator("#list > li")).toHaveCount(1);
  await expect(page.locator(".items > li")).toHaveCount(1);
});
