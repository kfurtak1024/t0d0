import type { Page } from "@playwright/test";

export const STORAGE_KEY = "t0d0/v1";

/**
 * Write the store, then reload so the app boots from it.
 *
 * Deliberately not `addInitScript`: that re-runs on every navigation, which
 * would silently reset the store during any test that reloads the page.
 */
async function boot(page: Page, raw: string): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key!, value!);
    },
    [STORAGE_KEY, raw],
  );
  await page.reload();
}

/** Start from an explicitly empty list rather than the first-run seed. */
export async function clearStorage(page: Page): Promise<void> {
  await boot(page, JSON.stringify({ v: 1, openedAt: null, list: [] }));
}

export async function seedStorage(page: Page, state: unknown): Promise<void> {
  await boot(page, JSON.stringify(state));
}

export async function seedRaw(page: Page, raw: string): Promise<void> {
  await boot(page, raw);
}

export async function addItem(page: Page, text: string): Promise<void> {
  await page.locator("#input").fill(text);
  await page.locator("#input").press("Enter");
}

/** Point the composer back at the root, when there is a group to point away from. */
async function aimAtRoot(page: Page): Promise<void> {
  const dest = page.locator("#dest");
  if (await dest.isVisible()) await dest.selectOption("");
}

/**
 * Type a list so that it *reads* as the shape given — the inverse of
 * {@link shape}, in the same notation as the unit tests' `rows`.
 *
 * The composer lands every new row at the top of whatever it is aimed at, so
 * typing a list in reading order builds the reverse of it, and a group has to
 * exist before the items that go in it can be typed. Both of those are the
 * composer's business, not the business of a spec about dragging or about the
 * tidy — those say the arrangement they want and let this do the typing. Only
 * `composer.spec.ts` should care which way round the typing goes.
 */
export async function buildList(page: Page, spec: string[]): Promise<void> {
  const roots: { head: string; items: string[] }[] = [];
  for (const line of spec) {
    if (line.startsWith("  ")) {
      const last = roots[roots.length - 1];
      if (!last) throw new Error(`nested row with nothing above it: ${line}`);
      last.items.push(line.trim());
      continue;
    }
    roots.push({ head: line, items: [] });
  }

  for (const root of [...roots].reverse()) {
    if (!root.head.startsWith("# ")) {
      await aimAtRoot(page);
      await addItem(page, root.head);
      continue;
    }
    // A new group lands at the top and takes the aim, so its items follow it
    // — in reverse, since each of those lands at the top of the group.
    await addItem(page, root.head);
    for (const item of [...root.items].reverse()) await addItem(page, item);
  }
}

/**
 * The list as it reads on screen: "# X" is a group, two leading spaces mean
 * nested. Reordering tests are about arrangement, so this lets them assert
 * before-and-after pictures rather than poke at individual rows.
 */
export const shape = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    // Both lists, in the order they read: the day's work, then the pile of
    // finished rows below the ending. One list to the eye, two containers.
    [...document.querySelectorAll("#list > li, #donelist > li")].flatMap((row) =>
      row.classList.contains("group")
        ? [
            `# ${row.querySelector(".gtitle")?.textContent ?? ""}`,
            ...[...row.querySelectorAll(".items > li")].map(
              (item) => `  ${item.querySelector(".label")?.textContent ?? ""}`,
            ),
          ]
        : [row.querySelector(".label")?.textContent ?? ""],
    ),
  );

/**
 * Wait for the list to stop moving before measuring it.
 *
 * Rows enter with a transform, so a box read too early is the row's animated
 * position rather than the one it settles at — and a drag aimed at a midpoint
 * then lands on the wrong side of it, depending on the machine.
 */
export const settle = (page: Page): Promise<unknown> =>
  page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );

/** A stored task whose id is its text, so a seeded list reads as its shape. */
export const task = (text: string) => ({ kind: "task", id: text, text, target: 1, count: 0 });
