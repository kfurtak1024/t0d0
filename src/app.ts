import { normalize } from "./normalize";
import { allTasks, isComplete, isDone, overallProgress } from "./progress";
import { createGroup } from "./render/group";
import { KeyedList } from "./render/list";
import { hueAt, makeRing, paintRing } from "./render/ring";
import { createTask, popRing } from "./render/task";
import type { RowActions } from "./render/context";
import { onExternalChange } from "./storage";
import type { Store } from "./store";
import * as T from "./transitions";
import { raw } from "./parse";
import type { Group, Node, State, Task } from "./types";
import { Drawer } from "./ui/drawer";
import { Confetti } from "./ui/confetti";
import { beginEdit } from "./ui/edit";
import { DaySheet } from "./ui/sheet";
import { Toast } from "./ui/toast";

const STALE_MS = 16 * 60 * 60 * 1000;
const EXIT_MS = 200;

/** Query a required element, failing loudly rather than silently rendering nothing. */
function el(selector: string): HTMLElement {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`missing element: ${selector}`);
  return node;
}

export class App {
  #store: Store;
  #reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  #list = el("#list");
  #empty = el("#empty");
  #closer = el("#closeday") as HTMLButtonElement;
  #pct = el("#pct");
  #frac = el("#frac");
  #dest = el("#dest") as HTMLSelectElement;
  #destRow = el("#destrow");
  #input = el("#input") as HTMLInputElement;
  #composer = el(".composer");

  #totalRing = makeRing(40, 4, 1);
  #rows: KeyedList<Node>;
  #toast: Toast;
  #sheet: DaySheet;
  #drawer: Drawer;
  #confetti: Confetti;

  #destId: string | null = null;
  #editingId: string | null = null;
  #armed = true;
  #shownPct = 0;
  #tweenRaf = 0;

  constructor(store: Store) {
    this.#store = store;

    const actions: RowActions = {
      bump: (id, delta) => {
        this.#bump(id, delta);
      },
      remove: (id) => {
        this.#remove(id);
      },
      beginEdit: (element, id, isGroup) => {
        this.#beginEdit(element, id, isGroup);
      },
      toggleCollapse: (id) => {
        this.#store.apply(T.toggleCollapse(this.#state, id));
      },
      aim: (id) => {
        this.#destId = this.#destId === id ? null : id;
        this.#render();
        this.#input.focus();
      },
      isAimed: (id) => this.#destId === id,
      isEditing: (id) => this.#editingId === id,
    };

    // A root row is a task or a group; narrow on update so neither renderer is
    // ever handed the other's shape.
    this.#rows = new KeyedList<Node>(this.#list, (node) => {
      if (node.kind === "group") {
        const entry = createGroup(node, actions);
        return {
          key: entry.key,
          element: entry.element,
          update: (next) => {
            if (next.kind === "group") entry.update(next);
          },
        };
      }
      const entry = createTask(node, actions, false);
      return {
        key: entry.key,
        element: entry.element,
        update: (next) => {
          if (next.kind === "task") entry.update(next);
        },
      };
    });

    el("#totalring").append(this.#totalRing);

    this.#toast = new Toast(el("#toast"), () => {
      this.#store.undo();
    });
    this.#sheet = new DaySheet(el("#veil"), () => {
      this.#store.apply(T.clearTicks(this.#state), { undoable: true });
      this.#toast.show("Ticks cleared");
    });
    this.#drawer = new Drawer(el("#dataveil"), {
      current: () => this.#state,
      onReplace: (next) => {
        this.#replace(next, true);
        const count = allTasks(next.list).length;
        this.#toast.show(`Imported ${String(count)} item${count === 1 ? "" : "s"}`);
      },
      onErase: () => {
        this.#replace(T.eraseAll(this.#state), true);
        this.#toast.show("Everything erased");
      },
    });
    this.#confetti = new Confetti(el("#confetti") as HTMLCanvasElement);

    this.#wire();
    this.#store.subscribe(() => {
      this.#render();
    });
  }

  get #state(): State {
    return this.#store.state;
  }

  /* ------------------------------------------------------------------ boot */

  start(): void {
    this.#render();
    // Never celebrate on load: arm only once the list drops below complete.
    this.#armed = !isComplete(allTasks(this.#state.list));

    const { openedAt } = this.#state;
    if (openedAt !== null && Date.now() - openedAt > STALE_MS) {
      this.#sheet.show(this.#state, Date.now());
    }
  }

  /* --------------------------------------------------------------- actions */

  #bump(id: string, delta: number): void {
    const before = T.findTask(this.#state, id);
    if (!before) return;
    const wasDone = isDone(before);

    this.#store.apply(T.bump(this.#state, id, delta, Date.now()));

    const after = T.findTask(this.#state, id);
    if (after && !wasDone && isDone(after)) {
      const row = this.#rows.get(id)?.element ?? this.#list.querySelector(`[data-id="${id}"]`);
      if (row && !this.#reduced) popRing(row as HTMLElement);
      this.#vibrate(12);
    }
    this.#checkComplete();
  }

  #remove(id: string): void {
    const group = T.findGroup(this.#state, id);
    const label = group
      ? `Deleted “${group.title}”${
          group.items.length
            ? ` and ${String(group.items.length)} item${group.items.length > 1 ? "s" : ""}`
            : ""
        }`
      : "Deleted";

    const finish = (): void => {
      this.#store.apply(T.remove(this.#state, id), { undoable: true });
      this.#toast.show(label);
    };

    const entry = this.#rows.get(id);
    if (entry && !this.#reduced) {
      entry.element.classList.add("leaving");
      setTimeout(finish, EXIT_MS);
    } else {
      finish();
    }
  }

  #replace(next: State, undoable: boolean): void {
    this.#destId = null;
    this.#rows.clear();
    this.#store.replace(next, { undoable });
    this.#armed = !isComplete(allTasks(next.list));
  }

  #beginEdit(element: HTMLElement, id: string, isGroup: boolean): void {
    if (this.#editingId !== null) return;

    const initial = isGroup
      ? (T.findGroup(this.#state, id)?.title ?? "")
      : (() => {
          const task = T.findTask(this.#state, id);
          return task ? raw(task) : "";
        })();

    this.#editingId = id;
    beginEdit(
      element,
      id,
      initial,
      (value) => {
        this.#editingId = null;
        this.#store.apply(T.retitle(this.#state, id, value, isGroup), { undoable: true });
        this.#render();
      },
      () => {
        this.#editingId = null;
        this.#render();
      },
    );
  }

  /* --------------------------------------------------------------- rewards */

  #checkComplete(): void {
    const complete = isComplete(allTasks(this.#state.list));
    if (complete && this.#armed) {
      this.#armed = false;
      if (!this.#reduced) {
        const box = this.#totalRing.getBoundingClientRect();
        this.#confetti.burst({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      }
      this.#vibrate([18, 40, 24]);
    }
    if (!complete) this.#armed = true;
  }

  #vibrate(pattern: number | number[]): void {
    // Absent on iOS Safari, and TypeScript types it as always present — so treat
    // it as optional here rather than trusting the lib definition.
    const nav: { vibrate?: (p: number | number[]) => boolean } = navigator;
    try {
      nav.vibrate?.(pattern);
    } catch {
      /* no haptics; the visual reward carries that platform alone */
    }
  }

  /* ---------------------------------------------------------------- render */

  #render(): void {
    if (this.#destId !== null && !T.findGroup(this.#state, this.#destId)) this.#destId = null;

    this.#rows.patch(this.#state.list);
    this.#renderDest();

    const tasks = allTasks(this.#state.list);
    const progress = overallProgress(this.#state);

    this.#empty.hidden = this.#state.list.length > 0;
    this.#closer.hidden = tasks.length === 0;
    this.#closer.style.setProperty("--end-hue", hueAt(progress).toFixed(1));
    this.#closer.classList.toggle("lit", progress > 0);
    this.#closer.classList.toggle("ripe", tasks.length > 0 && progress === 1);

    paintRing(this.#totalRing, tasks.length ? progress : 0, 1);
    this.#totalRing.style.opacity = tasks.length ? "1" : "0.3";
    this.#frac.textContent = `${String(tasks.filter(isDone).length)} of ${String(tasks.length)}`;
    this.#tweenPct(Math.round(progress * 100));
  }

  #renderDest(): void {
    const groups = this.#state.list.filter((node): node is Group => node.kind === "group");
    this.#destRow.hidden = groups.length === 0;

    const signature = groups.map((group) => `${group.id} ${group.title}`).join("");
    if (this.#dest.dataset["sig"] !== signature) {
      this.#dest.replaceChildren(new Option("Top level", ""));
      for (const group of groups) this.#dest.append(new Option(group.title, group.id));
      this.#dest.dataset["sig"] = signature;
    }
    this.#dest.value = this.#destId ?? "";
  }

  #tweenPct(target: number): void {
    if (this.#reduced) {
      this.#shownPct = target;
      this.#pct.textContent = `${String(target)}%`;
      return;
    }
    const from = this.#shownPct;
    const started = performance.now();
    cancelAnimationFrame(this.#tweenRaf);

    const step = (now: number): void => {
      const k = Math.min(1, (now - started) / 420);
      const eased = 1 - Math.pow(1 - k, 3);
      this.#shownPct = Math.round(from + (target - from) * eased);
      this.#pct.textContent = `${String(this.#shownPct)}%`;
      if (k < 1) this.#tweenRaf = requestAnimationFrame(step);
    };
    this.#tweenRaf = requestAnimationFrame(step);
  }

  /* ----------------------------------------------------------------- wiring */

  #wire(): void {
    (el("#composer") as HTMLFormElement).addEventListener("submit", (event) => {
      event.preventDefault();
      const result = T.add(this.#state, this.#input.value, this.#destId, Date.now());
      if (result.added) {
        this.#destId = result.destId;
        this.#store.apply(result.state);
      }
      this.#input.value = "";
      this.#input.focus();
    });

    this.#dest.addEventListener("change", () => {
      this.#destId = this.#dest.value || null;
      this.#render();
      this.#input.focus();
    });

    this.#closer.addEventListener("click", () => {
      this.#sheet.show(this.#state, Date.now());
    });
    (el("#databtn") as HTMLButtonElement).addEventListener("click", () => {
      this.#drawer.show();
    });

    document.addEventListener("keydown", (event) => {
      this.#onKeyDown(event);
    });

    // The composer is fixed and changes height (the destination row appears with
    // the first group). Publish its measured height so nothing sits underneath.
    const syncHeight = (): void => {
      document.documentElement.style.setProperty(
        "--composer-h",
        `${String(this.#composer.offsetHeight)}px`,
      );
    };
    new ResizeObserver(syncHeight).observe(this.#composer);
    addEventListener("resize", syncHeight);
    syncHeight();

    onExternalChange((next) => {
      this.#replace(next, false);
    });
  }

  #onKeyDown(event: KeyboardEvent): void {
    // Inside a text field, Ctrl-Z means undo the typing, not undo the app.
    const target = event.target;
    const inField =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement);

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !inField) {
      event.preventDefault();
      if (this.#store.undo()) this.#toast.hide();
      return;
    }
    if (event.key === "Escape") {
      if (this.#sheet.isOpen) this.#sheet.hide();
      if (this.#drawer.isOpen) this.#drawer.hide();
    }
    if (this.#editingId !== null) return;

    const active = document.activeElement;
    const row = active instanceof HTMLElement ? active.closest(".task") : null;
    const id = row instanceof HTMLElement ? row.dataset["id"] : undefined;
    if (id === undefined) return;

    if (event.key === " ") {
      event.preventDefault();
      this.#bump(id, event.shiftKey ? -1 : 1);
      this.#refocus(id);
      return;
    }

    if (event.key === "Tab") {
      const dir = event.shiftKey ? "out" : "in";
      // Only swallow Tab when there is somewhere to go, so focus can still escape.
      if (!T.canMove(this.#state, id, dir)) return;
      event.preventDefault();
      this.#store.apply(T.move(this.#state, id, dir), { undoable: true });
      this.#refocus(id);
    }
  }

  #refocus(id: string): void {
    requestAnimationFrame(() => {
      const element = this.#list.querySelector(`.task[data-id="${id}"]`);
      if (element instanceof HTMLElement) element.focus();
    });
  }
}

export const seed = (): State =>
  normalize({
    v: 1,
    openedAt: null,
    list: [
      {
        kind: "group",
        title: "Morning",
        collapsed: false,
        items: [
          { kind: "task", text: "eat breakfast", target: 1, count: 0 },
          { kind: "task", text: "walk the dog", target: 1, count: 0 },
        ],
      },
      { kind: "task", text: "make calls", target: 3, count: 0 },
      { kind: "task", text: "shopping", target: 1, count: 0 },
    ] satisfies unknown[] as (Task | Group)[],
  }) as State;
