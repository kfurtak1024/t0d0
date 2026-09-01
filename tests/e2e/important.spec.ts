import { expect, test, type Locator, type Page } from "@playwright/test";
import { addItem, clearStorage, seedStorage } from "./helpers";

/**
 * The `!` mark, end to end. The parser's own rules are unit-tested; what only a
 * browser can check is that the mark reaches the row, survives being edited and
 * reloaded, and never leaks into the text you see.
 */

/**
 * Whether a row is actually drawing its own pill.
 *
 * Both halves matter: a row that is not marked at all has no `::before` rule,
 * so `content` comes back "none" while `display` still reports "block" —
 * reading the display alone would call that shown.
 */
const wearsPill = (row: Locator): Promise<boolean> =>
  row.evaluate((el) => {
    const before = getComputedStyle(el, "::before");
    return before.content !== "none" && before.display !== "none";
  });

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
  await addItem(page, "b");

  const nested = page.locator(".items > .task", { hasText: "a" });
  await nested.locator(".dots").click();
  await page.getByRole("menuitem", { name: "Mark important", exact: true }).click();
  await expect(nested).toHaveClass(/important/);
  // One of two, so the group is not yet making the same statement.
  await expect(page.locator(".group")).not.toHaveClass(/important/);

  const group = page.locator(".group");
  await group.locator(".ghead .dots").click();
  await page.getByRole("menuitem", { name: "Mark important", exact: true }).click();
  await expect(group).toHaveClass(/important/);
  // Marking the group marked what was left in it.
  await expect(page.locator(".items > .task", { hasText: "b" })).toHaveClass(/important/);
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
 * A group's mark speaks for everything in it, so the items stop repeating it.
 * Their own flags are untouched — this is what is shown, not what is stored.
 */
test("an item inside an important group does not wear its own mark", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "marked one!");
  await addItem(page, "plain one");

  const marked = page.locator(".items > .task", { hasText: "marked one" });
  const shown = () => wearsPill(marked);

  // The group is not important yet, so the item says so itself.
  await expect(page.locator(".group")).not.toHaveClass(/important/);
  expect(await shown()).toBe(true);

  await page.locator(".group .ghead .dots").click();
  await page.getByRole("menuitem", { name: "Mark important" }).click();
  await expect(page.locator(".group")).toHaveClass(/important/);
  expect(await shown()).toBe(false);

  // Marking the group marked everything in it, so the plain one is now marked
  // too — and unmarking the group takes all of it back off.
  await page.locator(".group .ghead .dots").click();
  await page.getByRole("menuitem", { name: "Unmark important" }).click();
  await expect(page.locator(".group")).not.toHaveClass(/important/);
  expect(await shown()).toBe(false);
});

/*
 * The reported gap: a plain group given a marked item is a group all of whose
 * items are marked, and it should say so.
 */
test("a group takes the mark when the only item put in it is marked", async ({ page }) => {
  await addItem(page, "# Morning");
  const group = page.locator(".group");
  await expect(group).not.toHaveClass(/important/);

  await addItem(page, "ship it!");
  await expect(group).toHaveClass(/important/);

  // And gives it back when something plain joins, rather than quietly making
  // that plain row important by inheritance.
  await addItem(page, "water plants");
  await expect(group).not.toHaveClass(/important/);
  await expect(page.locator(".items > .task", { hasText: "water plants" })).not.toHaveClass(
    /important/,
  );
});

/*
 * A group and its items are one statement made two ways, so the two stay in
 * step whichever end you change.
 */
test("unmarking one item takes the mark off the group", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "one!");
  await addItem(page, "two!");

  const group = page.locator(".group");
  await expect(group).toHaveClass(/important/);

  await page.locator(".items > .task", { hasText: "one" }).locator(".dots").click();
  await page.getByRole("menuitem", { name: "Unmark important" }).click();

  await expect(group).not.toHaveClass(/important/);
  // The one still marked shows its own mark again, now the group is not saying it.
  expect(await wearsPill(page.locator(".items > .task", { hasText: "two" }))).toBe(true);
});

/*
 * Several marks all saying the same thing become one on the group. It happens
 * on the marking, not as a standing rule — otherwise the items would put the
 * group's mark straight back and it could never be taken off.
 */
test("marking the last item promotes the group, which can still be unmarked", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "one!");
  await addItem(page, "two");

  const group = page.locator(".group");
  await expect(group).not.toHaveClass(/important/);

  await page.locator(".items > .task", { hasText: "two" }).locator(".dots").click();
  await page.getByRole("menuitem", { name: "Mark important" }).click();
  await expect(group).toHaveClass(/important/);

  // And it stays off when told to come off: unmarking clears the items, so
  // there is nothing left to put the group's mark straight back.
  await group.locator(".ghead .dots").click();
  await page.getByRole("menuitem", { name: "Unmark important" }).click();
  await expect(group).not.toHaveClass(/important/);
  await expect(page.locator(".items > .task.important")).toHaveCount(0);
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
      {
        kind: "group",
        id: "gk",
        title: "Admin",
        collapsed: false,
        important: true,
        // Marked all the way down, because a group's mark is read from its
        // items — a group claiming otherwise is repaired on the way in.
        items: [{ kind: "task", id: "a1", text: "file it", target: 1, count: 1, important: true }],
      },
      {
        kind: "group",
        id: "gp",
        title: "Later",
        collapsed: false,
        important: false,
        items: [{ kind: "task", id: "b1", text: "read it", target: 1, count: 1, important: false }],
      },
    ],
  });

  const marks = await page.evaluate(() => {
    const paint = (id: string): string => {
      const row = document.querySelector(`[data-id="${id}"]`);
      if (!row) return "missing";
      // Everything the mark could plausibly be drawn with, so the guarantee
      // survives a change of technique.
      const own = getComputedStyle(row);
      const before = getComputedStyle(row, "::before");
      return [
        own.boxShadow,
        own.backgroundImage,
        own.backgroundColor,
        before.display,
        before.backgroundColor,
      ].join("|");
    };
    return {
      rootMarked: paint("k"),
      rootPlain: paint("p"),
      inMarked: paint("nk"),
      inPlain: paint("np"),
      groupMarked: paint("gk"),
      groupPlain: paint("gp"),
    };
  });

  // All of them are finished, so all of them wear the green frame; the marked
  // ones must still carry something the plain ones do not. A group is in here
  // because it is marked a different way from a row — a strip in its own
  // background rather than a pill drawn over it.
  expect(marks.rootMarked).not.toBe(marks.rootPlain);
  expect(marks.inMarked).not.toBe(marks.inPlain);
  expect(marks.groupMarked).not.toBe(marks.groupPlain);
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

/*
 * The mark is drawn on the row's leading edge, and so is the first control —
 * the grip, which on a touch device stays in the flow because there it is
 * always visible and has to be somewhere real. So the two have to be measured
 * against each other, and this went wrong in both places at once: a group's
 * grip was drawn *over* its strip (-1.2px) and a root row's cleared it by two,
 * which reads as touching. Every leading padding is now derived from the mark's
 * own width plus --mark-clear; this is what says so.
 *
 * Asserted as a floor rather than the exact number, so the token can be tuned
 * without moving the guarantee.
 */
test("a row's leading control clears the mark beside it", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "task", id: "k", text: "call the bank", target: 1, count: 0, important: true },
      {
        kind: "group",
        id: "g",
        title: "Admin",
        collapsed: false,
        important: true,
        items: [{ kind: "task", id: "a1", text: "file it", target: 1, count: 0, important: true }],
      },
      {
        // Plain, so the item inside it wears its own pill to measure against.
        kind: "group",
        id: "gp",
        title: "Errands",
        collapsed: false,
        important: false,
        items: [
          { kind: "task", id: "n", text: "post it", target: 1, count: 0, important: true },
          { kind: "task", id: "np", text: "sweep up", target: 1, count: 0, important: false },
        ],
      },
    ],
  });

  const clearance = await page.evaluate(() => {
    const radius = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--r-card"),
    );
    const measure = (id: string, markWidth: number): number => {
      const row = document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
      const bar = row.querySelector<HTMLElement>(":scope > .ghead") ?? row;
      /*
       * Whichever control actually leads the row: on a pointer device the grip
       * leaves the flow for the margin and the tick or chevron leads instead.
       */
      const lead = [...bar.children].find((el) => {
        const { position } = getComputedStyle(el);
        return position !== "absolute" && position !== "fixed";
      }) as HTMLElement;
      return lead.getBoundingClientRect().left - (row.getBoundingClientRect().left + markWidth);
    };
    // A card's mark is exactly its corner; a nested row's pill is a third of it.
    return {
      root: measure("k", radius),
      group: measure("g", radius),
      nested: measure("n", radius / 3),
    };
  });

  expect(clearance.root).toBeGreaterThanOrEqual(4);
  expect(clearance.group).toBeGreaterThanOrEqual(4);
  expect(clearance.nested).toBeGreaterThanOrEqual(4);
});

/*
 * A fold is the one place a marked row can go out of sight while the day still
 * turns on it: the ring refuses to go green and nothing says which group is the
 * reason. The group says it, the way the tally beside it already speaks for the
 * rows it is hiding — the fold itself stays a fold.
 */
test.describe("what a folded group is still holding", () => {
  const mixed = (collapsed: boolean, ticked = 0) => ({
    v: 1,
    openedAt: null,
    list: [
      {
        kind: "group",
        id: "g",
        title: "Admin",
        collapsed,
        important: false,
        items: [
          {
            kind: "task",
            id: "i1",
            text: "book the tickets",
            target: 1,
            count: ticked,
            important: true,
          },
          { kind: "task", id: "i2", text: "reply to Dana", target: 1, count: 0, important: true },
          { kind: "task", id: "i3", text: "tidy the desk", target: 1, count: 1, important: false },
        ],
      },
    ],
  });

  const badge = (page: Page): Locator => page.locator(".group .gmark");

  test("a collapsed group counts the marked work it hides", async ({ page }) => {
    await seedStorage(page, mixed(true));

    await expect(badge(page)).toBeVisible();
    await expect(badge(page).locator(".num")).toHaveText("2");
    // The visual badge is a channel of its own; the fact reaches a screen reader
    // through the chevron, which is the group's handle.
    await expect(page.locator(".group .chev")).toHaveAttribute(
      "aria-label",
      "Expand Admin, 2 important left",
    );
  });

  test("an open group says nothing — its rows say it themselves", async ({ page }) => {
    await seedStorage(page, mixed(false));

    // Present, so folding shifts nothing sideways, but not shown.
    await expect(badge(page)).toHaveCSS("opacity", "0");
    await expect(page.locator(".group .chev")).toHaveAttribute("aria-label", "Collapse Admin");

    await page.locator(".group .chev").click();
    await expect(badge(page)).toBeVisible();
    await expect(badge(page)).toHaveCSS("opacity", "1");
  });

  test("it counts what is owed, not what is marked", async ({ page }) => {
    // One of the two marked rows is already done.
    await seedStorage(page, mixed(true, 1));

    await expect(badge(page).locator(".num")).toHaveText("1");
  });

  /*
   * Every automatic fold is a group that has just finished, so a badge that
   * counted finished rows would land on exactly the groups the tidy had cleared.
   */
  test("a group tidied away for being finished carries nothing", async ({ page }) => {
    await addItem(page, "# Admin");
    await addItem(page, "book the tickets!");
    await addItem(page, "reply to Dana");

    for (const text of ["book the tickets", "reply to Dana"])
      await page.locator(".items > .task", { hasText: text }).locator(".tick").click();

    const group = page.locator(".group");
    await expect(group).toHaveClass(/collapsed/);
    await expect(badge(page)).toBeHidden();
    // Nothing owed, so the handle says no more than it did before.
    await expect(group.locator(".chev")).toHaveAttribute("aria-label", "Expand Admin");
  });

  test("a group with nothing marked carries nothing", async ({ page }) => {
    await addItem(page, "# Admin");
    await addItem(page, "tidy the desk");
    await page.locator(".group .chev").click();

    await expect(page.locator(".group")).toHaveClass(/collapsed/);
    await expect(badge(page)).toBeHidden();
  });
});

/*
 * The strip is a ramp now, and a ramp is two colours that can drift apart in
 * two themes without anyone noticing. It is non-text, so 3:1 against --card is
 * the bar rather than 4.5:1 — the note on --flag in tokens.css says so, and
 * this is what holds it to it. Both ends, because the foot is where a ramp
 * that deepens runs out of contrast, and both themes, because in dark the ramp
 * runs toward the card rather than away from it.
 */
for (const scheme of ["light", "dark"] as const) {
  test(`the mark's ramp clears 3:1 on the card in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await addItem(page, "call the bank!");
    await expect(page.locator(".task.important")).toBeVisible();

    const ratios = await page.evaluate(() => {
      const relative = (px: number[]): number => {
        const f = (c: number): number => {
          const v = c / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(px[0]!) + 0.7152 * f(px[1]!) + 0.0722 * f(px[2]!);
      };
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const cx = canvas.getContext("2d", { willReadFrequently: true })!;
      // Painted over the layer beneath, so a stop carrying alpha is measured as
      // it actually lands rather than as it was written.
      const paint = (colour: string, under: string): number[] => {
        cx.fillStyle = under;
        cx.fillRect(0, 0, 1, 1);
        cx.fillStyle = colour;
        cx.fillRect(0, 0, 1, 1);
        return [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const style = getComputedStyle(document.querySelector(".task.important")!);
      const read = (name: string): string => style.getPropertyValue(name).trim();

      const card = paint(read("--card"), "#ffffff");
      const cardCss = `rgb(${card.join(",")})`;
      const against = (colour: string): number => {
        const a = relative(paint(colour, cardCss));
        const b = relative(card);
        const [hi, lo] = a > b ? [a, b] : [b, a];
        return (hi + 0.05) / (lo + 0.05);
      };
      return {
        head: against(read("--flag-head")),
        foot: against(read("--flag-foot")),
        mid: against(read("--flag")),
        doneHead: against(read("--flag-done-head")),
        doneFoot: against(read("--flag-done-foot")),
        doneMid: against(read("--flag-done")),
      };
    });

    /*
     * Both mid-tones are ends in their own right, not just interpolation: --flag
     * paints the nested pill, the fold's pip and the gate's pip, and --flag-done
     * the finished pill.
     *
     * Which end is the tight one flips with the theme rather than with the hue —
     * on a white card it is the lighter head, on a dark card the darker foot —
     * so the check is the same for all six and the failure message says which.
     */
    for (const [name, ratio] of Object.entries(ratios)) {
      expect(ratio, `${name} on --card in ${scheme}`).toBeGreaterThanOrEqual(3);
    }
  });
}
