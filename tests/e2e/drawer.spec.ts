import { expect, test, type Page } from "@playwright/test";
import { addItem, clearStorage } from "./helpers";

const openDrawer = async (page: Page): Promise<void> => {
  await page.locator("#databtn").click();
  await expect(page.locator(".drawer")).toBeVisible();
};

const backupFile = (list: unknown[]): { name: string; mimeType: string; buffer: Buffer } => ({
  name: "backup.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ v: 1, openedAt: null, list })),
});

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("the settings sheet is two rows plus reset, and nothing else", async ({ page }) => {
  await addItem(page, "shopping");
  await openDrawer(page);

  await expect(page.locator(".drawer-head h2")).toHaveText("Settings");
  await expect(page.locator(".row")).toHaveCount(3);
  await expect(page.locator('[data-act="save"] .row-label')).toHaveText("Save a copy");
  await expect(page.locator('[data-act="restore"] .row-label')).toHaveText("Load from a file");
  await expect(page.locator('[data-act="erase"] .row-label')).toHaveText("Erase everything");
  await expect(page.locator(".advanced")).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
});

test("the drawer summarises what a backup would contain", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  await openDrawer(page);
  await expect(page.locator('[data-slot="counts"]')).toHaveText("2 items · 1 group");
});

test("exports a dated file containing the current list", async ({ page }) => {
  await addItem(page, "eat breakfast");
  await openDrawer(page);

  const download = page.waitForEvent("download");
  await page.locator('[data-act="save"]').click();

  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^t0d0-\d{4}-\d{2}-\d{2}\.json$/);

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  expect(parsed).toMatchObject({ v: 1 });
  expect(JSON.stringify(parsed)).toContain("eat breakfast");
});

test("import previews the file before replacing anything", async ({ page }) => {
  await addItem(page, "original");
  await openDrawer(page);

  await page.locator(".file").setInputFiles(
    backupFile([
      {
        kind: "group",
        id: "g",
        title: "Imported",
        collapsed: false,
        items: [{ kind: "task", id: "t", text: "from a file", target: 1, count: 0 }],
      },
    ]),
  );

  await expect(page.locator(".staged-name")).toHaveText("backup.json");
  await expect(page.locator(".staged-sum")).toContainText("1 item");
  await expect(page.locator(".staged-sum")).toContainText("1 group");
  // Nothing has changed yet.
  await expect(page.locator(".task", { hasText: "original" })).toHaveCount(1);

  await page.locator('[data-act="import-confirm"]').click();
  await expect(page.locator(".drawer")).toBeHidden();
  await expect(page.locator(".group", { hasText: "Imported" })).toBeVisible();
  await expect(page.locator(".task", { hasText: "original" })).toHaveCount(0);
});

test("import is undoable", async ({ page }) => {
  await addItem(page, "original");
  await openDrawer(page);

  await page
    .locator(".file")
    .setInputFiles(
      backupFile([{ kind: "task", id: "t", text: "replacement", target: 1, count: 0 }]),
    );
  await page.locator('[data-act="import-confirm"]').click();
  await expect(page.locator(".task", { hasText: "replacement" })).toBeVisible();

  await page.locator(".toast-action").click();
  await expect(page.locator(".task", { hasText: "original" })).toBeVisible();
});

test("rejects a file that is not a t0d0 backup", async ({ page }) => {
  await openDrawer(page);
  await page.locator(".file").setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ hello: "world" })),
  });

  await expect(page.locator(".staged-sum")).toContainText("Not a t0d0 backup");
  // No way to confirm an unusable file.
  await expect(page.locator('[data-act="import-confirm"]')).toBeHidden();
});

test("erasing takes two presses and is undoable", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  await openDrawer(page);

  // First press only arms it.
  await page.locator('[data-act="erase"]').click();
  await expect(page.locator(".confirmbar-text")).toHaveText("Erase 2 items?");
  await expect(page.locator(".group", { hasText: "Morning" })).toHaveCount(1);

  await page.locator('[data-act="erase-go"]').click();
  await expect(page.locator(".drawer")).toBeHidden();
  await expect(page.locator(".list .task")).toHaveCount(0);
  await expect(page.locator(".list .group")).toHaveCount(0);
  await expect(page.locator("#empty")).toBeVisible();

  await page.locator(".toast-action").click();
  await expect(page.locator(".group", { hasText: "Morning" })).toBeVisible();
  await expect(page.locator(".list .task")).toHaveCount(2);
});

test("cancelling the erase leaves the list alone", async ({ page }) => {
  await addItem(page, "shopping");
  await openDrawer(page);

  await page.locator('[data-act="erase"]').click();
  await page.locator('[data-act="erase-cancel"]').click();

  await expect(page.locator(".confirmbar")).toBeHidden();
  await expect(page.locator('[data-act="erase"]')).toBeVisible();
  await expect(page.locator(".task", { hasText: "shopping" })).toBeVisible();
});

test("the drawer traps focus and gives it back on close", async ({ page }) => {
  await addItem(page, "shopping");
  await openDrawer(page);

  // Focus starts inside the dialog.
  await expect(page.locator(".drawer")).toContainText("Settings");
  const insideAtStart = await page.evaluate(
    () => document.querySelector(".drawer")?.contains(document.activeElement) ?? false,
  );
  expect(insideAtStart).toBe(true);

  // Tabbing around never escapes it.
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  const stillInside = await page.evaluate(
    () => document.querySelector(".drawer")?.contains(document.activeElement) ?? false,
  );
  expect(stillInside).toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.locator(".drawer")).toBeHidden();
  await expect(page.locator("#databtn")).toBeFocused();
});
