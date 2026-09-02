import { summarise } from "../progress";
import { departing } from "../transitions";
import { barAtClose, departingNote, elapsed, verdictOf } from "../words";
import { keyboardScrollable, need } from "./dom";
import type { State } from "../types";
import { trapFocus } from "./focus";
import { dayGates } from "./gates";
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
export class DaySheet {
  #veil: HTMLElement;
  #score: HTMLElement;
  #label: HTMLElement;
  #verdict: HTMLElement;
  #rail = new Rail();
  #gates: HTMLElement;
  #cleared: HTMLElement;
  #departing: HTMLElement;
  #elapsed: HTMLElement;
  #panel: HTMLElement;
  #body: HTMLElement;
  #release: (() => void) | null = null;

  constructor(veil: HTMLElement, onConfirm: () => void) {
    this.#veil = veil;
    this.#panel = need(veil, ".sheet");
    this.#score = need(veil, ".score");
    this.#label = need(veil, ".of");
    this.#verdict = need(veil, ".verdict");
    this.#gates = need(veil, "#closegates");
    this.#cleared = need(veil, ".cleared");
    this.#departing = need(veil, ".departing");
    this.#elapsed = need(veil, ".dur");
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
  }

  get isOpen(): boolean {
    return !this.#veil.hidden;
  }

  show(state: State, now: number, bar: number): void {
    const summary = summarise(state, now, bar);
    this.#score.textContent = `${String(summary.done)} of ${String(summary.total)}`;
    this.#label.textContent =
      summary.total > 0 && summary.done === summary.total ? "all done" : "done";

    const verdict = verdictOf(summary.score);
    this.#verdict.textContent = verdict;
    this.#verdict.hidden = verdict === "";

    this.#rail.paint(summary.score, bar);
    this.#gates.replaceChildren(...dayGates(state, bar, (steps) => barAtClose(steps, bar)));
    // An empty list has no gates to report and no rail worth reading.
    this.#rail.element.hidden = summary.total === 0;

    this.#cleared.replaceChildren(
      ...summary.clearedGroups.map((title) => {
        const li = document.createElement("li");
        li.textContent = `${title} cleared`;
        return li;
      }),
    );

    this.#elapsed.textContent =
      summary.elapsedMs === null ? "" : `${elapsed(summary.elapsedMs)} since you started`;

    const note = departingNote(departing(state).map((task) => task.text));
    this.#departing.textContent = note;
    this.#departing.hidden = note === "";

    this.#veil.hidden = false;
    // After the content is in and the box has a height to measure.
    keyboardScrollable(this.#body);
    // Not the confirm button: Enter would clear the day on sight.
    this.#release = trapFocus(this.#veil, this.#panel);
  }

  hide(): void {
    if (this.#veil.hidden) return;
    this.#veil.hidden = true;
    this.#release?.();
    this.#release = null;
  }
}
