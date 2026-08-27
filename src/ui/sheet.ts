import { summarise, type DayScore } from "../progress";
import { need } from "./dom";
import type { State } from "../types";
import { trapFocus } from "./focus";

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
 * The end-of-day card. It reports before it resets: an ordinary 7-of-9 day
 * gets an ending, not just a perfect one.
 */
export class DaySheet {
  #veil: HTMLElement;
  #score: HTMLElement;
  #label: HTMLElement;
  #verdict: HTMLElement;
  #cleared: HTMLElement;
  #elapsed: HTMLElement;
  #panel: HTMLElement;
  #release: (() => void) | null = null;

  constructor(veil: HTMLElement, onConfirm: () => void) {
    this.#veil = veil;
    this.#panel = need(veil, ".sheet");
    this.#score = need(veil, ".score");
    this.#label = need(veil, ".of");
    this.#verdict = need(veil, ".verdict");
    this.#cleared = need(veil, ".cleared");
    this.#elapsed = need(veil, ".dur");

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

    this.#cleared.replaceChildren(
      ...summary.clearedGroups.map((title) => {
        const li = document.createElement("li");
        li.textContent = `${title} cleared`;
        return li;
      }),
    );

    this.#elapsed.textContent =
      summary.elapsedMs === null ? "" : `${formatElapsed(summary.elapsedMs)} since you started`;

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
