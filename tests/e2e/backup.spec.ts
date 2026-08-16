import { expect, test } from "@playwright/test";
import { addItem, clearStorage } from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("exports a dated file containing the current list", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");

  await page.locator("#databtn").click();
  const download = page.waitForEvent("download");
  await page.locator(".download").click();

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

  await page.locator("#databtn").click();
  await page.locator(".file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        v: 1,
        openedAt: null,
        list: [
          {
            kind: "group",
            id: "g",
            title: "Imported",
            collapsed: false,
            items: [{ kind: "task", id: "t", text: "from a file", target: 1, count: 0 }],
          },
        ],
      }),
    ),
  });

  await expect(page.locator(".pname")).toHaveText("backup.json");
  await expect(page.locator(".psum")).toContainText("1 item");
  await expect(page.locator(".psum")).toContainText("1 group");
  // Nothing has changed yet.
  await expect(page.locator(".task", { hasText: "original" })).toBeVisible();

  await page.locator(".replace").click();
  await expect(page.locator(".group", { hasText: "Imported" })).toBeVisible();
  await expect(page.locator(".task", { hasText: "original" })).toHaveCount(0);
});

test("import is undoable", async ({ page }) => {
  await addItem(page, "original");

  await page.locator("#databtn").click();
  await page.locator(".file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        v: 1,
        openedAt: null,
        list: [{ kind: "task", id: "t", text: "replacement", target: 1, count: 0 }],
      }),
    ),
  });
  await page.locator(".replace").click();
  await expect(page.locator(".task", { hasText: "replacement" })).toBeVisible();

  await page.locator(".toast-action").click();
  await expect(page.locator(".task", { hasText: "original" })).toBeVisible();
});

test("rejects a file that is not a t0d0 backup", async ({ page }) => {
  await page.locator("#databtn").click();
  await page.locator(".file").setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ hello: "world" })),
  });

  await expect(page.locator(".status")).toContainText("not a t0d0 backup");
  await expect(page.locator(".preview")).toBeHidden();
});
