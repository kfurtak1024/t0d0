import { expect, test, type Page } from "@playwright/test";
import { addItem, clearStorage, seedStorage, settle, shape } from "./helpers";

const openDrawer = async (page: Page): Promise<void> => {
  await page.locator("#databtn").click();
  await expect(page.locator(".drawer")).toBeVisible();
};

const aDay = async (page: Page): Promise<void> => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");
};

const tick = (page: Page, text: string) =>
  page.locator(".task", { hasText: text }).locator(".tick");

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("a group folds itself once its last item is ticked", async ({ page }) => {
  await aDay(page);
  const group = page.locator(".group", { hasText: "Morning" });

  await tick(page, "eat breakfast").click();
  await expect(group).not.toHaveClass(/collapsed/);

  await tick(page, "walk the dog").click();
  await expect(group).toHaveClass(/collapsed/);
  // Folded, not finished with: the count still reports what is in there.
  await expect(group.locator(".gcount")).toHaveText("2/2");
});

test("folding waits for the tick to land rather than snatching the row away", async ({ page }) => {
  await aDay(page);
  const group = page.locator(".group", { hasText: "Morning" });

  await tick(page, "eat breakfast").click();
  await tick(page, "walk the dog").click();

  // The reward is watching the last tick complete, so the row is still there
  // for a beat afterwards.
  await expect(group).not.toHaveClass(/collapsed/);
  await expect(group).toHaveClass(/collapsed/);
});

test("a folded group drops below the work that is left", async ({ page }) => {
  await aDay(page);
  await page.locator("#dest").selectOption("");
  await addItem(page, "loose");
  expect(await shape(page)).toEqual(["# Morning", "  eat breakfast", "  walk the dog", "loose"]);

  await tick(page, "eat breakfast").click();
  await tick(page, "walk the dog").click();
  await expect(page.locator(".group", { hasText: "Morning" })).toHaveClass(/collapsed/);
  await settle(page);

  // Out of the way, not gone: what is left is what is on top.
  expect(await shape(page)).toEqual(["loose", "# Morning", "  eat breakfast", "  walk the dog"]);
});

test("a ticked root item drops below the work that is left", async ({ page }) => {
  await addItem(page, "shopping");
  await addItem(page, "email");
  await addItem(page, "laundry");

  await tick(page, "shopping").click();
  await expect.poll(() => shape(page)).toEqual(["email", "laundry", "shopping"]);

  // The pile keeps the order it was earned: laundry finished later, so it comes
  // to rest on top of shopping rather than burying it.
  await tick(page, "laundry").click();
  await expect.poll(() => shape(page)).toEqual(["email", "laundry", "shopping"]);
});

test("two ticks in the same breath both land", async ({ page }) => {
  await addItem(page, "a");
  await addItem(page, "b");
  await addItem(page, "c");
  await addItem(page, "d");

  // In one turn, so both are certainly queued together rather than depending on
  // how fast the machine got round to the second click. The upper one must not
  // stop dead on the lower one before that one has travelled itself.
  await page.evaluate(
    (texts) => {
      for (const text of texts) {
        const row = [...document.querySelectorAll(".task")].find(
          (el) => el.querySelector(".label")?.textContent === text,
        );
        row?.querySelector<HTMLElement>(".tick")?.click();
      }
    },
    ["a", "b"],
  );
  await expect.poll(() => shape(page)).toEqual(["c", "d", "a", "b"]);
});

/*
 * The mirror of the tidy. Unticking says "this is still to do", so leaving the
 * row buried among the finished ones would make that a lie — you would have to
 * go hunting for the thing you just put back.
 */
test("unticking a finished item brings it back above the pile", async ({ page }) => {
  for (const text of ["still to do", "first done", "second done"]) await addItem(page, text);

  await tick(page, "first done").click();
  await tick(page, "second done").click();
  await expect.poll(() => shape(page)).toEqual(["still to do", "first done", "second done"]);

  await tick(page, "second done").click();
  await expect.poll(() => shape(page)).toEqual(["still to do", "second done", "first done"]);
});

test("it stops under the work rather than climbing to the top", async ({ page }) => {
  for (const text of ["one", "two", "done it"]) await addItem(page, text);

  await tick(page, "done it").click();
  await tick(page, "done it").click();
  // Nothing finished sits above it, so it has nowhere to climb to.
  await expect.poll(() => shape(page)).toEqual(["one", "two", "done it"]);
});

test("a group comes back up when one of its items is unticked", async ({ page }) => {
  // Seeded already tidied, so the group has a finished row above it to climb
  // past — building this by ticking would batch the tidies and never produce it.
  await seedStorage(page, {
    v: 1,
    openedAt: Date.now(),
    list: [
      { kind: "task", id: "w", text: "still to do", target: 1, count: 0, important: false },
      { kind: "task", id: "f", text: "finished first", target: 1, count: 1, important: false },
      {
        kind: "group",
        id: "g",
        title: "Morning",
        collapsed: false,
        important: false,
        items: [
          { kind: "task", id: "e", text: "eat breakfast", target: 1, count: 1, important: false },
        ],
      },
    ],
  });
  await expect
    .poll(() => shape(page))
    .toEqual(["still to do", "finished first", "# Morning", "  eat breakfast"]);

  // A group travels as one block, so putting its item back lifts the whole card
  // over the finished row above it.
  await tick(page, "eat breakfast").click();
  await expect
    .poll(() => shape(page))
    .toEqual(["still to do", "# Morning", "  eat breakfast", "finished first"]);
});

test("with tidying off, an untick moves nothing either", async ({ page }) => {
  await openDrawer(page);
  await page.locator('[data-pref="autoCollapseDone"]').click();
  await page.locator(".drawer-close").click();

  for (const text of ["still to do", "first done", "second done"]) await addItem(page, text);
  await tick(page, "first done").click();
  await tick(page, "second done").click();
  await tick(page, "second done").click();

  // Nothing has moved in either direction: the preference governs both.
  await expect.poll(() => shape(page)).toEqual(["still to do", "first done", "second done"]);
});

test("closing the day reopens every fold", async ({ page }) => {
  await aDay(page);
  const group = page.locator(".group", { hasText: "Morning" });

  await tick(page, "eat breakfast").click();
  await tick(page, "walk the dog").click();
  await expect(group).toHaveClass(/collapsed/);

  await page.locator("#closeday").click();
  await page.locator("#veil .confirm").click();

  // Tomorrow starts on a list that shows itself.
  await expect(group).not.toHaveClass(/collapsed/);
});

test("re-opening a folded group by hand sticks", async ({ page }) => {
  await aDay(page);
  const group = page.locator(".group", { hasText: "Morning" });

  await tick(page, "eat breakfast").click();
  await tick(page, "walk the dog").click();
  await expect(group).toHaveClass(/collapsed/);

  await group.locator(".chev").click();
  await expect(group).not.toHaveClass(/collapsed/);
  // Nothing re-folds it behind your back a moment later.
  await page.waitForTimeout(800);
  await expect(group).not.toHaveClass(/collapsed/);
});

test("the preference turns it off, and survives a reload", async ({ page }) => {
  await aDay(page);
  await openDrawer(page);

  const toggle = page.getByRole("switch", { name: "Tidy finished items" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");

  await tick(page, "eat breakfast").click();
  await tick(page, "walk the dog").click();
  await page.waitForTimeout(800);
  await expect(page.locator(".group", { hasText: "Morning" })).not.toHaveClass(/collapsed/);

  await page.reload();
  await openDrawer(page);
  await expect(page.getByRole("switch", { name: "Tidy finished items" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

/*
 * Reduced motion means instant, not absent. The fold still happens, the reorder
 * still lands — they just skip the travel. Anything that only ever "happened"
 * inside an animation would silently stop happening here.
 */
test.describe("with motion turned off", () => {
  test("a finished group still folds, and a move still lands", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await aDay(page);

    await tick(page, "eat breakfast").click();
    await tick(page, "walk the dog").click();
    // Instant, not merely eventual: with motion on, the fold waits out the
    // tick's animation first, and this window is far shorter than that wait.
    await expect(page.locator(".group", { hasText: "Morning" })).toHaveClass(/collapsed/, {
      timeout: 250,
    });

    await page.locator(".group", { hasText: "Morning" }).locator(".chev").click();
    await page.locator("#dest").selectOption("");
    await addItem(page, "loose");

    const row = page.locator(".list > .task", { hasText: "loose" });
    await row.locator(".dots").click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await page.keyboard.press("Escape");

    // Landed in its finished position, and fully painted there — reduced motion
    // means the travel is skipped, not that a row is left half-faded.
    await expect(page.locator("#list > li").first()).toHaveText(/loose/);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.querySelector<HTMLElement>("#list > li");
          return el ? getComputedStyle(el).opacity : "";
        }),
      )
      .toBe("1");
  });
});

test("a preference is not carried in a backup", async ({ page }) => {
  await addItem(page, "shopping");
  await openDrawer(page);
  await page.getByRole("switch", { name: "Tidy finished items" }).click();

  const download = page.waitForEvent("download");
  await page.locator('[data-act="save"]').click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);

  // Preferences belong to this browser, the way the theme does.
  expect(Buffer.concat(chunks).toString("utf8")).not.toContain("autoCollapse");
});

/**
 * The first row to finish travels to the pile; it does not fly in from a corner.
 *
 * FLIP measures where a row ended up the moment the patch returns, and a
 * `display: none` container has no box to measure. While the empty pile stayed
 * hidden until after the patch, the first row to sink into it was handed its own
 * position minus a zero rect and told to start 76px across and 94px down from
 * where it belonged — a diagonal entrance from the bottom-right of the page.
 *
 * Asserted as "travels vertically" rather than on an exact number: the small
 * horizontal component belongs to every reorder in the app, pile or not, and
 * predates this. What must not come back is the order-of-magnitude one.
 */
test("the first finished row travels down to the pile, not in from a corner", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  const travel = await page.evaluate(async () => {
    const moves: { x: number; y: number }[] = [];
    /*
     * Instrumenting the prototype is the only way to see a FLIP animation's
     * keyframes: it is created and left to run, so by the time a test could
     * poll for it the numbers it started from are gone. Unbound on purpose —
     * `this` is the element being animated, which is the point.
     */
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const real = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const first = (frames as Keyframe[] | null)?.[0]?.["transform"];
      const found = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(String(first ?? ""));
      if (found) moves.push({ x: Number(found[1]), y: Number(found[2]) });
      return real.call(this, frames, options);
    };

    document.querySelector<HTMLElement>("[data-id] .tick")?.click();
    await new Promise((done) => setTimeout(done, 900));
    Element.prototype.animate = real;
    return moves;
  });

  // The sinking row is the one that travels furthest.
  const furthest = travel.sort((a, b) => Math.abs(b.y) - Math.abs(a.y))[0];
  expect(furthest, "the row should have been animated at all").toBeDefined();
  expect(Math.abs(furthest?.y ?? 0)).toBeGreaterThan(40);
  expect(
    Math.abs(furthest?.x ?? 0),
    `travelled sideways: ${JSON.stringify(furthest)}`,
  ).toBeLessThan(30);
});

/*
 * And the way back. Unticking the only finished row leaves the list itself
 * untouched — `rise` has nowhere to lift it to — while the boundary moves back
 * to the end and the row returns from the pile into the work. Keyed on the list
 * alone, that journey was made instantly.
 */
test("a row lifted back out of the pile travels too", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");
  await tick(page, "alpha").click();
  await expect(page.locator("#donelist > .task")).toHaveCount(1);
  await settle(page);

  const moved = await page.evaluate(async () => {
    let seen = 0;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const real = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      seen++;
      return real.call(this, frames, options);
    };

    document.querySelector<HTMLElement>("#donelist [data-id] .tick")?.click();
    await new Promise((done) => setTimeout(done, 700));
    Element.prototype.animate = real;
    return seen;
  });

  expect(moved).toBeGreaterThan(0);
  await expect(page.locator("#donelist")).toBeHidden();
});
