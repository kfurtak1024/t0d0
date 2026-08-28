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
 * The third route to the mark. The other two — the composer's `!` and the same
 * when editing the text — both mean typing; this is the one that works with a
 * thumb on a row already in front of you.
 */
test("the row menu marks and unmarks an item", async ({ page }) => {
  await addItem(page, "call the bank");
  const row = page.locator(".task", { hasText: "call the bank" });
  await expect(row).not.toHaveClass(/important/);

  await row.locator(".dots").click();
  await page.getByRole("menuitem", { name: "Mark important" }).click();
  await expect(row).toHaveClass(/important/);
  // The same field the composer writes, so editing shows the bang back.
  await row.locator(".label").click();
  await expect(row.locator(".label")).toHaveText("call the bank!");
  await row.locator(".label").press("Escape");

  await row.locator(".dots").click();
  await page.getByRole("menuitem", { name: "Unmark important" }).click();
  await expect(row).not.toHaveClass(/important/);
});

test("the row menu marks a group, and a nested item", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "a");

  const group = page.locator(".group");
  await group.locator(".ghead .dots").click();
  await page.getByRole("menuitem", { name: "Mark important" }).click();
  await expect(group).toHaveClass(/important/);

  const nested = page.locator(".items > .task", { hasText: "a" });
  await nested.locator(".dots").click();
  await page.getByRole("menuitem", { name: "Mark important" }).click();
  await expect(nested).toHaveClass(/important/);
});

test("marking from the menu is undoable", async ({ page }) => {
  await addItem(page, "call the bank");
  const row = page.locator(".task", { hasText: "call the bank" });

  await row.locator(".dots").click();
  await page.getByRole("menuitem", { name: "Mark important" }).click();
  await expect(row).toHaveClass(/important/);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".task", { hasText: "call the bank" })).not.toHaveClass(/important/);
});

/*
 * A finished important row has to stay recognisable as one.
 *
 * The mark was suppressed on finished rows at first, on the grounds that the
 * green frame was the state worth reading — which left a completed important
 * item looking exactly like every other completed item, so you could not tell
 * what you had actually got done. This asserts the two are distinguishable
 * rather than asserting a particular colour, so the treatment can change
 * without the guarantee moving.
 */
test("a finished important row is still tellable from an ordinary one", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: Date.now(),
    list: [
      { kind: "task", id: "k", text: "call the bank", target: 1, count: 1, important: true },
      { kind: "task", id: "p", text: "water plants", target: 1, count: 1, important: false },
      {
        kind: "group",
        id: "g",
        title: "Errands",
        collapsed: false,
        important: false,
        items: [
          { kind: "task", id: "nk", text: "post it", target: 1, count: 1, important: true },
          { kind: "task", id: "np", text: "sweep up", target: 1, count: 1, important: false },
        ],
      },
    ],
  });

  const marks = await page.evaluate(() => {
    const paint = (id: string): string => {
      const row = document.querySelector(`[data-id="${id}"]`);
      if (!row) return "missing";
      const own = getComputedStyle(row);
      const before = getComputedStyle(row, "::before");
      return `${own.boxShadow}|${before.display}|${before.backgroundColor}`;
    };
    return {
      rootMarked: paint("k"),
      rootPlain: paint("p"),
      inMarked: paint("nk"),
      inPlain: paint("np"),
    };
  });

  // Both are finished, so both wear the green frame; the marked ones must still
  // carry something the plain ones do not.
  expect(marks.rootMarked).not.toBe(marks.rootPlain);
  expect(marks.inMarked).not.toBe(marks.inPlain);
});

/*
 * Ticking does not spend the flag either: it is still stored, so a mis-tap does
 * not quietly cost you it.
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
