import { allTasks, outstandingImportant, stepsToBar, summarise } from "../progress";
import type { State } from "../types";
import { barSoFar, elapsed, nextLine } from "../words";
import { need } from "./dom";
import { trapFocus } from "./focus";
import { dayGates } from "./gates";
import { Rail } from "./rail";

/**
 * Where the day stands, on the ring's own terms.
 *
 * It reports and does nothing else: the closer is the only way to end a day,
 * and a second card that could clear the list would be a second answer to the
 * same question. So this one's only button goes back to the list.
 */
export class StandsSheet {
  #veil: HTMLElement;
  #panel: HTMLElement;
  #score: HTMLElement;
  #of: HTMLElement;
  #rail = new Rail();
  #next: HTMLElement;
  #gates: HTMLElement;
  #dur: HTMLElement;
  #release: (() => void) | null = null;

  constructor(veil: HTMLElement) {
    this.#veil = veil;
    this.#panel = need(veil, ".sheet");
    this.#score = need(veil, "#standsscore");
    this.#of = need(veil, ".of");
    this.#next = need(veil, "#standsnext");
    this.#gates = need(veil, "#standsgates");
    this.#dur = need(veil, "#standsdur");
    this.#panel.insertBefore(this.#rail.element, this.#next);

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
    const { score } = summary;

    this.#score.textContent = `${String(summary.done)} of ${String(summary.total)}`;
    this.#of.textContent = summary.done === summary.total ? "all done" : "done";

    this.#rail.paint(score, bar);
    this.#next.textContent = nextLine(
      score,
      {
        important: outstandingImportant(state.list).length,
        unfinished: summary.total - summary.done,
      },
      stepsToBar(state, bar),
    );
    this.#gates.replaceChildren(...dayGates(state, bar, (steps) => barSoFar(steps, bar)));

    this.#dur.textContent = summary.elapsedMs === null ? "" : `${elapsed(summary.elapsedMs)} in`;
    this.#dur.hidden = summary.elapsedMs === null;

    this.#veil.hidden = false;
    this.#release = trapFocus(this.#veil, this.#panel);
  }

  hide(): void {
    if (this.#veil.hidden) return;
    this.#veil.hidden = true;
    this.#release?.();
    this.#release = null;
  }
}

/** Whether there is anything for the card to report. */
export const hasDay = (state: State): boolean => allTasks(state.list).length > 0;
