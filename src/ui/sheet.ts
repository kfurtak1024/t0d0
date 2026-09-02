import { summarise, type DayScore, type DaySummary } from "../progress";
import { departing } from "../transitions";
import { barAtClose, departingNote, didHeading, verdictOf } from "../words";
import { keyboardScrollable, need } from "./dom";
import type { State } from "../types";
import { trapFocus } from "./focus";
import { namedList, renderGates } from "./gates";
import { Rail } from "./rail";

/**
 * The end-of-day card. It reports before it resets: an ordinary 7-of-9 day
 * gets an ending, not just a perfect one.
 *
 * It wears the same rail and the same gates as the mid-day card, because this
 * is the moment they matter most and the one card that erases something. A day
 * that finished 5 of 6 with the marked item outstanding used to read as a good
 * day and then clear the evidence: the number was honest and said nothing about
 * *which* thing was left, and the verdict line is deliberately silent there.
 * The rail and the gates are how the card can be honest without praising a day
 * that did not earn it — which is what lets `verdictOf` keep its silence.
 */
/*
 * How long the ceremony runs, end to end.
 *
 * Short on purpose. This is the one card with a destructive button, and an
 * animation you have to sit through before you can read what "Clear the ticks"
 * takes away is a worse problem than a card that does not move. Everything is
 * on screen from the first frame and only travels *to* its resting value, so a
 * run that is skipped or interrupted has lost nothing.
 */
const BARS_MS = 620;
const STAGGER_MS = 130;
const COUNT_MS = 560;

export class DaySheet {
  #veil: HTMLElement;
  #score: HTMLElement;
  #label: HTMLElement;
  #verdict: HTMLElement;
  #rail = new Rail();
  #gates: HTMLElement;
  #did: HTMLElement;
  #departing: HTMLElement;
  #panel: HTMLElement;
  #body: HTMLElement;
  #release: (() => void) | null = null;
  #celebrate: (score: DayScore) => void;
  #motion = matchMedia("(prefers-reduced-motion: reduce)");
  /** Everything the current run owns, so any of it can be cut short at once. */
  #playing: Animation[] = [];
  #countRaf = 0;
  #startRaf = 0;
  #cheer: ReturnType<typeof setTimeout> | undefined;
  /** What the score reads when it has finished arriving. */
  #done: string | null = null;

  constructor(veil: HTMLElement, onConfirm: () => void, celebrate: (score: DayScore) => void) {
    this.#veil = veil;
    this.#celebrate = celebrate;
    this.#panel = need(veil, ".sheet");
    this.#score = need(veil, ".score");
    this.#label = need(veil, ".of");
    this.#verdict = need(veil, ".verdict");
    this.#gates = need(veil, "#closegates");
    this.#did = need(veil, ".did");
    this.#departing = need(veil, ".departing");
    this.#body = need(veil, ".sheet-body");
    this.#body.insertBefore(this.#rail.element, this.#gates);

    need(veil, ".confirm").addEventListener("click", () => {
      onConfirm();
      this.hide();
    });
    need(veil, ".dismiss").addEventListener("click", () => {
      this.hide();
    });
    veil.addEventListener("click", (event) => {
      if (event.target === veil) this.hide();
    });

    /*
     * Any press or key cuts the run short and lands it. Captured, so it fires
     * before the button underneath acts on the same press — someone who reaches
     * straight for "Clear the ticks" should not have to wait out a flourish, and
     * should see the finished numbers on the way past.
     */
    for (const type of ["pointerdown", "keydown"] as const) {
      veil.addEventListener(
        type,
        () => {
          this.#land();
        },
        true,
      );
    }
  }

  get isOpen(): boolean {
    return !this.#veil.hidden;
  }

  show(state: State, bar: number): void {
    const summary = summarise(state, bar);
    this.#done = `${String(summary.done)} of ${String(summary.total)}`;
    this.#score.textContent = this.#done;
    this.#label.textContent =
      summary.total > 0 && summary.done === summary.total ? "all done" : "done";

    const verdict = verdictOf(summary.score);
    this.#verdict.textContent = verdict;
    this.#verdict.hidden = verdict === "";

    this.#rail.paint(summary.score, bar);
    this.#gates.replaceChildren(...renderGates(state, bar, (steps) => barAtClose(steps, bar)));
    // An empty list has no gates to report and no rail worth reading.
    this.#rail.element.hidden = summary.total === 0;

    /*
     * What the day actually came to, named. It sits under the gates on
     * purpose: those say what is still owed, and reading only those at the
     * moment the ticks are wiped made the close a list of what went undone.
     */
    const heading = didHeading(summary.done);
    this.#did.hidden = heading === "";
    if (heading !== "") {
      const title = document.createElement("p");
      title.className = "did-title";
      title.textContent = heading;
      this.#did.replaceChildren(title, namedList(summary.finished));
    }

    const note = departingNote(departing(state).map((task) => task.text));
    this.#departing.textContent = note;
    this.#departing.hidden = note === "";

    this.#veil.hidden = false;
    // After the content is in and the box has a height to measure.
    keyboardScrollable(this.#body);
    this.#play(summary);
    // Not the confirm button: Enter would clear the day on sight.
    this.#release = trapFocus(this.#veil, this.#panel);
  }

  /**
   * The ceremony: the numbers arrive rather than simply being there.
   *
   * Everything below only ever travels *to* a value already written into the
   * DOM, so reduced motion is not a separate path — it is this one, skipped.
   * That is also what makes {@link #land} a matter of finishing animations
   * rather than of re-rendering anything.
   */
  #play(summary: DaySummary): void {
    this.#land();
    if (this.#motion.matches || summary.total === 0) {
      // Still worth the shower, and it is instant anyway.
      this.#celebrate(summary.score);
      return;
    }

    const bars = [...this.#gates.querySelectorAll<HTMLElement>(".gfill")];
    bars.forEach((fill, index) => {
      this.#playing.push(
        fill.animate([{ width: "0%" }, { width: fill.style.getPropertyValue("--fill") }], {
          duration: BARS_MS,
          delay: index * STAGGER_MS,
          easing: "cubic-bezier(0.22, 0.68, 0.36, 1)",
          fill: "backwards",
        }),
      );
    });

    // A gate's ✓ lands once its own bar has arrived, not before it.
    this.#gates.querySelectorAll<HTMLElement>(".gstamp").forEach((stamp, index) => {
      this.#playing.push(
        stamp.animate(
          [
            { transform: "scale(0)", opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
          {
            duration: 320,
            delay: BARS_MS + index * STAGGER_MS,
            // Overshoots, because a stamp that lands should look like it landed.
            easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
            fill: "backwards",
          },
        ),
      );
    });

    if (!this.#rail.element.hidden) this.#playing.push(...this.#rail.play(0, BARS_MS));

    /*
     * Held at the start, then let go on the first painted frame — not at the
     * press.
     *
     * WebKit spends around 300ms getting this card on screen the first time
     * (the veil's blur, the card's own entry), and an animation whose clock
     * started at the press has by then already run most of its course:
     * measured, the bars stood 73% of the way along before a single frame had
     * been painted, so the reveal was over before it was ever seen. Everything
     * is created paused, which `fill: "backwards"` pins at its first keyframe,
     * so nothing shows a value it has not travelled to — the score included,
     * which is why that is written out here rather than inside the tween.
     */
    for (const animation of this.#playing) animation.pause();
    this.#score.textContent = `0 of ${String(summary.total)}`;
    this.#startRaf = requestAnimationFrame(() => {
      for (const animation of this.#playing) animation.play();
      this.#countUp(summary.done, summary.total);
      // Last, so the shower arrives on a card that has finished arriving.
      this.#cheer = setTimeout(
        () => {
          this.#celebrate(summary.score);
        },
        BARS_MS + bars.length * STAGGER_MS,
      );
    });
  }

  /** Count the score up to what it already says. */
  #countUp(done: number, total: number): void {
    if (done === 0) return;
    const started = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - started) / COUNT_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      this.#score.textContent = `${String(Math.round(done * eased))} of ${String(total)}`;
      if (k < 1) this.#countRaf = requestAnimationFrame(step);
    };
    this.#countRaf = requestAnimationFrame(step);
  }

  /**
   * End the run now, wherever it had got to, leaving the finished card behind.
   *
   * `finish()` rather than `cancel()`: the animations are all travelling toward
   * values the DOM already holds, so finishing them is the same picture as
   * never having started — and the score is written out in full rather than
   * left at whatever frame it reached.
   */
  #land(): void {
    cancelAnimationFrame(this.#startRaf);
    for (const animation of this.#playing) animation.finish();
    this.#playing = [];
    cancelAnimationFrame(this.#countRaf);
    clearTimeout(this.#cheer);
    if (this.#done !== null) this.#score.textContent = this.#done;
  }

  hide(): void {
    if (this.#veil.hidden) return;
    this.#land();
    this.#veil.hidden = true;
    this.#release?.();
    this.#release = null;
  }
}
