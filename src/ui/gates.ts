import { dayGates, type Gate } from "../progress";
import { hueAt } from "../render/ring";
import type { State } from "../types";
import { stepsToBar } from "../progress";
import { andMore, shortlist } from "../words";

/**
 * The day's two gates, as both cards draw them.
 *
 * Which gates exist and how full each one is comes from `dayGates` in
 * progress.ts — the same numbers whether you ask mid-morning or at the close.
 * The *words* are not shared: the caller supplies the note under the second
 * gate, because one card is looking forward ("one more clears the bar") and the
 * other is reporting a day that is over ("short of the bar"), and flattening
 * that into one voice would make one of them wrong.
 */
export function renderGates(
  state: State,
  bar: number,
  note: (steps: number) => string,
): HTMLElement[] {
  const steps = stepsToBar(state, bar);
  return dayGates(state, bar).map((gate) =>
    render(
      gate,
      gate.key === "important"
        ? gate.met
          ? "all done"
          : ""
        : gate.total === 0
          ? "nothing here but marked work"
          : note(steps),
    ),
  );
}

/**
 * The bar behind a gate's tally.
 *
 * The tally says the number and the bar says the proportion, which is the thing
 * a number alone does not give you: "3 of 5" and "12 of 20" read the same until
 * you see them. It fills to the gate's own mean rather than to done/total, so a
 * part-counted item moves it — the same measure the ring uses.
 *
 * `hueAt`'s indigo→green, not the day's rainbow. Only the day ring wears that,
 * and a gate is a thing that gets finished, so it ends on the same green as a
 * finished row's frame.
 *
 * The threshold is drawn over the fill rather than beside it, and only where
 * there is a line short of everything: the marked work has no bar to clear, it
 * simply has to be done.
 *
 * `aria-hidden`, because the tally beside it already says the number and the
 * outstanding rows are named underneath — this is the same fact a third time,
 * in the one channel that is not available to everyone.
 */
function bar(gate: Gate): HTMLElement {
  const box = document.createElement("div");
  box.className = "gbar";
  box.setAttribute("aria-hidden", "true");

  const fill = document.createElement("span");
  fill.className = "gfill";
  fill.style.setProperty("--fill", `${(gate.fill * 100).toFixed(2)}%`);
  fill.style.setProperty("--gate-hue", hueAt(gate.fill).toFixed(1));
  box.append(fill);

  if (gate.threshold !== null && gate.threshold < 1 && gate.total > 0) {
    const mark = document.createElement("span");
    mark.className = "gthreshold";
    mark.style.left = `${(gate.threshold * 100).toFixed(2)}%`;
    box.append(mark);
  }
  return box;
}

function render(gate: Gate, note: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "gate";
  if (gate.met) box.classList.add("met");

  const head = document.createElement("div");
  head.className = "ghead-row";
  const title = document.createElement("span");
  title.className = "gname";
  title.textContent = gate.name;
  const number = document.createElement("span");
  number.className = "gtally";
  number.textContent = `${String(gate.done)} of ${String(gate.total)}`;
  head.append(title, number);

  /*
   * A gate that has been met says so, once, at the end of its own row.
   * Decorative: the tally beside it and the note beneath already carry it, and
   * on the closing card this is the thing that stamps in — a mark arriving is
   * worth more than a colour changing.
   */
  if (gate.met) {
    const stamp = document.createElement("span");
    stamp.className = "gstamp";
    stamp.textContent = "✓";
    stamp.setAttribute("aria-hidden", "true");
    head.append(stamp);
  }
  box.append(head);

  // Nothing to show the proportion of, so no bar — the same rule that keeps an
  // empty group out of the ring.
  if (gate.total > 0) box.append(bar(gate));

  if (gate.outstanding.length > 0) {
    box.append(namedList(gate.outstanding.map((task) => task.text)));
  }

  if (note !== "") {
    const line = document.createElement("p");
    line.className = "gnote";
    line.textContent = note;
    box.append(line);
  }
  return box;
}

/**
 * A capped list of row names, with the rest counted.
 *
 * Shared with the closing card's "Got done", which is the same shape of thing
 * said about the other half of the day — so the two cannot end up capping or
 * phrasing it differently.
 */
export function namedList(texts: string[]): HTMLElement {
  const { named, more } = shortlist(texts);
  const list = document.createElement("ul");
  list.className = "gitems";
  for (const text of named) {
    const row = document.createElement("li");
    const pip = document.createElement("span");
    pip.className = "pip";
    pip.setAttribute("aria-hidden", "true");
    row.append(pip, document.createTextNode(text));
    list.append(row);
  }
  if (more > 0) {
    const rest = document.createElement("li");
    rest.className = "gmore";
    rest.textContent = andMore(more);
    list.append(rest);
  }
  return list;
}
