import { summarise, type DayScore, type DaySummary } from "../progress";
import { departing } from "../transitions";
import { barAtClose, departingNote, didHeading, verdictOf } from "../words";
import { keyboardScrollable, need } from "./dom";
import type { State } from "../types";
import { trapFocus } from "./focus";
import { renderGates } from "./gates";
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
/*
 * A gate's bar fills while its finished rows are counted off over it, so the
 * two are one event: the bar moves *because* that name just landed. A gate with
 * nothing finished still gets the floor, so an empty one does not simply blink.
 *
 * The step is clamped rather than fixed, so a thirty-item day is a satisfying
 * blur instead of half a minute — the whole run has to stay something you can
 * sit through in front of a destructive button, and can cut short at any press.
 */
const FLASH_STEP_MS = 420;
const FLASH_MIN_MS = 90;
const PHASE_MIN_MS = 620;
const BUDGET_MS = 1900;
const COUNT_MS = 900;

/**
 * How long a gate's phase runs, and how far apart its names land.
 *
 * An unhurried step on an ordinary day — this is the reward, and a name gone
 * before it registered is not one. A busy gate divides a budget instead, down
 * to a floor, and its phase stretches to fit rather than letting the names
 * outrun the bar they are filling: the step is chosen first and the phase is
 * whatever holds it.
 */
function pace(names: number): { phase: number; step: number } {
  if (names === 0) return { phase: PHASE_MIN_MS, step: 0 };
  const step = Math.min(FLASH_STEP_MS, Math.max(FLASH_MIN_MS, BUDGET_MS / names));
  return { phase: Math.max(PHASE_MIN_MS, names * step), step };
}

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
      /*
       * The heading alone. The list of names under it was a quarter of the
       * card's height and the card was already overflowing its box on a phone;
       * the names are counted off over the gates instead, and what survives is
       * this line — which is also what reduced motion and a screen reader get,
       * so the record does not live only inside an animation.
       */
      this.#did.replaceChildren(title);
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

    /*
     * One phase per gate, in the order the day turns on them: the marked work
     * first, then everything else. Each phase fills that gate's bar while its
     * finished rows rise and vaporise over it, and the next phase does not begin
     * until the one before has finished — which is what makes the card read as
     * "the important work, and then the rest" rather than as two bars racing.
     */
    let at = 0;

    for (const gate of this.#gates.querySelectorAll<HTMLElement>(".gate")) {
      const fill = gate.querySelector<HTMLElement>(".gfill");
      const names = [...gate.querySelectorAll<HTMLElement>(".gflash span")];
      const { phase, step } = pace(names.length);

      if (fill) {
        this.#playing.push(
          /*
           * A steady fill, and linear on purpose twice over.
           *
           * The names land evenly across the same phase, so at the moment the
           * i-th lands the bar is exactly i-of-n along: the correspondence is
           * exact without the bar having to jump for it. Stepping it per name
           * was tried and read as a lurch — the landing's overshoot carried the
           * bar past each mark and pulled it back, so a two-item gate wobbled
           * backwards twice. An easing here would slide the bar off the names
           * as surely as the steps did.
           */
          fill.animate([{ width: "0%" }, { width: fill.style.getPropertyValue("--fill") }], {
            duration: phase,
            delay: at,
            easing: "linear",
            fill: "backwards",
          }),
        );
      }

      names.forEach((name, index) => {
        this.#playing.push(
          name.animate(
            [
              { opacity: 0, transform: "translateY(12px) scale(0.92)" },
              // Arrives past its size and settles back, so it lands rather than
              // merely appears.
              { opacity: 1, transform: "translateY(0) scale(1.06)", offset: 0.18 },
              { opacity: 1, transform: "none", offset: 0.32 },
              { opacity: 1, transform: "none", offset: 0.62 },
              { opacity: 0, transform: "translateY(-20px) scale(1)" },
            ],
            {
              // Held well past the step, so one name is still on its way out as
              // the next arrives and the run reads as a stream rather than a
              // flicker.
              duration: Math.max(step * 1.9, 520),
              delay: at + index * step,
              easing: "cubic-bezier(0.22, 1.1, 0.36, 1)",
              fill: "backwards",
            },
          ),
        );
      });

      // The ✓ lands as its own phase closes, never before its bar has arrived.
      const stamp = gate.querySelector<HTMLElement>(".gstamp");
      if (stamp) {
        this.#playing.push(
          stamp.animate(
            [
              { transform: "scale(0)", opacity: 0 },
              { transform: "none", opacity: 1 },
            ],
            {
              duration: 320,
              delay: at + phase,
              // Overshoots, because a stamp that lands should look like it landed.
              easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
              fill: "backwards",
            },
          ),
        );
      }
      at += phase;
    }

    if (!this.#rail.element.hidden) this.#playing.push(...this.#rail.play(0, Math.max(at, 1)));

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
      this.#cheer = setTimeout(() => {
        this.#celebrate(summary.score);
      }, at);
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
