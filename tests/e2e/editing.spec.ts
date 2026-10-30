import { expect, test, passTidy } from "./fixtures";
import { clearStorage, addItem, seedStorage, task, rowOf } from "./helpers";

/*
 * Editing a row in place: the label is its name, and the marks round-trip.
 */

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

/*
 * The three things the composer parses all leave the text on the way in, and
 * each is shown by something built for it: the accent edge, the tag, the tally.
 * The bracket was the odd one out — spelled into the label *and* counted in
 * `.count` — which made a counted row the only row whose text was not what you
 * typed. All three come back when you edit, which `raw()` covers.
 */
test("a row's label is its name, and none of the marks", async ({ page }) => {
  await addItem(page, "call the bank! [3]~");

  const row = rowOf(page, "call the bank");
  await expect(row.locator(".label")).toHaveText("call the bank");

  // Each mark still shows, just not as text in the name.
  await expect(row).toHaveClass(/important/);
  await expect(row.locator(".once")).toBeVisible();
  await expect(row.locator(".count")).toHaveText("0/3");

  // And editing hands all three back.
  await row.locator(".label").click();
  await expect(row.locator(".label")).toHaveText("call the bank!~ [3]");
});

/*
 * Editing is the only place the app makes an element contenteditable, and it
 * asks for "plaintext-only" — a value a browser is entitled to reject with a
 * SyntaxError rather than ignore. Nothing else here would notice if it did.
 */
test("a label edits in place, commits on Enter and reverts on Escape", async ({ page }) => {
  await addItem(page, "shopping");
  const label = page.locator(".task .label");

  await label.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("groceries");
  await page.keyboard.press("Enter");
  await expect(label).toHaveText("groceries");

  await label.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("never mind");
  await page.keyboard.press("Escape");
  await expect(label).toHaveText("groceries");
});

test("editing keeps the [n] visible and round-trips it", async ({ page }) => {
  await addItem(page, "make calls [3]");
  const label = page.locator(".task .label");

  await label.click();
  // The raw form comes back with the bracket, so the quantity stays editable.
  await expect(label).toHaveText("make calls [3]");
  await page.keyboard.press("Escape");

  await expect(label).toContainText("make calls");
  await expect(page.locator(".task .count")).toHaveText("0/3");
});

/*
 * A tick is not the only way across the line. Editing the target down past the
 * count finishes the row, and editing it back up past the count unfinishes it —
 * and the row has to go where a tick would have sent it either way, or it sits
 * finished in the work, or unfinished in the pile.
 */
test("editing a row finished or unfinished moves it like a tick would", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [{ ...task("calls"), target: 3, count: 1 }, task("other")],
  });
  const row = rowOf(page, "calls");
  const label = row.locator(".label");
  const where = () => row.evaluate((el) => el.parentElement?.id ?? "?");

  await label.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("calls");
  await page.keyboard.press("Enter");
  await expect(row).toHaveClass(/done/);
  await passTidy(page);
  await expect.poll(where).toBe("donelist");

  await label.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("calls [3]");
  await page.keyboard.press("Enter");
  await expect(row).not.toHaveClass(/done/);
  await expect.poll(where).toBe("list");
});
