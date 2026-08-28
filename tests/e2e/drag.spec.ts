import { expect, test, type Locator, type Page } from "@playwright/test";
import { addItem, clearStorage, seedStorage, settle, shape, task } from "./helpers";

/**
 * Dragging is the reorder step applied repeatedly, so these tests are about the
 * gesture — that it picks up, crosses, commits, and can be called off — rather
 * than about the arrangement rules, which are unit-tested against `State`.
 *
 * Every geometry here is read after `settle`, because rows enter with a
 * transform and a box measured too early is not where the row ends up.
 */

/** Press the row's grip and travel `dy`, in steps, so each crossing is seen. */
async function drag(
  page: Page,
  handle: Locator,
  dy: number,
  { release = true, steps = 14 } = {},
): Promise<void> {
  const box = await handle.boundingBox();
  if (!box) throw new Error("no grip to drag");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + (dy * i) / steps);
  }
  if (release) await page.mouse.up();
}

const gripOf = (page: Page, text: string): Locator =>
  page.locator(".task", { hasText: text }).locator(".grip");

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("dragging a row up past its neighbour reorders the list", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");
  await addItem(page, "gamma");

  await settle(page);
  const height = (await page.locator(".list > .task").first().boundingBox())?.height ?? 0;
  await drag(page, gripOf(page, "gamma"), -height * 1.6);

  expect(await shape(page)).toEqual(["alpha", "gamma", "beta"]);
});

test("dragging down travels more than one row in a single gesture", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");
  await addItem(page, "gamma");

  await settle(page);
  const height = (await page.locator(".list > .task").first().boundingBox())?.height ?? 0;
  await drag(page, gripOf(page, "alpha"), height * 2.6);

  expect(await shape(page)).toEqual(["beta", "gamma", "alpha"]);
});

/*
 * The row's DOM node is rebuilt when it changes nesting, which is exactly the
 * moment a drag anchored to that node would die. The pointer is captured on the
 * list and the row is re-found by id each move, so the gesture survives it.
 */
test("a drag survives crossing into a group, where the row is rebuilt", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await page.locator("#dest").selectOption("");
  await addItem(page, "loose");

  await settle(page);
  const grip = gripOf(page, "loose");
  const from = await grip.boundingBox();
  const member = await page.locator(".items > .task", { hasText: "eat breakfast" }).boundingBox();
  if (!from || !member) throw new Error("missing geometry");

  // Clear of the group's near edge and past the midpoint of the item already
  // in it — so the gesture asks for both steps, and the answer is not a
  // question of a pixel either way.
  const to = member.y + member.height / 2 - 8;
  await drag(page, grip, to - (from.y + from.height / 2));

  expect(await shape(page)).toEqual(["# Morning", "  loose", "  eat breakfast"]);
});

/*
 * Dragging up through a group and out the other side. A group's header belongs
 * to the list, not to its contents, so once an item is at the top of a group
 * there has to be somewhere left to drag to — otherwise the item is trapped in
 * the first group it touches, which is where this used to end.
 */
test("an item dragged up through a group carries on out above it", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "group", id: "A", title: "Alpha", collapsed: false, items: [task("a1")] },
      { kind: "group", id: "B", title: "Beta", collapsed: false, items: [task("b1"), task("b2")] },
      task("loose"),
    ],
  });
  await settle(page);

  const grip = gripOf(page, "loose");
  const from = await grip.boundingBox();
  const gap = await page.evaluate(() => {
    const a = document.querySelector('[data-id="A"]')?.getBoundingClientRect();
    const b = document.querySelector('[data-id="B"]')?.getBoundingClientRect();
    return a && b ? (a.bottom + b.top) / 2 : 0;
  });
  if (!from) throw new Error("no grip");

  // Into the gap between the two groups: past all of Beta, but not into Alpha.
  await drag(page, grip, gap - (from.y + from.height / 2), { steps: 20 });

  expect(await shape(page)).toEqual(["# Alpha", "  a1", "loose", "# Beta", "  b1", "  b2"]);
});

test("dragging on up past the top group leaves it above everything", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "group", id: "A", title: "Alpha", collapsed: false, items: [task("a1")] },
      task("loose"),
    ],
  });
  await settle(page);

  const grip = gripOf(page, "loose");
  const from = await grip.boundingBox();
  const above = await page.evaluate(
    () => (document.querySelector('[data-id="A"]')?.getBoundingClientRect().top ?? 0) - 6,
  );
  if (!from) throw new Error("no grip");

  await drag(page, grip, above - (from.y + from.height / 2), { steps: 20 });

  expect(await shape(page)).toEqual(["loose", "# Alpha", "  a1"]);
});

/* The last item of the last group still has a way down and out. */
test("an item dragged below the last group lands at the root", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "group", id: "A", title: "Alpha", collapsed: false, items: [task("a1"), task("a2")] },
    ],
  });
  await settle(page);

  const grip = gripOf(page, "a2");
  const from = await grip.boundingBox();
  const below = await page.evaluate(
    () => (document.querySelector('[data-id="A"]')?.getBoundingClientRect().bottom ?? 0) + 30,
  );
  if (!from) throw new Error("no grip");

  await drag(page, grip, below - (from.y + from.height / 2), { steps: 20 });

  expect(await shape(page)).toEqual(["# Alpha", "  a1", "a2"]);
});

/**
 * Where a drop counts as "into this group". The header's lower half and the
 * items belong to the group; its top half means "above the group", and the last
 * sliver of the card means "below it" — those two are the only ways out, so
 * they cannot also be ways in.
 */
async function dropOnGroup(page: Page, groupId: string, at: number): Promise<string[]> {
  await settle(page);
  const to = await page.evaluate(
    ({ id, frac }: { id: string; frac: number }) => {
      const box = document.querySelector(`[data-id="${id}"]`)?.getBoundingClientRect();
      return box ? box.top + box.height * frac : 0;
    },
    { id: groupId, frac: at },
  );
  const grip = gripOf(page, "loose");
  const from = await grip.boundingBox();
  if (!from) throw new Error("no grip");
  await drag(page, grip, to - (from.y + from.height / 2), { steps: 20 });
  return shape(page);
}

const withGroups = (page: Page, items: unknown[]) =>
  seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "group", id: "E", title: "Empty", collapsed: false, items: [] },
      { kind: "group", id: "F", title: "Full", collapsed: false, items },
      task("loose"),
    ],
  });

test("a group with nothing in it still accepts a dropped item", async ({ page }) => {
  await withGroups(page, [task("f1")]);

  expect(await dropOnGroup(page, "E", 0.55)).toEqual(["# Empty", "  loose", "# Full", "  f1"]);
});

test("dropping on a group's title puts the item in at the top", async ({ page }) => {
  await withGroups(page, [task("f1"), task("f2")]);

  // The lower half of the header: aiming at the group's name means "in here",
  // and the item lands where the pointer is rather than at the far end.
  const box = await page.locator('[data-id="F"] .ghead').boundingBox();
  const card = await page.locator('[data-id="F"]').boundingBox();
  if (!box || !card) throw new Error("missing geometry");
  const at = (box.y + box.height * 0.75 - card.y) / card.height;

  expect(await dropOnGroup(page, "F", at)).toEqual([
    "# Empty",
    "# Full",
    "  loose",
    "  f1",
    "  f2",
  ]);
});

test("dropping over a group's items puts the item in", async ({ page }) => {
  await withGroups(page, [task("f1"), task("f2")]);

  expect(await dropOnGroup(page, "F", 0.5)).toEqual([
    "# Empty",
    "# Full",
    "  loose",
    "  f1",
    "  f2",
  ]);
});

test("Escape mid-drag puts the list back", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");
  await addItem(page, "gamma");

  await settle(page);
  const height = (await page.locator(".list > .task").first().boundingBox())?.height ?? 0;
  await drag(page, gripOf(page, "gamma"), -height * 1.6, { release: false });
  expect(await shape(page)).toEqual(["alpha", "gamma", "beta"]);

  await page.keyboard.press("Escape");
  await page.mouse.up();

  expect(await shape(page)).toEqual(["alpha", "beta", "gamma"]);
  await expect(page.locator(".dragging")).toHaveCount(0);
});

/* One gesture is one mistake, however many rows it crossed on the way. */
test("one undo reverses a whole drag, not its last step", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");
  await addItem(page, "gamma");

  await settle(page);
  const height = (await page.locator(".list > .task").first().boundingBox())?.height ?? 0;
  await drag(page, gripOf(page, "alpha"), height * 2.6);
  expect(await shape(page)).toEqual(["beta", "gamma", "alpha"]);

  // Ctrl-Z inside the composer means "undo my typing", by design — so this is
  // the app's undo only once focus has left the field.
  await page.locator("#input").blur();
  await page.keyboard.press("Control+z");
  expect(await shape(page)).toEqual(["alpha", "beta", "gamma"]);
});

test("a press on the grip that never moves is not a drag", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  await settle(page);
  const grip = gripOf(page, "beta");
  const box = await grip.boundingBox();
  if (!box) throw new Error("no grip");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 2);
  await page.mouse.up();

  expect(await shape(page)).toEqual(["alpha", "beta"]);
  await expect(page.locator(".dragging")).toHaveCount(0);
});

test("a whole group drags as one block", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await page.locator("#dest").selectOption("");
  await addItem(page, "loose");

  await settle(page);
  const group = page.locator(".group");
  const groupBox = await group.boundingBox();
  const looseBox = await page.locator(".list > .task", { hasText: "loose" }).boundingBox();
  if (!groupBox || !looseBox) throw new Error("missing geometry");

  await drag(page, group.locator(".ghead > .grip"), looseBox.y + looseBox.height - groupBox.y);

  expect(await shape(page)).toEqual(["loose", "# Morning", "  eat breakfast"]);
});

/*
 * Hit areas here are invisible ::after overlays, and where two overlap the later
 * one in the DOM wins — the tick sits after the grip. A symmetric 44px box put
 * the tick's overlay over the grip's own dots, so pressing them ticked the item
 * instead of dragging it, and no drag was possible at all. Assert the invariant
 * directly rather than trusting that some other test would notice.
 */
test("the grip is what you hit when you press the grip", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "group", id: "G", title: "Group", collapsed: false, items: [task("nested")] },
      task("root"),
    ],
  });
  await settle(page);

  const hits = await page.evaluate(() =>
    ["G", "nested", "root"].map((id) => {
      const row = document.querySelector(`[data-id="${id}"]`);
      const grip = row?.querySelector(".grip");
      if (!grip) return `${id}: no grip`;
      const box = grip.getBoundingClientRect();
      const y = box.y + box.height / 2;
      const at = (x: number): string =>
        document.elementFromPoint(x, y)?.className.split(" ")[0] ?? "-";
      // Across the dots themselves: left edge, middle, right edge.
      return `${id}: ${at(box.x + 1)} ${at(box.x + box.width / 2)} ${at(box.right - 1)}`;
    }),
  );

  expect(hits).toEqual(["G: grip grip grip", "nested: grip grip grip", "root: grip grip grip"]);
});

/*
 * A second finger is not the drag's business. The end handlers used to take any
 * pointerup at all, so a stray thumb resting on the list and lifting — the way
 * a phone is actually held — ended the gesture the first finger was still
 * holding, dropping the row wherever it had got to.
 */
test("a stray second finger does not end the drag", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  await settle(page);
  const released = await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>(".list > .task")];
    const row = rows[1];
    const grip = row?.querySelector<HTMLElement>(".grip");
    const first = rows[0];
    if (!grip || !row || !first) return false;

    const box = grip.getBoundingClientRect();
    const send = (type: string, y: number, pointerId: number): void => {
      grip.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: pointerId === 1,
          clientX: box.x + box.width / 2,
          clientY: y,
          button: 0,
        }),
      );
    };

    const from = box.y + box.height / 2;
    const target = first.getBoundingClientRect();
    const at = (i: number): number => from + ((target.top - from) * i) / 12;

    send("pointerdown", from, 1);
    // Two steps in — far enough to be a drag, nowhere near a swap yet.
    send("pointermove", at(1), 1);
    send("pointermove", at(2), 1);

    // The second finger arrives and leaves while the first still holds the row.
    send("pointerdown", at(2), 2);
    send("pointerup", at(2), 2);

    for (let i = 3; i <= 12; i++) send("pointermove", at(i), 1);
    send("pointerup", target.top, 1);
    return document.querySelectorAll(".dragging").length === 0;
  });
  expect(released).toBe(true);

  // The gesture ran to completion, so the row landed where it was taken.
  expect(await shape(page)).toEqual(["beta", "alpha"]);
});

test("a touch pointer drags too", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  await settle(page);
  const moved = await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>(".list > .task")];
    const row = rows[1];
    const grip = row?.querySelector<HTMLElement>(".grip");
    const first = rows[0];
    if (!grip || !row || !first) return false;

    const box = grip.getBoundingClientRect();
    const send = (type: string, y: number, target: EventTarget): void => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: box.x + box.width / 2,
          clientY: y,
          button: 0,
        }),
      );
    };

    const from = box.y + box.height / 2;
    send("pointerdown", from, grip);
    const target = first.getBoundingClientRect();
    for (let i = 1; i <= 12; i++) {
      send("pointermove", from + ((target.top - from) * i) / 12, grip);
    }
    send("pointerup", target.top, grip);
    return true;
  });
  expect(moved).toBe(true);

  expect(await shape(page)).toEqual(["beta", "alpha"]);
});
