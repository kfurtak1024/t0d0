import { isDone } from "../progress";
import type { Group, Task } from "../types";
import { button, icon, type RowActions } from "./context";
import { KeyedList, type Keyed } from "./list";
import { createTask } from "./task";

export function createGroup(group: Group, actions: RowActions): Keyed<Group> {
  const box = document.createElement("div");
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

  const kill = button("kill", "Delete group");
  kill.append(icon("x"));

  const count = document.createElement("div");
  count.className = "gcount";

  // Count sits flush right, after the actions, so it never shifts when they appear.
  head.append(chevron, title, plus, kill, count);

  const body = document.createElement("div");
  body.className = "gbody";
  const inner = document.createElement("div");
  inner.className = "inner";
  const items = document.createElement("div");
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
  title.addEventListener("click", () => {
    actions.beginEdit(title, group.id, true);
  });

  const update = (next: Group): void => {
    box.classList.toggle("collapsed", next.collapsed);
    if (!actions.isEditing(next.id)) title.textContent = next.title;

    const done = next.items.filter(isDone).length;
    count.textContent = next.items.length
      ? `${String(done)}/${String(next.items.length)}`
      : "empty";
    box.classList.toggle("clear", next.items.length > 0 && done === next.items.length);

    plus.classList.toggle("aimed", actions.isAimed(next.id));
    plus.setAttribute("aria-label", `Add to ${next.title}`);
    chevron.setAttribute("aria-expanded", String(!next.collapsed));

    list.patch(next.items);
  };

  update(group);
  return { key: group.id, element: box, update };
}
