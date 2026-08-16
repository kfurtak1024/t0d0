import { summarise } from "../progress";
import type { State } from "../types";

function formatElapsed(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * The end-of-day card. It reports before it resets: an ordinary 7-of-9 day
 * gets an ending, not just a perfect one.
 */
export class DaySheet {
  #veil: HTMLElement;
  #score: HTMLElement;
  #label: HTMLElement;
  #cleared: HTMLElement;
  #elapsed: HTMLElement;

  constructor(veil: HTMLElement, onConfirm: () => void) {
    this.#veil = veil;
    this.#score = veil.querySelector(".score") as HTMLElement;
    this.#label = veil.querySelector(".of") as HTMLElement;
    this.#cleared = veil.querySelector(".cleared") as HTMLElement;
    this.#elapsed = veil.querySelector(".dur") as HTMLElement;

    (veil.querySelector(".confirm") as HTMLButtonElement).addEventListener("click", () => {
      onConfirm();
      this.hide();
    });
    (veil.querySelector(".dismiss") as HTMLButtonElement).addEventListener("click", () => {
      this.hide();
    });
    veil.addEventListener("click", (event) => {
      if (event.target === veil) this.hide();
    });
  }

  get isOpen(): boolean {
    return !this.#veil.hidden;
  }

  show(state: State, now: number): void {
    const summary = summarise(state, now);
    this.#score.textContent = `${String(summary.done)} of ${String(summary.total)}`;
    this.#label.textContent =
      summary.total > 0 && summary.done === summary.total ? "all done" : "done";

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
  }

  hide(): void {
    this.#veil.hidden = true;
  }
}
