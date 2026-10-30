import { test as base, expect, type Page } from "@playwright/test";
import {
  COLLAPSE_MS,
  CONFIRM_MS,
  COUNT_UP_MS,
  EXIT_MS,
  SCORE_COUNT_MS,
  TOAST_MS,
} from "../../src/timing";

/** One animation frame, as the held clock paces them. */
const FRAME_MS = 16;

export { expect };

/**
 * Every spec's `test`, with the page's clock held from before the first load.
 *
 * The app moves things on timers — a finished row sinks into the pile 520ms
 * after its tick — and a spec racing those timers was asking how fast the
 * runner got round to its next step. About twenty of them lost that race on a
 * slow CI runner, one per run, and only on WebKit: a click landed where a row
 * used to be, two ticks either side of the tidy stacked the pile differently,
 * a "not yet" was read too late. With the clock held, nothing moves until a
 * test says so, and a forgotten advance fails every time instead of rarely.
 *
 * Holding is the default and opting out is the exception, because the race is
 * silent and the opt-out is not. `test.use({ realTime: true })` is for specs
 * whose subject runs on frames: a held clock also holds `requestAnimationFrame`,
 * so the closing card's reveal, the `#pct` count-up and the confetti stand still.
 */
export const test = base.extend<{ realTime: boolean; heldClock: undefined }>({
  realTime: [false, { option: true }],
  heldClock: [
    async ({ page, realTime }, use) => {
      if (!realTime) {
        const now = Date.now();
        await page.clock.install({ time: now });
        // The installed clock runs in real time until it is paused, and pausing
        // in its past throws — which a stalled runner managed with a one-second
        // margin. A minute cannot be overtaken, and nothing the app schedules
        // lasts that long, so the jump only fires what was due anyway.
        await page.clock.pauseAt(now + 60_000);
      }
      await use(undefined);
    },
    { auto: true },
  ],
});

/** Let the tidy's delay pass: queued rows sink, finished groups fold. */
export const passTidy = (page: Page): Promise<void> => page.clock.runFor(COLLAPSE_MS + 1);

/** Let a deleted row's exit finish, so it leaves the list. */
export const passExit = (page: Page): Promise<void> => page.clock.runFor(EXIT_MS + 1);

/** Let the toast time out, and the undo it offered with it. */
export const passToast = (page: Page): Promise<void> => page.clock.runFor(TOAST_MS + 1);

/** Let a control waiting in its confirm state revert. */
export const passConfirm = (page: Page): Promise<void> => page.clock.runFor(CONFIRM_MS + 1);

/**
 * Run one animation frame. A held clock holds `requestAnimationFrame` too, so
 * anything the app does "on the next frame" — handing focus back after a
 * keyboard move — waits for this.
 */
export const nextFrame = (page: Page): Promise<void> => page.clock.runFor(FRAME_MS);

/**
 * Let the header's percentage finish counting up. It counts on frames, so the
 * last write lands on the first frame past the duration, not at it.
 */
export const passCountUp = (page: Page): Promise<void> =>
  page.clock.runFor(COUNT_UP_MS + 2 * FRAME_MS);

/**
 * Let the closing card's reveal run: released on the first frame, then the
 * score counting up to the day. The bars travel on the page's real timeline
 * and are not held; a spec about them scrubs them instead.
 */
export const passReveal = async (page: Page): Promise<void> => {
  await nextFrame(page);
  await page.clock.runFor(SCORE_COUNT_MS + 2 * FRAME_MS);
};
