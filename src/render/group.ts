import { isDone } from "../progress";
import type { Group, Task } from "../types";
import { button, grip, icon, menuButton, type RowActions } from "./context";
import { KeyedList, type Keyed } from "./list";
import { createTask } from "./task";

export function createGroup(group: Group, actions: RowActions): Keyed<Group> {
  const box = document.createElement("li");
  box.className = "group";
  box.dataset["id"] = group.id;

  const head = document.createElement("div");
  head.className = "ghead";

  const chevron = button("chev", "Collapse");
  chevron.append(icon("chev"));

  const title = document.createElement("div");
  title.className = "gtitle";

  const plus = button("plus", `Add to ${group.title}`);
  plus.textContent = "+";

  const dots = menuButton("More");

  const kill = button("kill", "Delete group");
  kill.append(icon("x"));

  const count = document.createElement("div");
  count.className = "gcount";

  // The tally belongs to the title, so it sits with it; the actions go right,
  // where a task row keeps its own. They fade rather than unmount, so arriving
  // on hover shifts nothing.
  head.append(grip(), chevron, title, count, plus, dots, kill);

  const body = document.createElement("div");
  body.className = "gbody";
  const inner = document.createElement("div");
  inner.className = "inner";
  const items = document.createElement("ul");
  items.className = "items";
  inner.append(items);
  body.append(inner);
  box.append(head, body);

  const list = new KeyedList<Task>(items, (task) => createTask(task, actions, true));

  chevron.addEventListener("click", () => {
    actions.toggleCollapse(group.id);
  });
  kill.addEventListener("click", () => {
    actions.remove(group.id);
  });
  plus.addEventListener("click", () => {
    actions.aim(group.id);
  });
  dots.addEventListener("click", () => {
    actions.openMenu(dots, group.id);
  });
  title.addEventListener("click", () => {
    actions.beginEdit(title, group.id, true);
  });

  const update = (next: Group): void => {
    box.classList.toggle("collapsed", next.collapsed);
    box.classList.toggle("important", next.important);
    // Collapsing hides the rows visually; inert takes them out of the tab order
    // too, so nobody focuses a row they cannot see.
    body.toggleAttribute("inert", next.collapsed);
    if (!actions.isEditing(next.id)) title.textContent = next.title;

    const done = next.items.filter(isDone).length;
    count.textContent = next.items.length
      ? `${String(done)}/${String(next.items.length)}`
      : "empty";
    box.classList.toggle("clear", next.items.length > 0 && done === next.items.length);

    plus.classList.toggle("aimed", actions.isAimed(next.id));
    plus.setAttribute("aria-label", `Add to ${next.title}`);
    chevron.setAttribute("aria-expanded", String(!next.collapsed));
    // Same reasoning as the tick's label: the chevron is the group's own handle,
    // so it is where the mark reaches a screen reader.
    const name = next.important ? `${next.title}, important` : next.title;
    chevron.setAttribute("aria-label", next.collapsed ? `Expand ${name}` : `Collapse ${name}`);
    dots.setAttribute("aria-label", `More for ${next.title}`);
    kill.setAttribute("aria-label", `Delete ${next.title}`);

    list.patch(next.items);
  };

  update(group);
  return { key: group.id, element: box, update };
}
