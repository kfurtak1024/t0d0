import { expect, test, type Page } from "@playwright/test";
import { addItem, clearStorage, shape } from "./helpers";

/**
 * Where the composer says the next item is going.
 *
 * "Adding to" is a promise about the item you are about to add, so it has to be
 * right before you press Enter, not after.
 */

const tick = (page: Page, text: string) =>
  page.locator(".task", { hasText: text }).locator(".tick");

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("the row appears with the first group and names it", async ({ page }) => {
  await expect(page.locator("#destrow")).toBeHidden();

  await addItem(page, "# Morning");
  await expect(page.locator("#destrow")).toBeVisible();
  await expect(page.locator("#dest")).toHaveValue(/.+/);
  await expect(page.locator("#dest")).toHaveText(/Morning/);
});

/*
 * A new group takes the aim, so the items you type next land in the group you
 * just made — which is almost always what you were about to do.
 */
test("adding a group aims the composer at it", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await expect(
    page.locator(".group", { hasText: "Morning" }).locator(".items > .task"),
  ).toHaveCount(1);

  await addItem(page, "# Work");
  await expect(page.locator("#dest").locator("option:checked")).toHaveText("Work");
  await expect(page.locator('.group:has-text("Work") .plus')).toHaveClass(/aimed/);

  await addItem(page, "review the PR");
  await expect(page.locator(".group", { hasText: "Work" }).locator(".items > .task")).toHaveCount(
    1,
  );
});

/*
 * A group always lands at the root, so naming a group in "Adding to" while the
 * composer holds a `#` would be a promise the app then breaks.
 */
test("typing a # switches the row to Top level, and giving it up restores the aim", async ({
  page,
}) => {
  await addItem(page, "# Morning");
  await expect(page.locator("#dest").locator("option:checked")).toHaveText("Morning");

  await page.locator("#input").fill("# Work");
  await expect(page.locator("#dest").locator("option:checked")).toHaveText("Top level");

  // Display only: the aim is remembered, so deleting one character does not
  // cost you the group you had picked.
  await page.locator("#input").fill("water plants");
  await expect(page.locator("#dest").locator("option:checked")).toHaveText("Morning");

  await page.locator("#input").press("Enter");
  await expect(
    page.locator(".group", { hasText: "Morning" }).locator(".items > .task"),
  ).toHaveCount(1);
});

/*
 * A new group is work, so it goes with the work. Landing it at the end of a
 * tidied list buried it under the ticks, and the first thing you did with it
 * was drag it back up.
 *
 * The finished row has to be one the tidy actually moves, so that awaiting the
 * new shape proves the tidy has run. Ticking the last row instead leaves the
 * tidy pending, and it then sinks that row past the new group — reaching the
 * same arrangement by a route that hides whether the placement works at all.
 */
test("a new group lands above what is already finished", async ({ page }) => {
  for (const text of ["first", "second", "third"]) await addItem(page, text);

  await tick(page, "first").click();
  await expect.poll(() => shape(page)).toEqual(["second", "third", "first"]);

  await addItem(page, "# Morning");
  await expect.poll(() => shape(page)).toEqual(["second", "third", "# Morning", "first"]);

  // And the composer is aimed at it, so the next item goes inside.
  await addItem(page, "eat breakfast");
  await expect
    .poll(() => shape(page))
    .toEqual(["second", "third", "# Morning", "  eat breakfast", "first"]);
});

test("a group typed while one is aimed still lands at the root", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "# Work");

  // Two root groups, not one nested in the other — groups never nest.
  await expect(page.locator("#list > li.group")).toHaveCount(2);
});
