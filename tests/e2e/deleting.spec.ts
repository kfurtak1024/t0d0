import { type Locator, type Page } from "@playwright/test";
import { expect, test, passExit } from "./fixtures";
import { clearStorage, addItem, rowOf, tickOf } from "./helpers";

/*
 * Deleting a row, and the one level of undo that makes a single press safe.
 */

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

/**
 * Delete a row through the ⋯ menu, which is the only route to it.
 *
 * It used to be a ✕ on the row, which cost every row a 25.6px column whether or
 * not it was visible — a fifth of a nested label on a phone. Undo is what makes
 * one press safe enough to need no confirm, and these tests lean on that.
 */
const deleteRow = async (page: Page, row: Locator): Promise<void> => {
  await row.locator(".dots").click();
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
};

test("deleting is undoable", async ({ page }) => {
  await addItem(page, "shopping");
  const row = rowOf(page, "shopping");

  await deleteRow(page, row);
  await passExit(page);
  await expect(page.locator(".list .task")).toHaveCount(0);

  await page.locator(".toast-action").click();
  await expect(rowOf(page, "shopping")).toBeVisible();
});

/*
 * The row carries no ✕ of its own. It cost every row a 25.6px column whether or
 * not it was visible — opacity hides a control, it does not un-reserve its
 * space — which on a phone was a fifth of a nested row's label and a third of a
 * counted one's.
 */
test("a row has no delete button of its own", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "shopping");

  await expect(page.locator(".list .kill")).toHaveCount(0);
  await expect(page.locator(".list .dots")).toHaveCount(2);
});

/*
 * A group takes its items with it, and they do not come back on their own — so
 * the entry says so, the same way the one-off entry names its consequence
 * rather than its mark.
 */
test("the menu's delete entry names what a group takes with it", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  await page.locator(".ghead > .dots").click();
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toHaveText(
    "Delete group and 2 items",
  );
  await page.keyboard.press("Escape");

  // A plain row has nothing to take with it, so it just says Delete.
  await page.locator(".items > .task").first().locator(".dots").click();
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toHaveText("Delete");
});

/*
 * A nested row leaves the same way a root one does. `#rows` holds only the top
 * level, so looking for the row there found nothing for a task inside a group
 * and it vanished outright — the CSS had dressed it for the exit all along.
 */
test("a row inside a group leaves with the same animation as one outside", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");

  const row = rowOf(page, "eat breakfast", ".items > .task");
  await row.locator(".dots").click();
  await page.getByRole("menuitem", { name: /^Delete/ }).click();

  await expect(row).toHaveClass(/leaving/);
  await passExit(page);
  await expect(page.locator(".items > .task")).toHaveCount(0);
});

test("undo during a nested row's exit puts it back", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  const row = rowOf(page, "eat breakfast", ".items > .task");
  await row.locator(".dots").click();
  await page.getByRole("menuitem", { name: /^Delete/ }).click();

  /*
   * Undo has to land *inside* the exit, or this says nothing: undo puts the row
   * back either way, and only the pending state tells the two apart. Without
   * the row being found at all there is no pending delete and no class.
   */
  await expect(row).toHaveClass(/leaving/);
  await page.keyboard.press("Control+z");

  await expect(row).toBeVisible();
  await expect(row).not.toHaveClass(/leaving/);
  await expect(page.locator(".items > .task")).toHaveCount(2);
});

/*
 * The toast offers the undo and then gets out of the way. Nothing else takes it
 * down, so if the countdown stops working it would sit over the composer for
 * the rest of the session.
 */
test("the toast takes itself away", async ({ page }) => {
  await addItem(page, "shopping");
  const row = rowOf(page, "shopping");

  await deleteRow(page, row);
  await expect(page.locator("#toast")).toBeVisible();

  /*
   * The toast fades out rather than leaving the layout — it keeps its box so it
   * can animate — so "gone" is opacity and pointer-events, not visibility.
   * Waits longer than the countdown, and resolves the moment it goes.
   */
  await expect
    .poll(
      () =>
        page
          .locator("#toast")
          .evaluate((el) => [getComputedStyle(el).opacity, getComputedStyle(el).pointerEvents]),
      { timeout: 9000 },
    )
    .toEqual(["0", "none"]);
  // The undo outlives its toast: the offer expired, the state did not.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(rowOf(page, "shopping")).toBeVisible();
});

test("undo during the delete animation puts the item back", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  const row = rowOf(page, "alpha");
  await deleteRow(page, row);
  await page.keyboard.press("Control+z"); // inside the exit animation

  await expect(rowOf(page, "alpha")).toBeVisible();
  await expect(rowOf(page, "alpha")).not.toHaveClass(/leaving/);
  await expect(page.locator(".list .task")).toHaveCount(2);
});

test("deleting the last undone item still finishes the day", async ({ page }) => {
  await addItem(page, "done one");
  await addItem(page, "not yet");
  await tickOf(page, "done one").click();

  await page.evaluate(() => {
    (window as unknown as { draws: number }).draws = 0;
    const ctx = (document.getElementById("confetti") as HTMLCanvasElement).getContext("2d");
    if (ctx) {
      const original = ctx.fillRect.bind(ctx);
      ctx.fillRect = (...args: Parameters<typeof original>) => {
        (window as unknown as { draws: number }).draws++;
        original(...args);
      };
    }
  });

  const row = rowOf(page, "not yet");
  await deleteRow(page, row);
  await passExit(page);

  await expect(page.locator("#frac")).toHaveText("1 of 1");
  // The shower draws on animation frames, which a held clock runs only when
  // it is advanced.
  await page.clock.runFor(1000);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { draws: number }).draws))
    .toBeGreaterThan(0);
});
