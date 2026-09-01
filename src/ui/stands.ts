import {
  allTasks,
  dayHue,
  HUE,
  hueMark,
  isDone,
  outstandingImportant,
  partition,
  stepsToBar,
  summarise,
  type DayScore,
} from "../progress";
import { dayStroke } from "../render/ring";
import type { State, Task } from "../types";
import { need } from "./dom";
import { trapFocus } from "./focus";

/** How many rows of marked work the card names before it stops listing them. */
const NAMED = 4;

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
  #rail: HTMLElement;
  #green: HTMLElement;
  #blue: HTMLElement;
  #you: HTMLElement;
  #marks: HTMLElement;
  #next: HTMLElement;
  #gates: HTMLElement;
  #dur: HTMLElement;
  #release: (() => void) | null = null;

  constructor(veil: HTMLElement) {
    this.#veil = veil;
    this.#panel = need(veil, ".sheet");
    this.#score = need(veil, "#standsscore");
    this.#of = need(veil, ".of");
    this.#rail = need(veil, "#standsrail");
    this.#green = need(veil, "#standsgreen");
    this.#blue = need(veil, "#standsblue");
    this.#you = need(veil, "#standsyou");
    this.#marks = need(veil, "#standsmarks");
    this.#next = need(veil, "#standsnext");
    this.#gates = need(veil, "#standsgates");
    this.#dur = need(veil, "#standsdur");

    /*
     * The rail is the whole rainbow and never changes, so it is painted once.
     * Sampled from `dayStroke` rather than written out as four stops: it is the
     * same function the ring is painted with, warm-band lift included, so the
     * two cannot drift apart.
     */
    const stops: string[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const hue = HUE.red + (HUE.violet - HUE.red) * (i / steps);
      stops.push(`${dayStroke(hue)} ${((i / steps) * 100).toFixed(2)}%`);
    }
    this.#rail.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
    this.#green.style.left = `${(hueMark(HUE.green) * 100).toFixed(2)}%`;
    this.#blue.style.left = `${(hueMark(HUE.blue) * 100).toFixed(2)}%`;

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
    const { important, rest } = partition(state.list);
    const left = outstandingImportant(state.list);
    const steps = stepsToBar(state, bar);

    this.#score.textContent = `${String(summary.done)} of ${String(summary.total)}`;
    this.#of.textContent = summary.done === summary.total ? "all done" : "done";

    const hue = dayHue(score, bar);
    this.#you.style.left = `${(hueMark(hue) * 100).toFixed(2)}%`;
    this.#you.style.background = dayStroke(hue);
    /*
     * Green is a landmark only when something is marked. With nothing marked
     * the sweep runs straight from red to blue and green is a colour it passes
     * through — a tick there would promise a gate that does not exist.
     */
    this.#green.hidden = !score.hasImportant;
    this.#paintMarks(score.hasImportant);

    this.#next.textContent = nextLine(score, left.length, steps);

    this.#gates.replaceChildren(
      ...(score.hasImportant
        ? [
            gate(
              "Important",
              `${String(important.filter(isDone).length)} of ${String(important.length)}`,
              left.length === 0 ? "all done" : "",
              left,
            ),
          ]
        : []),
      gate(
        score.hasImportant ? "Everything else" : "Everything",
        `${String(rest.filter(isDone).length)} of ${String(rest.length)}`,
        barNote(steps, bar, rest.length),
        [],
      ),
    );

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

  /**
   * The rail's placed labels, which are the gates that exist and nothing else.
   *
   * Only the gates are placed: they sit under their own tick, wherever their
   * hue falls. The rail's two ends are a fixed row of their own — laid out
   * against a landmark at 80% they collided with it, and the ends are the one
   * pair whose position never moves.
   */
  #paintMarks(hasImportant: boolean): void {
    const at = (fraction: number, text: string): HTMLElement => {
      const span = document.createElement("span");
      span.style.left = `${(fraction * 100).toFixed(2)}%`;
      span.textContent = text;
      return span;
    };
    this.#marks.replaceChildren(
      ...(hasImportant ? [at(hueMark(HUE.green), "important done")] : []),
      at(hueMark(HUE.blue), "the bar"),
    );
  }
}

/** What the rest of the list still owes the bar, in words. */
function barNote(steps: number, bar: number, restCount: number): string {
  const at = `set at ${String(Math.round(bar * 100))}%`;
  if (restCount === 0) return "nothing here but marked work";
  if (steps === 0) return `past the bar, ${at}`;
  return steps === 1
    ? `one more clears the bar, ${at}`
    : `${String(steps)} more clear the bar, ${at}`;
}

function gate(name: string, tally: string, note: string, items: Task[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "gate";

  const head = document.createElement("div");
  head.className = "ghead-row";
  const title = document.createElement("span");
  title.className = "gname";
  title.textContent = name;
  const count = document.createElement("span");
  count.className = "gtally";
  count.textContent = tally;
  head.append(title, count);
  box.append(head);

  if (items.length > 0) {
    const list = document.createElement("ul");
    list.className = "gitems";
    for (const task of items.slice(0, NAMED)) {
      const row = document.createElement("li");
      const pip = document.createElement("span");
      pip.className = "pip";
      pip.setAttribute("aria-hidden", "true");
      row.append(pip, document.createTextNode(task.text));
      list.append(row);
    }
    if (items.length > NAMED) {
      const more = document.createElement("li");
      more.className = "gmore";
      more.textContent = `and ${String(items.length - NAMED)} more`;
      list.append(more);
    }
    box.append(list);
  }

  if (note !== "") {
    const line = document.createElement("p");
    line.className = "gnote";
    line.textContent = note;
    box.append(line);
  }
  return box;
}

/** Whether there is anything for the card to report. */
export const hasDay = (state: State): boolean => allTasks(state.list).length > 0;
