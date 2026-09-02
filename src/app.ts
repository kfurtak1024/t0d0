import { allTasks, dayHue, HUE, isDone, progress, scoreDay, type DayScore } from "./progress";
import { cross, highest, spend, type Arming, type Milestone } from "./milestones";
import { createGroup } from "./render/group";
import { flip } from "./render/flip";
import { KeyedList } from "./render/list";
import { dayStroke, makeRing, paintRing } from "./render/ring";
import { createTask, popRing, tickOf } from "./render/task";
import type { RowActions } from "./render/context";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { onExternalChange } from "./storage";
import type { Store } from "./store";
import * as T from "./transitions";
import { isGroupInput, raw } from "./parse";
import { endLabel } from "./words";
import type { Group, Node, State, Task } from "./types";
import { Drawer } from "./ui/drawer";
import { Confetti } from "./ui/confetti";
import { need } from "./ui/dom";
import { Dragger } from "./ui/drag";
import { beginEdit } from "./ui/edit";
import { RowMenu, type MenuItem } from "./ui/menu";
import { DaySheet } from "./ui/sheet";
import { hasDay, StandsSheet } from "./ui/stands";
import { Toast } from "./ui/toast";

const STALE_MS = 16 * 60 * 60 * 1000;
const EXIT_MS = 200;
/** Long enough for the tick to finish landing before the group folds over it. */
const COLLAPSE_MS = 520;

/**
 * What each moment looks like: the hue the ring turns as it lands, and how loud
 * the shower is. The hues come from the rainbow's own landmarks so a burst and
 * the ring it bursts from cannot drift apart — and the canvas puts them through
 * the ring's own formula and theme tokens, so what cannot drift is the colour
 * and not merely the number.
 */
const FANFARE: Record<Milestone, { hue: number; count: number }> = {
  cleared: { hue: HUE.green, count: 55 },
  succeeded: { hue: HUE.blue, count: 95 },
  complete: { hue: HUE.violet, count: 150 },
};

const HAPTICS: Record<Milestone, number[]> = {
  cleared: [14, 30, 14],
  succeeded: [18, 40, 24],
  complete: [20, 40, 20, 40, 34],
};

/** One state, and everything a render derives from it. See `App#frame`. */
interface Frame {
  state: State;
  tasks: Task[];
  score: DayScore;
  /** Overall progress: the arc, the percentage, and whether the closer is lit. */
  done: number;
}

/** Query a required element of the page, failing loudly rather than rendering nothing. */
const el = (selector: string): HTMLElement => need(document, selector);

export class App {
  #store: Store;
  #motion = matchMedia("(prefers-reduced-motion: reduce)");

  #list = el("#list");
  #empty = el("#empty");
  #closer = el("#closeday") as HTMLButtonElement;
  #ending = el("#ending");
  #endLabel = el("#endlabel");
  #pct = el("#pct");
  #frac = el("#frac");
  #dest = el("#dest") as HTMLSelectElement;
  #destRow = el("#destrow");
  #input = el("#input") as HTMLInputElement;
  #composer = el(".composer");

  #ringButton = el("#totalring") as HTMLButtonElement;
  #totalRing = makeRing(40, 4, 1);
  #rows: KeyedList<Node>;
  #toast: Toast;
  #sheet: DaySheet;
  #stands: StandsSheet;
  #drawer: Drawer;
  #confetti: Confetti;
  #menu = new RowMenu();

  #prefs: Prefs = loadPrefs();
  #destId: string | null = null;
  #editingId: string | null = null;
  /** Calls off the edit in progress without committing it. */
  #endEdit: (() => void) | null = null;
  #armed: Arming = { cleared: true, succeeded: true, complete: true };
  #shownPct = 0;
  #tweenRaf = 0;
  #storageWarned = false;
  /** Rows waiting out the tick that finished them, before they get out of the way. */
  #tidyIds = new Set<string>();
  #tidyTimer: ReturnType<typeof setTimeout> | undefined;
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

    this.#rows = this.#makeRows(this.#rowActions());
    this.#ringButton.append(this.#totalRing);

    this.#toast = new Toast(el("#toast"), () => {
      this.#undo();
    });
    this.#sheet = new DaySheet(
      el("#veil"),
      () => {
        this.#store.apply(T.clearTicks(this.#state), { undoable: true });
        this.#toast.show("Ticks cleared");
      },
      (score) => {
        this.#cheer(score);
      },
    );
    this.#stands = new StandsSheet(el("#standsveil"));
    this.#drawer = new Drawer(el("#dataveil"), {
      current: () => this.#state,
      prefs: () => this.#prefs,
      onPrefs: (next) => {
        this.#prefs = next;
        savePrefs(next);
        /*
         * Moving the bar re-scores the day, so the ring and the closer have to
         * repaint. Arming rather than checking on purpose: a milestone reached
         * by lowering your own bar was not earned, and confetti for moving the
         * goalposts is hollow. It re-arms the moment the list falls back below.
         */
        const frame = this.#frame();
        this.#arm(frame.score);
        this.#render(frame);
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

    this.#wireDrag();
    this.#wireStore();
    this.#wire();
  }

  /* ----------------------------------------------------------------- wiring */

  /** What a rendered row is allowed to ask of the app. */
  #rowActions(): RowActions {
    return {
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
        // Folding by hand outranks folding on your behalf: a pending tidy must
        // not re-shut a group you just opened. Only this group's, though —
        // whatever else is queued was nothing to do with the chevron you hit.
        this.#tidyIds.delete(id);
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
  }

  /**
   * The keyed patch over the root list.
   *
   * A root row is a task or a group; narrow on update so neither renderer is
   * ever handed the other's shape.
   */
  #makeRows(actions: RowActions): KeyedList<Node> {
    return new KeyedList<Node>(this.#list, (node) => {
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
  }

  /**
   * A drag is the same one-step reorder the keyboard uses, applied as the
   * pointer crosses rows — so the steps are not individually undoable. The
   * whole gesture is: one Ctrl-Z puts the list back where the drag found it.
   */
  #wireDrag(): void {
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
  }

  #wireStore(): void {
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

    this.#store.subscribe(() => {
      // Derived once and handed to both: the ring and the milestones are asking
      // the same question of the same list, and deriving it twice per change is
      // work that only ever grows.
      const frame = this.#frame();
      this.#render(frame);
      // Every state change, not just a tick: deleting the last undone item
      // finishes the day just as much as ticking it does.
      this.#checkMilestones(frame.score);
    });
  }

  get #state(): State {
    return this.#store.state;
  }

  /** The success bar as a fraction, which is what the scoring speaks in. */
  get #bar(): number {
    return this.#prefs.successAt / 100;
  }

  /**
   * Everything a render reads about the list, derived once from one state.
   *
   * Taken together on purpose. The arc measures the list and the colour judges
   * the day — two different questions — and a render that took one of them as
   * an argument while re-deriving the other from `#state` could show a ring
   * whose sweep and hue disagreed. Snapshotting the state alongside them is
   * what makes that impossible rather than merely unlikely.
   */
  #frame(state: State = this.#state): Frame {
    const tasks = allTasks(state.list);
    return { state, tasks, score: scoreDay(state, this.#bar), done: progress(tasks) };
  }

  /* ------------------------------------------------------------------ boot */

  start(): void {
    const frame = this.#frame();
    this.#render(frame);
    // Never celebrate on load: every moment already reached starts spent, and
    // arms itself only if the list later falls back below it.
    this.#arm(frame.score);

    const { openedAt } = this.#state;
    if (openedAt !== null && Date.now() - openedAt > STALE_MS) {
      this.#sheet.show(this.#state, Date.now(), this.#bar);
    }
  }

  /* --------------------------------------------------------------- actions */

  #bump(id: string, delta: number): void {
    const before = T.findTask(this.#state, id);
    if (!before) return;
    const wasDone = isDone(before);
    /*
     * The row this tick belongs to: the task itself, or the group holding it —
     * the same row `#tidy` would have sent down, so the same one has to come
     * back up. Read before the change, because whether it *was* finished is
     * what says there is anything to come back from.
     */
    const rowId = T.ownerOf(this.#state, id)?.id ?? id;
    const rowBefore = T.findRow(this.#state, rowId);
    const wasFinished = rowBefore !== undefined && T.isFinished(rowBefore);

    let next = T.bump(this.#state, id, delta, Date.now());
    const after = T.findTask(next, id);
    const justFinished = after !== undefined && !wasDone && isDone(after);

    /*
     * An untick's rise rides on the same change as the tick, so one press is
     * one state change: one render, one milestone check, and the row travels
     * under the same FLIP pass rather than a second one chasing the first.
     */
    const rowAfter = T.findRow(next, rowId);
    if (wasFinished && rowAfter && !T.isFinished(rowAfter)) next = this.#untidy(next, rowId);

    /*
     * Before the apply, not after. A crossed milestone fires its own pattern
     * from inside it, and `navigator.vibrate` cancels whatever is already
     * playing — so the small buzz has to go first or it silences the big one.
     */
    if (justFinished) this.#vibrate(12);
    this.#store.apply(next);

    if (justFinished) {
      const row =
        this.#rows.get(id)?.element ?? this.#list.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (row && !this.#motion.matches) popRing(row);
      this.#tidy(id);
    }
  }

  /**
   * Bring back what an untick just put back into play.
   *
   * The mirror of {@link #tidy}, and gated on the same preference: someone who
   * turned off automatic tidying does not want automatic reordering in either
   * direction.
   *
   * Immediate, where tidying waits. The delay there protects the reward — the
   * tick landing is the point, so nothing moves over it until it has played
   * out. An untick is a correction, not a reward, and there is nothing to wait
   * for; a row that took half a second to come back would feel stuck.
   */
  #untidy(state: State, id: string): State {
    if (!this.#prefs.autoCollapseDone) return state;
    // Whatever was queued for this row is off: it is not going down any more.
    this.#tidyIds.delete(id);

    const next = T.rise(state, id);
    if (next !== state) this.#animateNext = true;
    return next;
  }

  /**
   * Send what a tick just finished down out of the way, if the preference is on.
   *
   * A tick inside a group tidies the group, and only once the whole group is
   * done — one item finishing is not the group finishing. A tick on a root item
   * tidies that row itself. Either way the row lands below the work that is
   * left, and a group folds shut on its way.
   */
  #tidy(taskId: string): void {
    if (!this.#prefs.autoCollapseDone) return;
    const id = T.rowToTidy(this.#state, taskId);
    if (id !== null) this.#queueTidy(id);
  }

  /**
   * Queue a row to be tidied, once the tick has finished landing.
   *
   * The delay is the point: the tick landing is the reward, so nothing moves
   * over it until it has played out. Queued rather than scheduled one at a time
   * because ticking two things in quick succession used to have the second
   * cancel the first, and the first row then sat there un-tidied. They all wait
   * out the newest tick and travel together, as one animation.
   */
  #queueTidy(id: string): void {
    this.#tidyIds.add(id);
    if (this.#motion.matches) {
      this.#runTidy();
      return;
    }
    clearTimeout(this.#tidyTimer);
    this.#tidyTimer = setTimeout(() => {
      this.#runTidy();
    }, COLLAPSE_MS);
  }

  /**
   * Send the queued rows down as one state change, so they travel together
   * under FLIP rather than vanishing here and reappearing there. The ordering
   * rules live with the transition; this only owns the queue and the animation.
   */
  #runTidy(): void {
    const ids = [...this.#tidyIds];
    this.#tidyIds.clear();

    const next = T.tidyAll(this.#state, ids);
    if (next === this.#state) return;
    this.#animateNext = true;
    this.#store.apply(next);
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

    /*
     * Found in the DOM, not only in the root patch. `#rows` holds the top level;
     * a task inside a group lives in that group's own list, so looking only
     * there meant a nested row was deleted without its exit — it simply
     * vanished where a root row faded. The CSS had always dressed it for the
     * exit (`.items > .task.leaving`); nothing ever gave it the class.
     */
    const element =
      this.#rows.get(id)?.element ?? this.#list.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (element && !this.#motion.matches) {
      element.classList.add("leaving");
      this.#pendingDelete = {
        id,
        element,
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

    // The mark's other two routes — a trailing `!` in the composer, and the same
    // when editing the text — both mean typing. This is the one that works with
    // a thumb on a row already in front of you.
    const row = task ?? T.findGroup(this.#state, id);
    if (row) {
      items.push({
        label: row.important ? "Unmark important" : "Mark important",
        onSelect: () => {
          this.#store.apply(T.toggleImportant(this.#state, id), { undoable: true });
        },
      });
    }

    // Tasks only, and the same three routes as the mark it sits beside: a
    // trailing `~` in the composer, the same when editing, and this — the one
    // that works with a thumb on a row already in front of you.
    if (task) {
      items.push({
        label: task.once ? "Keep for tomorrow" : "One-off, remove tonight",
        onSelect: () => {
          this.#store.apply(T.toggleOnce(this.#state, id), { undoable: true });
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

    /*
     * Last, and the only destructive entry.
     *
     * It used to be a ✕ on the row itself, which held a 25.6px column open on
     * every row whether or not it was visible — a fifth of a nested row's label
     * on a phone, a third of a counted one's. The action is a morning's pruning
     * rather than something done all day, and it was the last row control that
     * had not moved in here; undo covers the mis-tap, which is why it deletes
     * on the press rather than growing a confirm step inside a menu.
     *
     * A group says what it is taking with it. "Delete" alone does not mention
     * the items, and they do not come back on their own — the same reason the
     * one-off entry names the consequence rather than the mark.
     */
    const group = T.findGroup(this.#state, id);
    const held = group?.items.length ?? 0;
    items.push({
      label: !group
        ? "Delete"
        : held === 0
          ? "Delete group"
          : `Delete group and ${String(held)} item${held === 1 ? "" : "s"}`,
      danger: true,
      onSelect: () => {
        this.#remove(id);
      },
    });

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
    /*
     * Called off rather than left to finish. The row being edited is about to
     * lose its node, and the blur that follows would otherwise commit a rename
     * into a list that no longer holds it — spending the undo slot on the state
     * from before the replace, so one Ctrl-Z would put the old list back.
     */
    this.#endEdit?.();

    const pending = this.#pendingDelete;
    if (pending) {
      clearTimeout(pending.timer);
      this.#pendingDelete = null;
    }
    // The row this menu was opened against is about to stop existing.
    this.#menu.close(false);
    // The rows a queued tidy was aimed at are about to stop existing too.
    clearTimeout(this.#tidyTimer);
    this.#tidyIds.clear();
    this.#destId = null;
    this.#rows.clear();
    // Armed before the notify, so an all-done import does not celebrate itself.
    this.#arm(this.#frame(next).score);
    this.#store.replace(next, { undoable });
  }

  #beginEdit(element: HTMLElement, id: string, isGroup: boolean): void {
    if (this.#editingId !== null) return;

    // Both kinds go through `raw`, so what the editor opens on is exactly what
    // the composer would have accepted — bracket, bang and all.
    const node = isGroup ? T.findGroup(this.#state, id) : T.findTask(this.#state, id);
    const initial = node ? raw(node) : "";

    this.#editingId = id;
    this.#endEdit = beginEdit(
      element,
      initial,
      (value) => {
        this.#editingId = null;
        this.#endEdit = null;
        this.#store.apply(T.retitle(this.#state, id, value, isGroup), { undoable: true });
        this.#render();
      },
      () => {
        this.#editingId = null;
        this.#endEdit = null;
        this.#render();
      },
    );
  }

  /* --------------------------------------------------------------- rewards */

  /** Spend every moment the list has already reached, without celebrating it. */
  #arm(score: DayScore): void {
    this.#armed = spend(score);
  }

  /** Celebrate whatever the last change just crossed, if anything. */
  #checkMilestones(score = scoreDay(this.#state, this.#bar)): void {
    const { fired, armed } = cross(this.#armed, score);
    this.#armed = armed;
    if (!fired) return;

    const { hue, count } = FANFARE[fired];
    if (!this.#motion.matches) {
      const box = this.#totalRing.getBoundingClientRect();
      this.#confetti.burst(
        { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        { hue, count },
      );
    }
    this.#vibrate(HAPTICS[fired]);
  }

  /**
   * The closing card's own shower, scaled by what the day actually earned.
   *
   * Proportional rather than unconditional. `highest` is null for a day that
   * reached none of the three moments, and that day gets nothing — the same
   * rule that keeps the card's verdict line silent on an unfinished day, and
   * the reason this is not simply confetti every time the card opens. It bursts
   * from the card, because that is what you are looking at.
   */
  #cheer(score: DayScore): void {
    if (this.#motion.matches) return;
    const fired = highest(score);
    if (!fired) return;

    const box = el("#veil .sheet").getBoundingClientRect();
    const { hue, count } = FANFARE[fired];
    this.#confetti.burst(
      { x: box.left + box.width / 2, y: box.top + box.height / 3 },
      { hue, count },
    );
    this.#vibrate(HAPTICS[fired]);
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

  #render(frame: Frame = this.#frame()): void {
    const { state, tasks, score } = frame;
    if (this.#destId !== null && !T.findGroup(state, this.#destId)) this.#destId = null;

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
        this.#rows.patch(state.list);
      },
      { instant: !animate },
    );
    this.#renderDest();

    /*
     * The arc measures the whole list, because that is what "3 of 7" means. The
     * colour is the day's verdict, which is a different question: a list can be
     * most of the way done and still have an important item outstanding, and
     * the ring should say so rather than average it away.
     */
    const hue = dayHue(score, this.#bar);

    this.#empty.hidden = state.list.length > 0;
    // The verdict travels with the button: neither has anything to say about a
    // list with nothing in it.
    this.#ending.hidden = tasks.length === 0;
    this.#closer.style.setProperty("--end-hue", hue.toFixed(1));
    this.#closer.style.setProperty("--end-tint", dayStroke(hue));
    /*
     * Four states, not two. `lit` used to cover everything from the first tick
     * to almost-done, which left the moment the day actually turns on — the
     * marked work landing, the minimum plan met — looking exactly like one
     * tick. `cleared` is that moment, and it is gated on there being marked
     * work at all: the flag is vacuously true otherwise, the same way
     * `milestones` reads it.
     */
    this.#closer.classList.toggle("lit", frame.done > 0);
    this.#closer.classList.toggle("cleared", score.hasImportant && score.cleared);
    this.#closer.classList.toggle("ripe", score.succeeded);
    const label = endLabel(score);
    // The button carries a live region's worth of meaning; only write changes,
    // so a screen reader is not told the same thing on every tick.
    if (this.#endLabel.textContent !== label) this.#endLabel.textContent = label;

    paintRing(this.#totalRing, tasks.length ? frame.done : 0, 1, dayStroke(hue));
    this.#totalRing.style.setProperty("--track-tint", dayStroke(hue, 0.2));
    this.#totalRing.style.opacity = tasks.length ? "1" : "0.3";
    // Nothing to report on an empty list, so the ring is not a button there.
    this.#ringButton.disabled = tasks.length === 0;
    const frac = `${String(tasks.filter(isDone).length)} of ${String(tasks.length)}`;
    // Writing the same text still fires the live region, so only write changes.
    if (this.#frac.textContent !== frac) this.#frac.textContent = frac;
    this.#tweenPct(Math.round(frame.done * 100));
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
    /*
     * A group always lands at the root, whatever is aimed — so while the
     * composer is holding one, the row has to say "Top level" rather than name
     * a group the item will not go into.
     *
     * Display only: the aim itself is untouched and comes back the moment the
     * `#` does not, so deleting one character does not cost you the group you
     * had picked.
     */
    this.#dest.value = isGroupInput(this.#input.value) ? "" : (this.#destId ?? "");
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
      /*
       * Emptied before the state is applied, not after. The destination row
       * reads the composer to decide whether a group is on its way, and the
       * apply below renders — so leaving the text in place until afterwards had
       * the row report "Top level" for the group it had just aimed at.
       */
      const typed = this.#input.value;
      this.#input.value = "";

      const result = T.add(this.#state, typed, this.#destId, Date.now());
      if (result.added) {
        this.#destId = result.destId;
        this.#store.apply(result.state);
        // The composer is pinned to the bottom of a list that grows off the
        // screen behind it, so adding without this types into the void.
        this.#reveal(result.added.id);
      }
      this.#input.focus();
    });

    // Only the destination row: a full render measures every row for FLIP, which
    // is a lot of work to do on each keystroke for one <select>'s value.
    this.#input.addEventListener("input", () => {
      this.#renderDest();
    });

    this.#dest.addEventListener("change", () => {
      this.#destId = this.#dest.value || null;
      this.#render();
      this.#input.focus();
    });

    this.#closer.addEventListener("click", () => {
      this.#sheet.show(this.#state, Date.now(), this.#bar);
    });
    /*
     * The ring reports; the closer ends the day. Two cards, and only one of
     * them can change anything — which is why this one is on the ring rather
     * than a second thing to press next to the closer.
     */
    this.#ringButton.addEventListener("click", () => {
      if (hasDay(this.#state)) this.#stands.show(this.#state, Date.now(), this.#bar);
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
      if (this.#stands.isOpen) this.#stands.hide();
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
