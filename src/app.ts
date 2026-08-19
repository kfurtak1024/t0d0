import { allTasks, isComplete, isDone, overallProgress } from "./progress";
import { createGroup } from "./render/group";
import { flip } from "./render/flip";
import { KeyedList } from "./render/list";
import { hueAt, makeRing, paintRing } from "./render/ring";
import { createTask, popRing, tickOf } from "./render/task";
import type { RowActions } from "./render/context";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { onExternalChange } from "./storage";
import type { Store } from "./store";
import * as T from "./transitions";
import { raw } from "./parse";
import type { Group, Node, State } from "./types";
import { Drawer } from "./ui/drawer";
import { Confetti } from "./ui/confetti";
import { need } from "./ui/dom";
import { Dragger } from "./ui/drag";
import { beginEdit } from "./ui/edit";
import { RowMenu, type MenuItem } from "./ui/menu";
import { DaySheet } from "./ui/sheet";
import { Toast } from "./ui/toast";

const STALE_MS = 16 * 60 * 60 * 1000;
const EXIT_MS = 200;
/** Long enough for the tick to finish landing before the group folds over it. */
const COLLAPSE_MS = 520;

/** Query a required element of the page, failing loudly rather than rendering nothing. */
const el = (selector: string): HTMLElement => need(document, selector);

export class App {
  #store: Store;
  #motion = matchMedia("(prefers-reduced-motion: reduce)");

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
  #menu = new RowMenu();

  #prefs: Prefs = loadPrefs();
  #destId: string | null = null;
  #editingId: string | null = null;
  #armed = true;
  #shownPct = 0;
  #tweenRaf = 0;
  #storageWarned = false;
  #collapseTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by the moves, so only a rearrangement animates as one. */
  #animateNext = false;
  /** The list as it stood before the current drag, for undo and for Escape. */
  #beforeDrag: State | null = null;
  /** A delete waiting out its exit animation, cancellable until it lands. */
  #pendingDelete: {
    id: string;
    element: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

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
        // Folding by hand outranks folding on your behalf: a pending
        // auto-collapse must not re-shut a group you just opened.
        clearTimeout(this.#collapseTimer);
        this.#store.apply(T.toggleCollapse(this.#state, id));
      },
      openMenu: (anchor, id) => {
        this.#menu.open(
          anchor,
          () => this.#menuItems(id),
          () =>
            this.#list.querySelector<HTMLElement>(
              `[data-id="${id}"] > .dots, [data-id="${id}"] > .ghead > .dots`,
            ),
        );
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
      this.#undo();
    });
    this.#sheet = new DaySheet(el("#veil"), () => {
      this.#store.apply(T.clearTicks(this.#state), { undoable: true });
      this.#toast.show("Ticks cleared");
    });
    this.#drawer = new Drawer(el("#dataveil"), {
      current: () => this.#state,
      prefs: () => this.#prefs,
      onPrefs: (next) => {
        this.#prefs = next;
        savePrefs(next);
      },
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

    /*
     * A drag is the same one-step reorder the keyboard uses, applied as the
     * pointer crosses rows — so the steps are not individually undoable. The
     * whole gesture is: one Ctrl-Z puts the list back where the drag found it.
     */
    new Dragger(this.#list, {
      step: (id, dir, scope) => {
        if (!T.canReorder(this.#state, id, dir, scope)) return false;
        /*
         * No FLIP here, unlike every other move. The drag decides its next step
         * by measuring where rows are, and getBoundingClientRect reports an
         * in-flight transform — so animating the neighbours would have the
         * gesture reading positions that have not settled yet, and stepping
         * differently depending on how fast the pointer was going. The row under
         * the finger is the continuity; the rest snap.
         */
        this.#store.apply(T.reorder(this.#state, id, dir, scope));
        return true;
      },
      onStart: () => {
        this.#menu.close(false);
        this.#beforeDrag = this.#state;
      },
      onEnd: (_id, moved) => {
        if (moved && this.#beforeDrag) this.#store.stageUndo(this.#beforeDrag);
        this.#beforeDrag = null;
      },
      onCancel: () => {
        // Escape mid-drag means "never mind", so the list goes back untouched
        // and nothing is left on the undo slot to explain.
        if (this.#beforeDrag) {
          this.#animateNext = true;
          this.#store.apply(this.#beforeDrag);
        }
        this.#beforeDrag = null;
      },
    });

    // Warn once per outage, and again if storage comes back and fails afresh.
    this.#store.onPersist((ok) => {
      if (ok) {
        this.#storageWarned = false;
        return;
      }
      if (this.#storageWarned) return;
      this.#storageWarned = true;
      this.#toast.show("Can't save — this list will be lost on reload");
    });

    this.#wire();
    this.#store.subscribe(() => {
      this.#render();
      // Every state change, not just a tick: deleting the last undone item
      // finishes the day just as much as ticking it does.
      this.#checkComplete();
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
      const row =
        this.#rows.get(id)?.element ?? this.#list.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (row && !this.#motion.matches) popRing(row);
      this.#vibrate(12);
      this.#autoCollapse(id);
    }
  }

  /**
   * Fold a finished group shut, if the preference is on.
   *
   * Only on the transition into finished, and on a delay: the tick landing is
   * the reward, so the group waits for it to play out before folding over it.
   * Re-checked when the timer fires, because by then the list may have moved on.
   */
  #autoCollapse(taskId: string): void {
    if (!this.#prefs.autoCollapseDone) return;
    const owner = T.ownerOf(this.#state, taskId);
    if (!owner || owner.items.length === 0 || !owner.items.every(isDone)) return;

    const groupId = owner.id;
    const fold = (): void => {
      const group = T.findGroup(this.#state, groupId);
      if (!group || group.items.length === 0 || !group.items.every(isDone)) return;
      this.#store.apply(T.collapse(this.#state, groupId));
    };

    clearTimeout(this.#collapseTimer);
    if (this.#motion.matches) fold();
    else this.#collapseTimer = setTimeout(fold, COLLAPSE_MS);
  }

  #remove(id: string): void {
    // One at a time: a second delete lands the first rather than racing it.
    this.#flushDelete();
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
    if (entry && !this.#motion.matches) {
      entry.element.classList.add("leaving");
      this.#pendingDelete = {
        id,
        element: entry.element,
        timer: setTimeout(() => {
          this.#pendingDelete = null;
          finish();
        }, EXIT_MS),
      };
    } else {
      finish();
    }
  }

  /* -------------------------------------------------------------- ordering */

  /**
   * "Move up" and "Move down", from the ⋯ menu or Alt+Arrow.
   *
   * Level-scoped: a command named after a direction should move the row in that
   * direction, not quietly re-nest it. Changing level is asked for explicitly —
   * Tab / Shift-Tab, or the menu's "Into" / "Out of". Dragging is the exception,
   * because there the pointer is already saying where the row should land.
   */
  #reorder(id: string, dir: T.ReorderDirection): void {
    if (!T.canReorder(this.#state, id, dir, "level")) return;
    this.#animateNext = true;
    this.#store.apply(T.reorder(this.#state, id, dir, "level"), { undoable: true });
    this.#reveal(id);
  }

  #move(id: string, dir: T.MoveDirection): void {
    if (!T.canMove(this.#state, id, dir)) return;
    this.#animateNext = true;
    this.#store.apply(T.move(this.#state, id, dir), { undoable: true });
    this.#reveal(id);
  }

  /** What the ⋯ menu offers for one row, read fresh each time it repaints. */
  #menuItems(id: string): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: "Move up",
        hint: "Alt+↑",
        disabled: !T.canReorder(this.#state, id, "up", "level"),
        keepOpen: true,
        onSelect: () => {
          this.#reorder(id, "up");
        },
      },
      {
        label: "Move down",
        hint: "Alt+↓",
        disabled: !T.canReorder(this.#state, id, "down", "level"),
        keepOpen: true,
        onSelect: () => {
          this.#reorder(id, "down");
        },
      },
    ];

    // A counted item cannot toggle the way a plain one does — tapping up is the
    // point of it — so its way back to zero lives here.
    const task = T.findTask(this.#state, id);
    if (task && task.target > 1 && task.count > 0) {
      items.push({
        label: "Reset to 0",
        onSelect: () => {
          this.#bump(id, -task.count);
        },
      });
    }

    // Nesting is reachable by stepping, but only one row at a time; on a phone
    // that is a lot of taps to cross a long group, so it gets its own entry.
    const owner = T.ownerOf(this.#state, id);
    const above = T.groupAbove(this.#state, id);
    if (owner) {
      items.push({
        label: `Out of “${owner.title}”`,
        hint: "Shift+Tab",
        onSelect: () => {
          this.#move(id, "out");
        },
      });
    } else if (above) {
      items.push({
        label: `Into “${above.title}”`,
        hint: "Tab",
        onSelect: () => {
          this.#move(id, "in");
        },
      });
    }

    return items;
  }

  /**
   * Bring a row on screen, clearing the fixed composer.
   *
   * `nearest` plus the row's own scroll-margin means an item already in view
   * does not move at all — nothing is more disorienting than the list jumping
   * when you added something you could already see.
   */
  #reveal(id: string): void {
    const row = this.#list.querySelector<HTMLElement>(`[data-id="${id}"]`);
    row?.scrollIntoView({
      block: "nearest",
      behavior: this.#motion.matches ? "auto" : "smooth",
    });
  }

  /** Let the queued delete happen now. */
  #flushDelete(): void {
    const pending = this.#pendingDelete;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pendingDelete = null;
    this.#store.apply(T.remove(this.#state, pending.id), { undoable: true });
  }

  /**
   * Undo pressed inside the exit animation means "put that back" — the state
   * change has not happened yet, so cancelling the animation is the undo.
   */
  #undo(): void {
    const pending = this.#pendingDelete;
    if (pending) {
      clearTimeout(pending.timer);
      pending.element.classList.remove("leaving");
      this.#pendingDelete = null;
      this.#toast.hide();
      return;
    }
    if (this.#store.undo()) this.#toast.hide();
  }

  #replace(next: State, undoable: boolean): void {
    const pending = this.#pendingDelete;
    if (pending) {
      clearTimeout(pending.timer);
      this.#pendingDelete = null;
    }
    // The row this menu was opened against is about to stop existing.
    this.#menu.close(false);
    clearTimeout(this.#collapseTimer);
    this.#destId = null;
    this.#rows.clear();
    // Armed before the notify, so an all-done import does not celebrate itself.
    this.#armed = !isComplete(allTasks(next.list));
    this.#store.replace(next, { undoable });
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
      if (!this.#motion.matches) {
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

    // Only reorders pay for the FLIP measurement — reading every row's box on
    // every tick would be layout thrash for an animation nothing asked for.
    const animate = this.#animateNext && !this.#motion.matches;
    this.#animateNext = false;
    flip(
      // The dragged row is glued to the pointer; animating it to its new layout
      // box would be a second owner of its transform, fighting the finger.
      [...this.#list.querySelectorAll<HTMLElement>(".task, .group")].filter(
        (row) => !row.classList.contains("dragging"),
      ),
      () => {
        this.#rows.patch(this.#state.list);
      },
      { instant: !animate },
    );
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
    const frac = `${String(tasks.filter(isDone).length)} of ${String(tasks.length)}`;
    // Writing the same text still fires the live region, so only write changes.
    if (this.#frac.textContent !== frac) this.#frac.textContent = frac;
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
    if (this.#motion.matches) {
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
        // The composer is pinned to the bottom of a list that grows off the
        // screen behind it, so adding without this types into the void.
        this.#reveal(result.added.id);
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
      this.#undo();
      return;
    }
    if (event.key === "Escape") {
      if (this.#menu.isOpen) this.#menu.close();
      if (this.#sheet.isOpen) this.#sheet.hide();
      if (this.#drawer.isOpen) this.#drawer.hide();
    }
    if (this.#editingId !== null) return;

    const active = document.activeElement;
    // A nested tick matches its own row before its group, which is what makes
    // Alt+Arrow move the item rather than everything around it.
    const row = active instanceof HTMLElement ? active.closest(".task, .group") : null;
    if (!(row instanceof HTMLElement) || !(active instanceof HTMLElement)) return;
    const id = row.dataset["id"];
    if (id === undefined) return;
    const handle = row.classList.contains("group") ? "chev" : "tick";

    // Alt is free on a row, so any control on it can start a move; the row's own
    // handle takes the focus back afterwards.
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const dir = event.key === "ArrowUp" ? "up" : "down";
      // Same scope the ⋯ menu uses — the menu prints Alt+Arrow as this command's
      // shortcut, so the two have to be the same command. And only swallow the
      // key when there is somewhere to go.
      if (!T.canReorder(this.#state, id, dir, "level")) return;
      event.preventDefault();
      this.#reorder(id, dir);
      this.#refocus(id, handle);
      return;
    }

    // Only the tick is the row's handle for Tab: tabbing off a delete button
    // must stay a plain focus move, not a structural edit.
    if (!active.classList.contains("tick")) return;

    if (event.key === "Tab") {
      const dir = event.shiftKey ? "out" : "in";
      // Only swallow Tab when there is somewhere to go, so focus can still escape.
      if (!T.canMove(this.#state, id, dir)) return;
      event.preventDefault();
      this.#move(id, dir);
      this.#refocus(id);
    }
  }

  /** Put focus back on the row's own handle once it has been re-rendered. */
  #refocus(id: string, handle = "tick"): void {
    requestAnimationFrame(() => {
      const row = this.#list.querySelector(`[data-id="${id}"]`);
      const control =
        handle === "tick" && row instanceof HTMLElement
          ? tickOf(row)
          : (row?.querySelector<HTMLElement>(`:scope > .ghead > .${handle}`) ?? null);
      control?.focus();
    });
  }
}
