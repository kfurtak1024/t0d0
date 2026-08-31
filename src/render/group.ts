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

  /*
   * What a fold is still holding: the mark its hidden rows wear, and how many
   * of them are still to do.
   *
   * A folded group is the one place an important row can go out of sight while
   * the day still turns on it — the ring refuses to go green and nothing says
   * which group is the reason. So the group speaks for its contents here, the
   * way the tally beside it already does, rather than the fold letting rows
   * through: peeking would put the *item* back on screen in a group you have
   * just put away, and a group where everything is marked would peek nothing.
   *
   * aria-hidden because the same fact reaches a screen reader through the
   * chevron, which is the group's own handle — see the label below.
   */
  const mark = document.createElement("div");
  mark.className = "gmark";
  mark.setAttribute("aria-hidden", "true");
  const pip = document.createElement("span");
  pip.className = "pip";
  const left = document.createElement("span");
  left.className = "num";
  mark.append(pip, left);

  // The tally belongs to the title, so it sits with it; the actions go right,
  // where a task row keeps its own. They fade rather than unmount, so arriving
  // on hover shifts nothing.
  head.append(grip(), chevron, title, count, mark, plus, dots, kill);

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

    /*
     * Only what is still owed: marked *and* unfinished. Every automatic fold is
     * a group that has just finished, so counting finished rows too would leave
     * a badge sitting on exactly the groups the tidy had cleared away.
     */
    const owed = next.items.filter((item) => item.important && !isDone(item)).length;
    // Kept in the flow whenever there is something to say, and faded by the
    // fold — the same "fade rather than unmount" the header's actions use, so
    // collapsing shifts nothing sideways.
    mark.hidden = owed === 0;
    left.textContent = String(owed);

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
    // The badge is a visual channel only, so the count comes through here — and
    // only while folded, because an open group's rows say it themselves.
    const owing = next.collapsed && owed > 0 ? `, ${String(owed)} important left` : "";
    chevron.setAttribute(
      "aria-label",
      next.collapsed ? `Expand ${name}${owing}` : `Collapse ${name}`,
    );
    dots.setAttribute("aria-label", `More for ${next.title}`);
    kill.setAttribute("aria-label", `Delete ${next.title}`);

    list.patch(next.items);
  };

  update(group);
  return { key: group.id, element: box, update };
}
