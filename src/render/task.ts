import { isDone } from "../progress";
import type { Task } from "../types";
import { button, grip, icon, menuButton, type RowActions } from "./context";
import type { Keyed } from "./list";
import { makeRing, paintRing } from "./ring";

const RING_SIZE = { root: 26, nested: 24 } as const;

/**
 * Show the quantity as part of the label, styled, without touching stored text.
 *
 * The text lives in an inline span so the strike-through spans the words rather
 * than the whole flexed row.
 */
function writeLabel(el: HTMLElement, task: Task): void {
  const line = document.createElement("span");
  line.className = "line";
  line.textContent = task.text;

  if (task.target > 1) {
    const quantity = document.createElement("span");
    quantity.className = "qty";
    quantity.textContent = ` [${String(task.target)}]`;
    line.append(quantity);
  }
  el.replaceChildren(line);
}

export function createTask(task: Task, actions: RowActions, nested: boolean): Keyed<Task> {
  const size = nested ? RING_SIZE.nested : RING_SIZE.root;

  const row = document.createElement("li");
  row.className = "task";
  row.dataset["id"] = task.id;

  /*
   * The tick is a real <button>, so it is focusable and activates on Enter and
   * Space for free. Its ARIA role reports what the item actually is: a checkbox
   * when one press finishes it, a spinbutton when it takes several. The ring
   * itself is decorative once the button carries the semantics.
   */
  const tick = document.createElement("button");
  tick.type = "button";
  tick.className = "tick";

  let ring = makeRing(size, 3, task.target);
  ring.setAttribute("aria-hidden", "true");
  tick.append(ring);

  const label = document.createElement("div");
  label.className = "label";

  const count = document.createElement("button");
  count.type = "button";
  count.className = "count";

  const dots = menuButton("More");

  const kill = button("kill", "Delete");
  kill.append(icon("x"));

  // The row re-reads itself on every update, so handlers below decide from the
  // current task rather than the one this was built with.
  let current = task;

  /*
   * A plain item toggles, which is what `role="checkbox"` already promises —
   * before this the tick reported aria-checked and had no way back, and on a
   * phone (no Shift, no arrow keys, no count label) a mis-tap was permanent.
   *
   * A counted item does not toggle: counting up is the whole point of it, so
   * stepping down stays on the count label, the arrows, and the row menu.
   */
  tick.addEventListener("click", (event) => {
    if (event.shiftKey) {
      actions.bump(current.id, -1);
      return;
    }
    const undo = current.target === 1 && isDone(current);
    actions.bump(current.id, undo ? -1 : 1);
  });
  tick.addEventListener("keydown", (event) => {
    // Spinbutton conventions, and a way down that isn't Shift-click — but only
    // for a counted item. A plain one reports role="checkbox", which Space and
    // Enter already toggle; arrows are not a checkbox interaction, and having
    // them tick it made the key table in the README a lie.
    if (current.target <= 1) return;
    if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      actions.bump(current.id, -1);
    }
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      actions.bump(current.id, 1);
    }
  });
  count.addEventListener("click", () => {
    actions.bump(task.id, -1);
  });
  dots.addEventListener("click", () => {
    actions.openMenu(dots, task.id);
  });
  kill.addEventListener("click", () => {
    actions.remove(task.id);
  });
  label.addEventListener("click", () => {
    actions.beginEdit(label, task.id, false);
  });

  row.append(grip(), tick, label, count, dots, kill);

  const update = (next: Task): void => {
    current = next;
    row.classList.toggle("done", isDone(next));
    row.classList.toggle("important", next.important);

    // The arc count is baked into the ring, so a changed target needs a new one.
    if (ring.target !== next.target) {
      const fresh = makeRing(size, 3, next.target);
      fresh.setAttribute("aria-hidden", "true");
      ring.replaceWith(fresh);
      ring = fresh;
    }
    paintRing(ring, next.count, next.target);

    if (!actions.isEditing(next.id)) writeLabel(label, next);

    count.hidden = next.target <= 1;
    count.textContent = next.target > 1 ? `${String(next.count)}/${String(next.target)}` : "";
    count.setAttribute("aria-label", `${next.text}: one fewer`);

    if (next.target > 1) {
      tick.setAttribute("role", "spinbutton");
      tick.setAttribute("aria-valuenow", String(next.count));
      tick.setAttribute("aria-valuemin", "0");
      tick.setAttribute("aria-valuemax", String(next.target));
      tick.setAttribute("aria-valuetext", `${String(next.count)} of ${String(next.target)} done`);
      tick.removeAttribute("aria-checked");
    } else {
      tick.setAttribute("role", "checkbox");
      tick.setAttribute("aria-checked", String(isDone(next)));
      for (const attr of ["aria-valuenow", "aria-valuemin", "aria-valuemax", "aria-valuetext"]) {
        tick.removeAttribute(attr);
      }
    }
    // The accent bar is a visual channel and nothing else, so the one control
    // that carries the row's name says it out loud too.
    tick.setAttribute("aria-label", next.important ? `${next.text}, important` : next.text);
    dots.setAttribute("aria-label", `More for ${next.text}`);
    kill.setAttribute("aria-label", `Delete ${next.text}`);
  };

  update(task);
  return { key: task.id, element: row, update };
}

/** Replay the tick animation without re-rendering the row. */
export function popRing(row: HTMLElement): void {
  const ring = row.querySelector(".ring");
  if (!ring) return;
  ring.classList.remove("pop");
  void (ring as HTMLElement).offsetWidth;
  ring.classList.add("pop");
}

/** The row's keyboard handle, for restoring focus after a move. */
export const tickOf = (row: HTMLElement): HTMLElement | null =>
  row.querySelector<HTMLElement>(".tick");
