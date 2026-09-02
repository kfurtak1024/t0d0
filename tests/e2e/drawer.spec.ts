import { expect, test, type Page } from "@playwright/test";
import { addItem, clearStorage, settle, seedStorage } from "./helpers";

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

test("the settings sheet holds theme, two behaviour rows, two backup rows, and reset", async ({
  page,
}) => {
  await addItem(page, "shopping");
  await openDrawer(page);

  await expect(page.locator(".drawer-head h2")).toHaveText("Settings");
  await expect(page.locator(".row")).toHaveCount(6);
  await expect(page.locator('[data-pref="autoCollapseDone"]')).toHaveCount(1);
  await expect(page.locator('[data-pref-choice="successAt"]')).toHaveCount(1);
  await expect(page.locator('[data-act="save"] .row-label')).toHaveText("Save a copy");
  await expect(page.locator('[data-act="restore"] .row-label')).toHaveText("Load from a file");
  await expect(page.locator('[data-act="erase"] .row-label')).toHaveText("Erase everything");
  await expect(page.locator(".advanced")).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
});

/*
 * A scrollbar on a sheet with a screenful of room around it is the complaint
 * this guards against. It has gone wrong twice — once when the Behaviour
 * section grew a second row and tipped the content past the viewport cap, and
 * once at 1080p where the *absolute* cap bound and it scrolled by one pixel.
 *
 * Measured, not eyeballed: a one-pixel overflow looks like nothing and still
 * draws a scrollbar. A genuinely short window is allowed to scroll, which is
 * why this asks for a roomy one.
 */
test("the settings sheet fits a roomy window without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await addItem(page, "shopping");
  await openDrawer(page);

  const fit = await page.evaluate(() => {
    const drawer = document.querySelector(".drawer");
    if (!drawer) return null;
    return { content: drawer.scrollHeight, box: drawer.clientHeight };
  });
  expect(fit).not.toBeNull();
  expect(fit?.content).toBeLessThanOrEqual(fit?.box ?? 0);
});

/*
 * Every control here has to answer to a 44px thumb. Measured with
 * elementFromPoint rather than by box, because most of them get there through
 * an invisible ::after overlay that getBoundingClientRect cannot see — and
 * because an overlay that reaches too far steals its neighbour's centre, which
 * looks like nothing and breaks the control beside it.
 *
 * The picker is the exception: a <select> is a replaced element and does not
 * render an ::after reliably, so it earns its height for real.
 */
test("every control in the settings sheet answers to a thumb", async ({ page }) => {
  await openDrawer(page);
  // The sheet arrives on a spring that overshoots, and a box read mid-flight is
  // the animated size, not the settled one — which reads as a 43px control.
  await settle(page);

  const controls = [
    ".pick",
    ".switch",
    "[data-theme-choice='system']",
    "[data-theme-choice='light']",
    "[data-theme-choice='dark']",
    ".drawer-close",
  ];

  const measured = await page.evaluate((selectors) => {
    const owns = (el: Element, x: number, y: number): boolean => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === el || el.contains(hit));
    };
    return selectors.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, height: 0, ownsCentre: false };
      const box = el.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const reach = (step: number): number => {
        let n = 0;
        while (n < 60 && owns(el, cx, cy + step * (box.height / 2 + n))) n++;
        return n;
      };
      return {
        selector,
        height: Math.round(box.height + reach(1) + reach(-1)),
        ownsCentre: owns(el, cx, cy),
      };
    });
  }, controls);

  for (const control of measured) {
    expect(control.height, `${control.selector} tap height`).toBeGreaterThanOrEqual(44);
    // Nothing may sit on top of a neighbour's own middle.
    expect(control.ownsCentre, `${control.selector} owns its centre`).toBe(true);
  }
});

test("the theme choice applies immediately and survives a reload", async ({ page }) => {
  await openDrawer(page);
  await expect(page.locator('[data-theme-choice="system"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);

  await page.locator('[data-theme-choice="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('[data-theme-choice="dark"]')).toHaveAttribute("aria-pressed", "true");
  // The browser chrome follows the app, not just the OS.
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
    "content",
    "#0e1116",
  );

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openDrawer(page);
  await page.locator('[data-theme-choice="system"]').click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
});

test("a theme choice is not carried in a backup", async ({ page }) => {
  await openDrawer(page);
  await page.locator('[data-theme-choice="dark"]').click();

  const download = page.waitForEvent("download");
  await page.locator('[data-act="save"]').click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);

  // The theme belongs to this browser, not to the list.
  expect(Buffer.concat(chunks).toString("utf8")).not.toContain("theme");
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

/*
 * A list of nothing but empty groups has no items, and "Erase 0 items?" both
 * understates what goes and reads as a bug. The groups are the thing.
 */
test("the erase confirm names groups when there are no items to name", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "group", id: "g1", title: "Morning", collapsed: false, items: [] },
      { kind: "group", id: "g2", title: "Work", collapsed: false, items: [] },
    ],
  });
  await page.locator("#databtn").click();
  await page.locator('[data-act="erase"]').click();

  await expect(page.locator(".confirmbar-text")).toHaveText("Erase 2 groups?");
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

/*
 * The bottom sheet enters from a full height below the fold. Focusing a control
 * inside it while it is down there makes the browser scroll that control into
 * view — which scrolls the veil, so the panel appears half-way through its slide
 * and then drifts on the scroller's timing instead of its own. The fix is
 * focus({ preventScroll: true }) in ui/focus.ts, plus a veil that cannot scroll
 * on phones; this is the net under both.
 */
test("the settings sheet slides up without dragging the backdrop with it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await clearStorage(page);
  await addItem(page, "shopping");

  await page.locator("#databtn").click();

  const worst = await page.evaluate(async () => {
    const veil = document.getElementById("dataveil");
    if (!veil) return -1;
    let max = 0;
    const started = performance.now();
    await new Promise<void>((done) => {
      const tick = (): void => {
        max = Math.max(max, veil.scrollTop);
        if (performance.now() - started < 600) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    return max;
  });

  // Not "small" — the backdrop has no business moving at all.
  expect(worst).toBe(0);

  // And the panel is where it belongs, with focus in it rather than lost.
  await expect(page.locator(".drawer")).toBeVisible();
  const landed = await page.evaluate(() => {
    const box = document.querySelector(".drawer")?.getBoundingClientRect();
    return box ? box.bottom <= innerHeight + 1 && box.top < innerHeight : false;
  });
  expect(landed).toBe(true);
  expect(
    await page.evaluate(
      () => document.querySelector(".drawer")?.contains(document.activeElement) ?? false,
    ),
  ).toBe(true);
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
