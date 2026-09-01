import { allTasks, outstandingImportant, stepsToBar, summarise, type DayScore } from "../progress";
import type { State } from "../types";
import { need } from "./dom";
import { trapFocus } from "./focus";
import { dayGates } from "./gates";
import { Rail } from "./rail";

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

function formatElapsed(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} min in`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m in`;
}

/**
 * What the next tick buys.
 *
 * The closing card says nothing to an unfinished day, on the grounds that
 * praise for 2 of 9 is not believed twice. This card is the other half of that
 * rule rather than a breach of it: naming the next landmark is not praise, and
 * a card opened mid-morning that said nothing would be worth opening once.
 *
 * Ordered by which gate is still shut, so it always names the nearest one.
 */
export function nextLine(score: DayScore, left: number, steps: number): string {
  if (score.total === 0) return "";
  if (score.complete) return "Everything done.";
  if (score.succeeded) return `${plural(left, "thing", "things")} left for a clean sweep.`;
  if (score.hasImportant && !score.cleared)
    return `${plural(left, "important thing", "important things")} left, then the day turns green.`;
  const more = steps === 1 ? "One more" : `${String(steps)} more`;
  return score.hasImportant
    ? `The important work is done. ${more} clears the bar.`
    : `${more} and it's a good day.`;
}

/** What the rest of the list still owes the bar, while there is still a day to spend. */
function barNote(steps: number, bar: number): string {
  const at = `set at ${String(Math.round(bar * 100))}%`;
  if (steps === 0) return `past the bar, ${at}`;
  return steps === 1
    ? `one more clears the bar, ${at}`
    : `${String(steps)} more clear the bar, ${at}`;
}

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
      outstandingImportant(state.list).length,
      stepsToBar(state, bar),
    );
    this.#gates.replaceChildren(...dayGates(state, bar, (steps) => barNote(steps, bar)));

    this.#dur.textContent = summary.elapsedMs === null ? "" : formatElapsed(summary.elapsedMs);
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
