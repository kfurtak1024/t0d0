import { summarise } from "../progress";
import { need } from "./dom";
import type { State } from "../types";
import { trapFocus } from "./focus";

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
  #panel: HTMLElement;
  #release: (() => void) | null = null;

  constructor(veil: HTMLElement, onConfirm: () => void) {
    this.#veil = veil;
    this.#panel = need(veil, ".sheet");
    this.#score = need(veil, ".score");
    this.#label = need(veil, ".of");
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
