import { expect, test } from "@playwright/test";
import { addItem, clearStorage, seedRaw, seedStorage } from "./helpers";

test("the list and its ticks survive a reload", async ({ page }) => {
  await clearStorage(page);
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "make calls [3]");

  await page.locator(".task", { hasText: "make calls" }).locator(".tick").click();
  await expect(page.locator("#frac")).toHaveText("0 of 2");

  await page.reload();

  await expect(page.locator(".group", { hasText: "Morning" })).toBeVisible();
  await expect(page.locator(".task", { hasText: "make calls" }).locator(".count")).toHaveText(
    "1/3",
  );
});

/*
 * A first run is empty, not seeded with a demo day. Sample items would sit in
 * the one place the app promises is yours, and deleting them would be the first
 * thing you ever did with it.
 */
test("a browser that has never opened it starts with nothing", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();

  await expect(page.locator(".list > li")).toHaveCount(0);
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#closeday")).toBeHidden();
  await expect(page.locator("#frac")).toHaveText("0 of 0");
});

test("a corrupt store falls back to a usable app instead of a blank page", async ({ page }) => {
  await seedRaw(page, "{ this is not json");

  await expect(page.locator("#input")).toBeVisible();
  await addItem(page, "still works");
  await expect(page.locator(".task", { hasText: "still works" })).toBeVisible();
});

test("counts stored above their target are repaired on load", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [{ kind: "task", id: "a", text: "make calls", target: 3, count: 99 }],
  });

  await expect(page.locator(".task", { hasText: "make calls" }).locator(".count")).toHaveText(
    "3/3",
  );
});

/*
 * Another tab writing while a row is being edited. The edit's node is about to
 * be replaced, and the blur that follows used to commit a rename against the
 * list from before the replace — which spent the undo slot, so one Ctrl-Z
 * silently put the old list back over what the other tab had written.
 */
test("an edit in flight is called off, not committed, when another tab writes", async ({
  page,
}) => {
  await seedStorage(page, {
    v: 1,
    openedAt: Date.now(),
    list: [{ kind: "task", id: "a", text: "shopping", target: 1, count: 0, important: false }],
  });

  await page.locator(".task .label").click();
  await expect(page.locator(".task .label")).toHaveAttribute("contenteditable", "plaintext-only");

  await page.evaluate(() => {
    const next = JSON.stringify({
      v: 1,
      openedAt: Date.now(),
      list: [{ kind: "task", id: "b", text: "from another tab", target: 1, count: 0 }],
    });
    localStorage.setItem("t0d0/v1", next);
    dispatchEvent(new StorageEvent("storage", { key: "t0d0/v1", newValue: next }));
  });
  await expect(page.locator(".task .label")).toHaveText("from another tab");

  // Nothing was staged to undo, so the other tab's list stands.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".task .label")).toHaveText("from another tab");

  // And editing still works afterwards.
  await page.locator(".task .label").click();
  await expect(page.locator(".task .label")).toHaveAttribute("contenteditable", "plaintext-only");
});

test("a day left open overnight offers its summary instead of counting on", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: Date.now() - 20 * 60 * 60 * 1000,
    list: [{ kind: "task", id: "a", text: "shopping", target: 1, count: 1 }],
  });

  await expect(page.locator("#veil")).toBeVisible();
  await expect(page.locator("#veil .score")).toHaveText("1 of 1");
});

test("a day opened recently is left alone", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: Date.now() - 60 * 1000,
    list: [{ kind: "task", id: "a", text: "shopping", target: 1, count: 1 }],
  });

  await expect(page.locator("#veil")).toBeHidden();
});
