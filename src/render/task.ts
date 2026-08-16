import { isDone } from "../progress";
import type { Task } from "../types";
import { button, icon, type RowActions } from "./context";
import type { Keyed } from "./list";
import { makeRing, paintRing, type Ring } from "./ring";

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

  const row = document.createElement("div");
  row.className = "task";
  row.dataset["id"] = task.id;
  row.tabIndex = 0;

  let ring = makeRing(size, 3, task.target);
  const label = document.createElement("div");
  label.className = "label";
  const count = document.createElement("div");
  count.className = "count";
  const kill = button("kill", "Delete");
  kill.append(icon("x"));

  const wireRing = (target: Ring): void => {
    target.setAttribute("role", "button");
    target.setAttribute("aria-label", "Toggle");
    // Shift-click steps back down; on touch the count label does the same job.
    target.addEventListener("click", (event) => {
      actions.bump(task.id, event.shiftKey ? -1 : 1);
    });
  };
  wireRing(ring);

  count.addEventListener("click", () => {
    actions.bump(task.id, -1);
  });
  kill.addEventListener("click", () => {
    actions.remove(task.id);
  });
  label.addEventListener("click", () => {
    actions.beginEdit(label, task.id, false);
  });

  row.append(ring, label, count, kill);

  const update = (next: Task): void => {
    row.classList.toggle("done", isDone(next));

    // The arc count is baked into the ring, so a changed target needs a new one.
    if (ring.target !== next.target) {
      const fresh = makeRing(size, 3, next.target);
      wireRing(fresh);
      ring.replaceWith(fresh);
      ring = fresh;
    }
    paintRing(ring, next.count, next.target);

    if (!actions.isEditing(next.id)) writeLabel(label, next);
    count.hidden = next.target <= 1;
    count.textContent = next.target > 1 ? `${String(next.count)}/${String(next.target)}` : "";
    row.setAttribute(
      "aria-label",
      `${next.text}, ${String(next.count)} of ${String(next.target)} done`,
    );
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
