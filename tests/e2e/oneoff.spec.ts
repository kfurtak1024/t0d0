import { expect, test } from "@playwright/test";
import { addItem, clearStorage, seedStorage, settle, shape, task } from "./helpers";

/**
 * One-off items, end to end. The rules of what goes and what stays are
 * unit-tested against `clearTicks`; what only a browser can check is that the
 * mark reaches the row, survives an edit and a reload, and that the closer
 * says out loud what it is about to take away — the removal is the one thing
 * here that tomorrow cannot undo.
 */

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("a trailing ~ marks an item, and stays out of its text", async ({ page }) => {
  await addItem(page, "post the parcel~");
  await addItem(page, "water plants");

  const marked = page.locator(".task", { hasText: "post the parcel" });
  await expect(marked).toHaveClass(/oneoff/);
  await expect(marked.locator(".label")).toHaveText("post the parcel");
  await expect(marked.locator(".once")).toBeVisible();
  await expect(marked.locator(".tick")).toHaveAttribute("aria-label", "post the parcel, one-off");

  const plain = page.locator(".task", { hasText: "water plants" });
  await expect(plain).not.toHaveClass(/oneoff/);
  await expect(plain.locator(".once")).toBeHidden();
});

test("both marks fit on one row, and both are announced", async ({ page }) => {
  await addItem(page, "call back!~ [2]");

  const row = page.locator(".task", { hasText: "call back" });
  await expect(row).toHaveClass(/important/);
  await expect(row).toHaveClass(/oneoff/);
  await expect(row.locator(".count")).toHaveText("0/2");
  await expect(row.locator(".tick")).toHaveAttribute("aria-label", "call back, important, one-off");
});

test("a ~ in a group heading is just a character", async ({ page }) => {
  await addItem(page, "# Errands~");
  await expect(page.locator(".group .gtitle")).toHaveText("Errands~");
});

/*
 * The composer and inline editing have to agree, or the first edit of a
 * one-off silently makes it permanent — which is the round-trip this catches.
 */
test("editing a row shows the mark again, and can take it off", async ({ page }) => {
  await addItem(page, "post the parcel~");

  const row = page.locator(".task", { hasText: "post the parcel" });
  await row.locator(".label").click();
  await expect(row.locator(".label")).toHaveText("post the parcel~");

  await row.locator(".label").fill("post the parcel");
  await row.locator(".label").press("Enter");
  await expect(row).not.toHaveClass(/oneoff/);
});

test("the ⋯ menu is the third route to the same field", async ({ page }) => {
  await addItem(page, "post the parcel");
  const row = page.locator(".task", { hasText: "post the parcel" });

  await row.locator(".dots").click();
  await page.locator(".rowmenu button", { hasText: "One-off, remove tonight" }).click();
  await expect(row).toHaveClass(/oneoff/);

  await row.locator(".dots").click();
  await page.locator(".rowmenu button", { hasText: "Keep for tomorrow" }).click();
  await expect(row).not.toHaveClass(/oneoff/);
});

test("the mark survives a reload", async ({ page }) => {
  await addItem(page, "post the parcel~");
  await page.reload();
  await expect(page.locator(".task", { hasText: "post the parcel" })).toHaveClass(/oneoff/);
});

test("the closer removes what the mark asked it to", async ({ page }) => {
  await addItem(page, "post the parcel~");
  await addItem(page, "water plants");

  await page.locator(".task", { hasText: "post the parcel" }).locator(".tick").click();
  await page.locator("#closeday").click();
  await page.locator("#veil .confirm").click();

  await expect(shape(page)).resolves.toEqual(["water plants"]);
});

test("a one-off nobody got to is still there in the morning", async ({ page }) => {
  // The mark is a convenience, not a trapdoor: the errand you did not run is
  // precisely the one you most need to see tomorrow.
  await addItem(page, "post the parcel~");
  await addItem(page, "water plants");
  await page.locator(".task", { hasText: "water plants" }).locator(".tick").click();

  await page.locator("#closeday").click();
  await page.locator("#veil .confirm").click();
  await expect(shape(page)).resolves.toEqual(["post the parcel", "water plants"]);
});

test("the removal is undoable, and sticks once the page has moved on", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [{ ...task("post the parcel"), once: true, count: 1 }, task("water plants")],
  });

  await page.locator("#closeday").click();
  await page.locator("#veil .confirm").click();
  await expect(shape(page)).resolves.toEqual(["water plants"]);

  await page.keyboard.press("Control+z");
  await expect(shape(page)).resolves.toEqual(["post the parcel", "water plants"]);

  // One level of undo, and it does not survive a reload — which is why the
  // card names the removal before the button rather than after it.
  await page.locator("#closeday").click();
  await page.locator("#veil .confirm").click();
  await page.reload();
  await expect(shape(page)).resolves.toEqual(["water plants"]);
});

/*
 * A heading with nothing under it says nothing about tomorrow, so the close
 * takes it away — whether its one-offs emptied it tonight or it was never
 * filled at all. One level of undo covers a heading you meant to keep.
 */
test("closing the day takes away the groups it has emptied", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      {
        kind: "group",
        id: "errands",
        title: "Errands",
        collapsed: false,
        important: false,
        items: [{ ...task("post the parcel"), once: true, count: 1 }],
      },
      {
        kind: "group",
        id: "keeps",
        title: "Work",
        collapsed: false,
        important: false,
        items: [{ ...task("review the PR"), count: 1 }],
      },
      { kind: "group", id: "bare", title: "Later", collapsed: false, important: false, items: [] },
      task("water plants"),
    ],
  });

  await page.locator("#closeday").click();
  await page.locator("#veil .confirm").click();

  // Errands lost its only row and goes with it; Later was never filled and goes
  // too; Work still holds something, so it stays — with its tick cleared.
  await expect.poll(() => shape(page)).toEqual(["# Work", "  review the PR", "water plants"]);
  await page.reload();
  await expect.poll(() => shape(page)).toEqual(["# Work", "  review the PR", "water plants"]);
});

/*
 * Measured, not eyeballed. The tag is the first word to sit at the end of a
 * row, which is what made a 4.8px offset between rows inside a group and rows
 * outside one legible at last — invisible for as long as only icons lived
 * there. Both halves are geometry, so both are asserted as geometry.
 */
test("the tag lands in the count's column, in a group and out of one", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      {
        kind: "group",
        id: "g",
        title: "Morning",
        collapsed: false,
        items: [
          { ...task("nested plain"), once: true },
          { ...task("nested counted"), target: 3, count: 1, once: true },
        ],
      },
      { ...task("root plain"), once: true },
      { ...task("root counted"), target: 3, count: 1, once: true },
    ],
  });
  await settle(page);

  const right = async (row: string, sel: string): Promise<number> => {
    const box = await page.locator(".task", { hasText: row }).locator(sel).boundingBox();
    if (!box) throw new Error(`no box for ${row} ${sel}`);
    return box.x + box.width;
  };

  /*
   * To within half a pixel, not exactly: a group's card lands on a fractional
   * edge where a root card lands on a whole one, so everything inside it
   * carries about 0.02px of that. The offset this guards against was 4.8px.
   */
  const sameColumn = async (a: [string, string], b: [string, string]): Promise<void> => {
    expect(await right(...a)).toBeCloseTo(await right(...b), 0);
  };

  // A row with no count gives the tag the count's slot, so the two stop in the
  // same column — otherwise the column wanders from row to row down the list.
  await sameColumn(["nested plain", ".once"], ["nested counted", ".count"]);
  await sameColumn(["root plain", ".once"], ["root counted", ".count"]);

  // And nesting does not move it: a group's card spends its own padding, and
  // the row inside subtracts it rather than paying twice.
  await sameColumn(["nested plain", ".once"], ["root plain", ".once"]);
  await sameColumn(["nested counted", ".once"], ["root counted", ".once"]);
  await sameColumn(["nested plain", ".dots"], ["root plain", ".dots"]);
});

test("the card still fits without scrolling once it has a removal to report", async ({ page }) => {
  // The one card with a destructive button: a confirm below the fold is how
  // someone taps it without reading it. Measured, like drawer.spec.ts.
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "group", id: "g", title: "Morning", collapsed: false, items: [task("a")] },
      { ...task("post the parcel"), once: true, count: 1 },
      { ...task("water plants"), important: true },
    ],
  });

  await page.locator("#closeday").click();
  const panel = page.locator("#veil .sheet");
  await expect(panel.locator(".confirm")).toBeVisible();

  // `.sheet-body` is the box that scrolls; `.sheet` is capped and holds it, so
  // asking the panel whether it overflows is a question that answers itself.
  const fits = await panel
    .locator(".sheet-body")
    .evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  expect(fits).toBe(true);

  // And the button it is warning about is on screen, which is the point of the
  // measurement rather than a property of the box around it. After the card has
  // landed: `.sheet` arrives on the same overshooting spring as the drawer, so a
  // box read on the way in is the animated one.
  await settle(page);
  const box = await panel.locator(".confirm").boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
});
