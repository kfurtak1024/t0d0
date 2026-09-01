import { expect, test, type Page } from "@playwright/test";
import { addItem, clearStorage, seedStorage, shape } from "./helpers";

/**
 * Reordering has two front doors — the ⋯ menu for a thumb and Alt+Arrow for a
 * keyboard — and they drive the same transition. These check the doors; the
 * arrangement rules themselves are unit-tested against `State`.
 */

const menuOf = (page: Page, text: string) =>
  page.locator(".task", { hasText: text }).locator(".dots");

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("the ⋯ menu moves a row up and down", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");
  await addItem(page, "gamma");

  await menuOf(page, "gamma").click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  expect(await shape(page)).toEqual(["alpha", "gamma", "beta"]);

  // Repeatable without reopening: that is the whole point of a menu on touch.
  await page.getByRole("menuitem", { name: "Move up" }).click();
  expect(await shape(page)).toEqual(["gamma", "alpha", "beta"]);
});

/*
 * The ⋯ menu is the keyboard and single-pointer alternative to dragging, which
 * is what satisfies WCAG's requirement that a dragging movement have one. Its
 * arrow-key handling had no test at all: `src/ui/menu.ts` is outside the unit
 * coverage set, and the specs here only ever clicked its entries.
 */
test("the ⋯ menu moves focus with the arrow keys, and wraps", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");
  await addItem(page, "gamma");

  // A middle row, so both moves are live and every entry is usable.
  await menuOf(page, "beta").click();
  const up = page.getByRole("menuitem", { name: "Move up" });
  const down = page.getByRole("menuitem", { name: "Move down" });
  const mark = page.getByRole("menuitem", { name: "Mark important" });
  const once = page.getByRole("menuitem", { name: "One-off, remove tonight" });

  await expect(up).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(down).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(mark).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(once).toBeFocused();

  // Off the end and round, in both directions.
  await page.keyboard.press("ArrowDown");
  await expect(up).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(once).toBeFocused();
});

test("Home and End reach the ends of the ⋯ menu", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");
  await addItem(page, "gamma");

  await menuOf(page, "beta").click();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "One-off, remove tonight" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeFocused();
});

/*
 * A spent move stays in the menu, disabled, so the rows do not reflow under a
 * finger — which means the keyboard has to step over it rather than into it.
 */
test("the arrow keys skip a spent move rather than landing on it", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  // The top row: "Move up" is there but spent.
  await menuOf(page, "alpha").click();
  const up = page.getByRole("menuitem", { name: "Move up" });
  const down = page.getByRole("menuitem", { name: "Move down" });
  const once = page.getByRole("menuitem", { name: "One-off, remove tonight" });
  await expect(up).toBeDisabled();

  // Opening lands on the first entry that can actually be used.
  await expect(down).toBeFocused();
  // Backwards off the top wraps past the spent move to the last live entry.
  await page.keyboard.press("ArrowUp");
  await expect(once).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(down).toBeFocused();
});

test("a spent move stays in place, disabled, rather than moving under the finger", async ({
  page,
}) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  await menuOf(page, "beta").click();
  const up = page.getByRole("menuitem", { name: "Move up" });
  await up.click();

  expect(await shape(page)).toEqual(["beta", "alpha"]);
  await expect(up).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Move down" })).toBeEnabled();
});

test("Alt+Arrow reorders the focused row and keeps the focus on it", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  const tick = page.locator(".task", { hasText: "beta" }).locator(".tick");
  await tick.focus();
  await page.keyboard.press("Alt+ArrowUp");

  expect(await shape(page)).toEqual(["beta", "alpha"]);
  await expect(tick).toBeFocused();

  await page.keyboard.press("Alt+ArrowDown");
  expect(await shape(page)).toEqual(["alpha", "beta"]);
  await expect(tick).toBeFocused();
});

/*
 * Move up and move down stay on the row's own level. A command named after a
 * direction should not also change what an item belongs to — that is asked for
 * separately, with Tab / Shift-Tab or the menu's own entry.
 */
test("Alt+Arrow moves an item within its group and stops at the ends", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  const tick = page.locator(".task", { hasText: "eat breakfast" }).locator(".tick");
  await tick.focus();

  // Already at the top of its group: nowhere to go, and it does not pop out.
  await page.keyboard.press("Alt+ArrowUp");
  expect(await shape(page)).toEqual(["# Morning", "  eat breakfast", "  walk the dog"]);

  await page.keyboard.press("Alt+ArrowDown");
  expect(await shape(page)).toEqual(["# Morning", "  walk the dog", "  eat breakfast"]);

  // And at the bottom it stops rather than stepping out below the group.
  await page.keyboard.press("Alt+ArrowDown");
  expect(await shape(page)).toEqual(["# Morning", "  walk the dog", "  eat breakfast"]);
});

test("a root item steps past a whole group rather than into it", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await page.locator("#dest").selectOption("");
  await addItem(page, "loose");

  await page.locator(".list > .task", { hasText: "loose" }).locator(".tick").focus();
  await page.keyboard.press("Alt+ArrowUp");

  expect(await shape(page)).toEqual(["loose", "# Morning", "  eat breakfast"]);
});

test("Shift+Tab is what takes an item out of its group", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  await page.locator(".task", { hasText: "eat breakfast" }).locator(".tick").focus();
  await page.keyboard.press("Shift+Tab");

  expect(await shape(page)).toEqual(["# Morning", "  walk the dog", "eat breakfast"]);
});

test("a group moves as one block", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await page.locator("#dest").selectOption("");
  await addItem(page, "loose");

  await page.locator(".group").locator(".chev").focus();
  await page.keyboard.press("Alt+ArrowDown");

  expect(await shape(page)).toEqual(["loose", "# Morning", "  eat breakfast"]);
});

test("the menu's moves are level-scoped, with leaving as its own entry", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  await menuOf(page, "eat breakfast").click();
  // Top of its group: down is available, up is spent — it will not pop out.
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Move down" })).toBeEnabled();

  await page.getByRole("menuitem", { name: "Out of “Morning”" }).click();
  expect(await shape(page)).toEqual(["# Morning", "  walk the dog", "eat breakfast"]);
});

test("the menu offers the group above by name, and nesting is undoable", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await page.locator("#dest").selectOption("");
  await addItem(page, "loose");

  await menuOf(page, "loose").click();
  await page.getByRole("menuitem", { name: "Into “Morning”" }).click();
  expect(await shape(page)).toEqual(["# Morning", "  eat breakfast", "  loose"]);

  await page.keyboard.press("Control+z");
  expect(await shape(page)).toEqual(["# Morning", "  eat breakfast", "loose"]);
});

test("the menu closes on Escape and hands focus back to its ⋯", async ({ page }) => {
  await addItem(page, "alpha");

  const dots = menuOf(page, "alpha");
  await dots.click();
  await expect(page.locator(".rowmenu")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".rowmenu")).toBeHidden();
  await expect(dots).toBeFocused();
  await expect(dots).toHaveAttribute("aria-expanded", "false");
});

test("a reordered list survives a reload", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  await menuOf(page, "beta").click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await page.keyboard.press("Escape");

  await page.reload();
  expect(await shape(page)).toEqual(["beta", "alpha"]);
});

test("a new item is brought into view above the composer", async ({ page }) => {
  // A list long enough that the end of it starts behind the fixed composer.
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: Array.from({ length: 30 }, (_, i) => ({
      kind: "task",
      id: `t${String(i)}`,
      text: `item ${String(i)}`,
      target: 1,
      count: 0,
    })),
  });

  await addItem(page, "the newest thing");
  const row = page.locator(".task", { hasText: "the newest thing" });

  await expect
    .poll(async () => {
      const box = await row.boundingBox();
      const composer = await page.locator(".composer").boundingBox();
      if (!box || !composer) return false;
      // Fully on screen, and clear of the composer sitting over the list.
      return box.y > 0 && box.y + box.height <= composer.y;
    })
    .toBe(true);
});
