/**
 * Regenerates the README screenshots from the real built app.
 *
 * Run `npm run screenshots` after anything that changes how the list looks —
 * palette tokens, row or group markup, spacing. Nothing verifies these are
 * current (a screenshot diff across machines is all font antialiasing and no
 * signal), so it is a deliberate step, not a check.
 *
 * The seeded day is chosen to exercise every state the list can be in: a
 * cleared group with its frame and tinted rail, a partially counted item
 * mid-sweep, a finished standalone item, untouched items, an important group
 * and an important row with their accent bars, the destination picker and the
 * composer hint. Keep it that way — if a screenshot stops showing a state,
 * that state stops being reviewed.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".github");
const PORT = 4180;
const URL = `http://localhost:${PORT}/`;

const DEMO_DAY = {
  v: 1,
  openedAt: Date.now() - 3 * 60 * 60 * 1000,
  list: [
    {
      kind: "group",
      id: "g1",
      title: "Morning",
      collapsed: false,
      items: [
        { kind: "task", id: "t1", text: "eat breakfast", target: 1, count: 1 },
        { kind: "task", id: "t2", text: "walk the dog", target: 1, count: 1 },
      ],
    },
    {
      kind: "group",
      id: "g2",
      title: "Work",
      collapsed: false,
      important: true,
      items: [
        { kind: "task", id: "t3", text: "make calls", target: 3, count: 1 },
        { kind: "task", id: "t4", text: "review the PR", target: 1, count: 1 },
        { kind: "task", id: "t5", text: "write release notes", target: 1, count: 0 },
      ],
    },
    { kind: "task", id: "t6", text: "shopping", target: 1, count: 0, important: true },
    { kind: "task", id: "t7", text: "stretch", target: 1, count: 0 },
  ],
};

const waitForServer = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`preview server never answered on ${URL}`);
};

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT,
  stdio: "ignore",
});

try {
  await waitForServer();
  const browser = await chromium.launch();

  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 470, height: 660 },
      colorScheme: scheme,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    await page.goto(URL);
    await page.evaluate((day) => {
      localStorage.setItem("t0d0/v1", JSON.stringify(day));
    }, DEMO_DAY);
    await page.reload();

    await page.waitForSelector(".group");
    // Rows fade in via @starting-style; shooting mid-transition captures
    // half-opacity text, which is exactly the wrong thing to publish.
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".task, .group")].every(
        (el) => getComputedStyle(el).opacity === "1",
      ),
    );
    // …and the percentage counts up on its own timer.
    await page.waitForTimeout(700);

    const file = join(OUT, `screenshot-${scheme}.png`);
    await page.screenshot({ path: file });
    console.warn(`wrote .github/screenshot-${scheme}.png`);
    await context.close();
  }

  await browser.close();
} finally {
  server.kill();
}
