import { expect, test } from "@playwright/test";
import { addItem, clearStorage, seedStorage } from "./helpers";

/**
 * The `!` mark, end to end. The parser's own rules are unit-tested; what only a
 * browser can check is that the mark reaches the row, survives being edited and
 * reloaded, and never leaks into the text you see.
 */

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("a trailing ! marks an item, and stays out of its text", async ({ page }) => {
  await addItem(page, "call the bank!");
  await addItem(page, "water plants");

  const marked = page.locator(".task", { hasText: "call the bank" });
  await expect(marked).toHaveClass(/important/);
  await expect(marked.locator(".label")).toHaveText("call the bank");
  await expect(marked.locator(".tick")).toHaveAttribute("aria-label", "call the bank, important");

  await expect(page.locator(".task", { hasText: "water plants" })).not.toHaveClass(/important/);
});

test("a trailing ! marks a group", async ({ page }) => {
  await addItem(page, "# Morning!");

  const group = page.locator(".group");
  await expect(group).toHaveClass(/important/);
  await expect(group.locator(".gtitle")).toHaveText("Morning");
  await expect(group.locator(".chev")).toHaveAttribute("aria-label", "Collapse Morning, important");
});

test("the mark and a count are independent", async ({ page }) => {
  await addItem(page, "make calls [3]!");

  const row = page.locator(".task", { hasText: "make calls" });
  await expect(row).toHaveClass(/important/);
  await expect(row.locator(".count")).toHaveText("0/3");
});

/*
 * The composer and inline editing have to agree, or the first edit of a marked
 * row silently unmarks it — which is the bug this round-trip exists to catch.
 */
test("editing a row shows the mark again, and can take it off", async ({ page }) => {
  await addItem(page, "make calls [3]!");
  const row = page.locator(".task", { hasText: "make calls" });

  await row.locator(".label").click();
  await expect(row.locator(".label")).toHaveText("make calls! [3]");

  // Commit unchanged: the row must come back exactly as it went in.
  await row.locator(".label").press("Enter");
  await expect(row).toHaveClass(/important/);
  await expect(row.locator(".count")).toHaveText("0/3");

  await row.locator(".label").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("make calls [3]");
  await page.keyboard.press("Enter");
  await expect(row).not.toHaveClass(/important/);
  await expect(row.locator(".count")).toHaveText("0/3");
});

test("a group title round-trips its mark too", async ({ page }) => {
  await addItem(page, "# Morning!");
  const title = page.locator(".group .gtitle");

  await title.click();
  await expect(title).toHaveText("Morning!");
  await title.press("Enter");
  await expect(page.locator(".group")).toHaveClass(/important/);
});

test("the mark survives a reload", async ({ page }) => {
  await addItem(page, "call the bank!");
  await page.reload();

  await expect(page.locator(".task", { hasText: "call the bank" })).toHaveClass(/important/);
});

/*
 * A list written before the mark existed carries no field at all. It must load
 * unmarked rather than come back flagged — the schema version did not move, so
 * normalize() defaulting is the whole migration.
 */
test("a list from before the mark loads unmarked", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [{ kind: "task", id: "a", text: "shopping", target: 1, count: 0 }],
  });

  await expect(page.locator(".task", { hasText: "shopping" })).not.toHaveClass(/important/);
});

/*
 * The mark stands down while a row is finished, but it is not spent: the flag is
 * still stored, so a mis-tap does not quietly cost you it.
 */
test("ticking a marked item keeps the mark, and unticking brings it back", async ({ page }) => {
  await addItem(page, "call the bank!");
  const row = page.locator(".task", { hasText: "call the bank" });
  const tick = row.locator(".tick");

  await tick.click();
  await expect(row).toHaveClass(/done/);
  await expect(row).toHaveClass(/important/);

  await tick.click();
  await expect(row).not.toHaveClass(/done/);
  await expect(row).toHaveClass(/important/);
  await page.reload();
  await expect(page.locator(".task", { hasText: "call the bank" })).toHaveClass(/important/);
});

/*
 * The mark is a mark: it says nothing about where the row belongs. A finished
 * one gets out of the way exactly like any other.
 */
test("a marked item still sinks when it is finished", async ({ page }) => {
  await addItem(page, "call the bank!");
  await addItem(page, "water plants");

  await page.locator(".task", { hasText: "call the bank" }).locator(".tick").click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll("#list > li .label")].map((el) => el.textContent),
      ),
    )
    .toEqual(["water plants", "call the bank"]);
});
