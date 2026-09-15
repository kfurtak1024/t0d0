import { expect, test, type Page } from "@playwright/test";
import { addItem, buildList, clearStorage, shape } from "./helpers";

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
 * The destination is a place, not a switch. Pressing `+` on the group you are
 * already aiming at used to throw the aim back to the root, and the press that
 * did it is indistinguishable from the press that set it.
 */
test("pressing + on the group already aimed at leaves the aim where it is", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "# Work");
  const plus = page.locator('.group:has-text("Morning") .plus');

  await plus.click();
  await expect(page.locator("#dest").locator("option:checked")).toHaveText("Morning");

  await plus.click();
  await expect(page.locator("#dest").locator("option:checked")).toHaveText("Morning");
  await expect(plus).toHaveClass(/aimed/);

  // And the row that means it still does: the select is the way back.
  await page.locator("#dest").selectOption("");
  await expect(plus).not.toHaveClass(/aimed/);
  await addItem(page, "loose");
  expect(await shape(page)).toEqual(["loose", "# Work", "# Morning"]);
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
 * Everything new lands at the top, so nothing new can land under the pile. A
 * row pushed onto the end used to land *below* the finished rows, which left an
 * unfinished row at the foot of the list — and the split is the trailing run of
 * finished rows, so every row the tidy had sent down jumped back above the
 * ending the moment you added anything.
 *
 * The finished row has to be one the tidy actually moves, so that awaiting the
 * new shape proves the tidy has run. Ticking the last row instead leaves the
 * tidy pending, and the row then travels afterwards — reaching an arrangement
 * by a route that hides whether the placement works at all.
 */
test("a new row lands at the top, and leaves the pile where it is", async ({ page }) => {
  await buildList(page, ["first", "second", "third"]);

  await tick(page, "first").click();
  await expect.poll(() => shape(page)).toEqual(["second", "third", "first"]);
  await expect(page.locator("#donelist > .task")).toHaveCount(1);

  await addItem(page, "# Morning");
  await expect.poll(() => shape(page)).toEqual(["# Morning", "second", "third", "first"]);
  // Undisturbed: the finished row is still below the ending, where it settled.
  await expect(page.locator("#donelist > .task")).toHaveCount(1);

  // And the composer is aimed at it, so the next item goes inside.
  await addItem(page, "eat breakfast");
  await expect
    .poll(() => shape(page))
    .toEqual(["# Morning", "  eat breakfast", "second", "third", "first"]);
});

test("a group typed while one is aimed still lands at the root", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "# Work");

  // Two root groups, not one nested in the other — groups never nest.
  await expect(page.locator("#list > li.group")).toHaveCount(2);
});
