import { dayHue, HUE, hueMark, type DayScore } from "../progress";
import { dayStroke } from "../render/ring";

/**
 * The day's rainbow, unrolled: the scale the ring is painted from, laid flat
 * with the gates marked on it.
 *
 * Shared by both day cards on purpose. Two copies would be two rainbows able to
 * drift from `dayStroke` and from each other, and the whole point of the rail
 * is that it cannot disagree with the ring.
 *
 * The rail is the hue axis and the gates are landmarks *on* it, not divisions
 * of it — which is why the bar's tick sits at 80% rather than at a tidy
 * two-thirds, and why the green landmark can be absent while the dot is sitting
 * on green: with nothing marked the sweep runs red straight to blue, and a tick
 * there would promise a gate the ring is not keeping.
 */
export class Rail {
  readonly element: HTMLElement;
  #green: HTMLElement;
  #spent: HTMLElement;
  #you: HTMLElement;
  #marks: HTMLElement;

  constructor() {
    this.element = div("track");
    this.element.setAttribute("aria-hidden", "true");

    const rail = div("rail");
    /*
     * Sampled from `dayStroke` rather than written out as four stops: it is the
     * same function the ring is painted with, warm-band lift included. Painted
     * once, because the rainbow itself never changes — only the dot moves.
     */
    const stops: string[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const hue = HUE.red + (HUE.violet - HUE.red) * (i / steps);
      stops.push(`${dayStroke(hue)} ${((i / steps) * 100).toFixed(2)}%`);
    }
    rail.style.background = `linear-gradient(to right, ${stops.join(", ")})`;

    this.#green = tick(HUE.green);
    /*
     * The rainbow the day has not reached yet, dimmed. Without it the dot alone
     * had to answer "did it get past that gate?", and at 95% of the way to the
     * bar the dot's own halo covered the gate's mark entirely: a day the gates
     * called short read as a day sitting on the line.
     */
    this.#spent = span("");
    this.#spent.className = "spent";
    this.#you = div("you");
    rail.append(this.#green, tick(HUE.blue), this.#spent, this.#you);

    this.#marks = div("marks");
    const ends = div("ends");
    ends.append(span("nothing"), span("everything"));

    this.element.append(rail, this.#marks, ends);
  }

  /** Put the dot where the day is, and label the gates the day actually has. */
  paint(score: DayScore, bar: number): void {
    const hue = dayHue(score, bar);
    const here = at(hueMark(hue));
    this.#you.style.left = here;
    this.#you.style.background = dayStroke(hue);
    this.#spent.style.left = here;

    this.#green.hidden = !score.hasImportant;
    /*
     * Only the gates are placed labels: they sit under their own tick, wherever
     * their hue falls. The rail's ends are a fixed row of their own — laid out
     * against a landmark at 80% they collided with it, and the ends are the one
     * pair whose position never moves.
     */
    const label = (hue: number, text: string): HTMLElement => {
      const el = span(text);
      el.style.left = at(hueMark(hue));
      return el;
    };
    this.#marks.replaceChildren(
      ...(score.hasImportant ? [label(HUE.green, "important done")] : []),
      label(HUE.blue, "the bar"),
    );
  }
}

const at = (fraction: number): string => `${(fraction * 100).toFixed(2)}%`;

function div(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function span(text: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = text;
  return el;
}

function tick(hue: number): HTMLElement {
  const el = document.createElement("span");
  el.className = "tick";
  el.style.left = at(hueMark(hue));
  return el;
}
