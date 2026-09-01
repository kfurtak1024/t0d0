import { summarise, type DayScore } from "../progress";
import { departing } from "../transitions";
import { need } from "./dom";
import type { State } from "../types";
import { trapFocus } from "./focus";
import { dayGates } from "./gates";
import { Rail } from "./rail";

function formatElapsed(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * What the day amounted to, in one line.
 *
 * Ordered by what outranks what, so a perfect day is not also told that the
 * important things are done — it says the biggest true thing and stops. An
 * unfinished day says nothing rather than something consoling; the score above
 * it already reports honestly, and a card that praises 2 of 9 is not a card
 * anyone believes twice.
 */
function verdictOf(score: DayScore): string {
  if (score.complete) return "Everything done.";
  if (score.succeeded) return "That's a good day.";
  if (score.hasImportant && score.cleared) return "The important things are done.";
  return "";
}

/**
 * What this close takes away for good, in one line.
 *
 * Ticks come back tomorrow; a removed one-off does not, and undo is a single
 * level that does not survive a reload — so the loss has to be visible at the
 * moment of pressing rather than discovered in the morning.
 *
 * Named while naming them is short, counted once it would not be. One line
 * either way: this is the card that must fit without scrolling, and a list
 * that grows with the day would be the thing that pushed the button under the
 * fold.
 */
function departingNote(titles: string[]): string {
  const quoted = titles.map((title) => `“${title}”`);
  if (quoted.length === 0) return "";
  if (quoted.length === 1) return `${String(quoted[0])} will be removed.`;
  if (quoted.length === 2) return `${String(quoted[0])} and ${String(quoted[1])} will be removed.`;
  return `${String(quoted.length)} finished one-off items will be removed.`;
}

/** How the rest of the list finished against the bar, for a day that is over. */
function barNote(steps: number, bar: number): string {
  const at = `set at ${String(Math.round(bar * 100))}%`;
  return steps === 0 ? `past the bar, ${at}` : `short of the bar, ${at}`;
}

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
    this.#panel.insertBefore(this.#rail.element, this.#gates);

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
    this.#gates.replaceChildren(...dayGates(state, bar, (steps) => barNote(steps, bar)));
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
      summary.elapsedMs === null ? "" : `${formatElapsed(summary.elapsedMs)} since you started`;

    const note = departingNote(departing(state).map((task) => task.text));
    this.#departing.textContent = note;
    this.#departing.hidden = note === "";

    this.#veil.hidden = false;
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
