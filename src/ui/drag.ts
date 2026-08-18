import type { ReorderDirection, ReorderScope } from "../transitions";

/** How close to the viewport edge before the list starts scrolling itself. */
const EDGE = 76;
const EDGE_SPEED = 14;
/** Pointer travel before a press becomes a drag, so a tap on the grip is still a tap. */
const SLOP = 4;
/**
 * A group's "inside" ends this far above its bottom edge, so that the last of
 * the card is somewhere an item can be dragged out through — otherwise the last
 * item of the last group has no downward exit at all.
 */
const EXIT_MARGIN = 12;
/**
 * A fast flick can cross several rows between two pointermove events, and a
 * pointer that stops still needs the list to finish arriving where it points.
 * So a move applies steps until the geometry stops asking for one; the cap only
 * exists so a bug cannot spin here.
 */
const MAX_STEPS = 24;

export interface DragHost {
  /** Apply one reorder step. Returns whether the list actually changed. */
  step: (id: string, dir: ReorderDirection, scope: ReorderScope) => boolean;
  onStart: (id: string) => void;
  onEnd: (id: string, moved: boolean) => void;
  onCancel: () => void;
}

/**
 * Drag-to-reorder, built on the step the keyboard and the ⋯ menu already use.
 *
 * The insight that keeps this small: a drag is not a separate way of rearranging
 * the list, it is the same one-step-at-a-time `reorder` transition applied
 * repeatedly as the pointer crosses rows. So nesting, boundaries and the
 * inverse property all come along for free, already unit-tested, and the drag
 * itself only has to answer "which way, and has the pointer gone far enough".
 *
 * Pointer Events rather than mouse plus touch: one code path for mouse, finger
 * and pen, with capture so the gesture survives leaving the row.
 *
 * Two things are deliberately not the row element's job. The pointer is captured
 * on the list, not the row, and the row is re-found by id on every move —
 * because moving a task in or out of a group rebuilds it, and a drag anchored to
 * the old node would die exactly when it crossed a boundary.
 */
export class Dragger {
  #list: HTMLElement;
  #host: DragHost;

  #id: string | null = null;
  #pointer = 0;
  #startY = 0;
  #grabOffset = 0;
  #translate = 0;
  #active = false;
  #moved = false;
  #raf = 0;
  #lastY = 0;

  constructor(list: HTMLElement, host: DragHost) {
    this.#list = list;
    this.#host = host;

    list.addEventListener("pointerdown", (event) => {
      this.#onDown(event);
    });
    list.addEventListener("pointermove", (event) => {
      this.#onMove(event);
    });
    list.addEventListener("pointerup", () => {
      this.#finish(true);
    });
    list.addEventListener("pointercancel", () => {
      this.#finish(false);
    });
    addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.#id !== null) {
        event.preventDefault();
        this.#finish(false);
      }
    });
  }

  #row(): HTMLElement | null {
    if (this.#id === null) return null;
    return this.#list.querySelector<HTMLElement>(`[data-id="${this.#id}"]`);
  }

  #onDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const grip = target.closest(".grip");
    if (!grip) return;

    const row = grip.closest<HTMLElement>(".task, .group");
    const id = row?.dataset["id"];
    if (!row || id === undefined) return;

    event.preventDefault();
    this.#id = id;
    this.#pointer = event.pointerId;
    this.#startY = event.clientY;
    this.#lastY = event.clientY;
    this.#grabOffset = event.clientY - row.getBoundingClientRect().top;
    this.#translate = 0;
    this.#active = false;
    this.#moved = false;
    // On the list, so the drag outlives the row being rebuilt mid-gesture.
    this.#list.setPointerCapture(event.pointerId);
  }

  #onMove(event: PointerEvent): void {
    if (this.#id === null || event.pointerId !== this.#pointer) return;
    this.#lastY = event.clientY;

    if (!this.#active) {
      if (Math.abs(event.clientY - this.#startY) < SLOP) return;
      this.#begin();
    }

    this.#follow();
    this.#considerStep();
  }

  #begin(): void {
    const row = this.#row();
    if (!row || this.#id === null) return;
    this.#active = true;
    row.classList.add("dragging");
    document.body.classList.add("dragging-row");
    this.#host.onStart(this.#id);
    this.#autoScroll();
  }

  /**
   * Glue the row to the pointer, measuring its layout box without the offset.
   *
   * The offset to subtract is read back off the element rather than from a
   * field, because the two part company: crossing a group boundary rebuilds the
   * row, and the replacement carries no transform while the field still holds
   * the old one. Asking the DOM what is actually applied cannot drift.
   */
  #follow(): void {
    const row = this.#row();
    if (!row) return;
    row.classList.add("dragging");

    const applied = Number.parseFloat(row.style.getPropertyValue("--drag-y")) || 0;
    const layoutTop = row.getBoundingClientRect().top - applied;
    this.#translate = this.#lastY - this.#grabOffset - layoutTop;
    row.style.setProperty("--drag-y", `${String(this.#translate)}px`);
  }

  /**
   * The band of a group that counts as being inside it.
   *
   * Not the whole card and not just its items. The line at the top is the
   * header's own middle: above it you are addressing the group as a row in the
   * list, below it you are addressing its contents. That split is what lets an
   * item both be dropped onto a group by aiming at its title, and be dragged
   * back out over the same header — the two gestures differ by which half.
   *
   * The bottom keeps a sliver of the card as the way out downwards, which the
   * last item of the last group has no other route to. It is a fraction of the
   * height as well as a fixed size, so that a short card — an empty group is
   * barely taller than its header — still has a band left to drop into.
   *
   * Entering and leaving read the same two lines, so the pointer is always in
   * exactly one of the three regions and a step can never undo itself.
   */
  #bandOf(group: HTMLElement): { top: number; bottom: number } {
    const box = group.getBoundingClientRect();
    const head = group.querySelector<HTMLElement>(":scope > .ghead");
    const headBox = head?.getBoundingClientRect();
    const top = headBox ? headBox.top + headBox.height / 2 : box.top;
    const margin = Math.min(EXIT_MARGIN, box.height * 0.15);
    return { top, bottom: Math.max(top + 1, box.bottom - margin) };
  }

  /** The group a dragged task currently lives in, if any. */
  #ownGroup(row: HTMLElement): HTMLElement | null {
    return row.parentElement?.closest<HTMLElement>(".group") ?? null;
  }

  /**
   * Step once toward wherever the pointer is, or report that it is already
   * there. Geometry is re-read each time, so a run of these converges.
   */
  #stepOnce(): boolean {
    if (this.#id === null) return false;
    const row = this.#row();
    if (!row) return false;

    /*
     * Leaving is decided by the group's own edges, before looking at what is
     * under the pointer — there may be nothing under it at all. Dragging into
     * the empty space past the end of the list still has to mean "out".
     */
    const own = this.#ownGroup(row);
    if (own) {
      const band = this.#bandOf(own);
      if (this.#lastY < band.top) return this.#host.step(this.#id, "up", "list");
      if (this.#lastY > band.bottom) return this.#host.step(this.#id, "down", "list");

      // Inside its own group, but past the items: close the gap rather than sit
      // at the far end of the group from where the pointer is. Level scope is
      // what stops this from stepping out and straight back in.
      const items = own.querySelector<HTMLElement>(":scope > .gbody .items");
      const box = items?.getBoundingClientRect();
      if (box && box.height > 0) {
        if (this.#lastY < box.top) return this.#host.step(this.#id, "up", "level");
        if (this.#lastY > box.bottom) return this.#host.step(this.#id, "down", "level");
      }
    }

    /*
     * Hit-test down the middle of the list, not under the pointer.
     *
     * The grip sits in the margin beside the card on pointer devices, so the
     * pointer's own x is outside every row for the whole gesture — testing
     * there finds nothing to trade places with. The list is vertical anyway, so
     * sideways wander should not change what a drag means.
     */
    const spine = this.#list.getBoundingClientRect();
    const under = document.elementFromPoint(spine.left + spine.width / 2, this.#lastY);
    const target = under instanceof Element ? under.closest<HTMLElement>(".task, .group") : null;
    if (!target || target === row || !this.#list.contains(target)) return false;
    // Its own group, and the checks above already found nothing to do there.
    if (target.contains(row)) return false;

    const before = (row.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;

    // Two rows trade places when their midpoints cross. A group is not one row
    // though — its box spans everything in it — so a task joins it by reaching
    // the band, not its midpoint half a card away.
    if (target.classList.contains("group") && row.classList.contains("task")) {
      const band = this.#bandOf(target);
      if (this.#lastY < band.top || this.#lastY > band.bottom) return false;
    } else {
      const box = target.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      if (before && this.#lastY > middle) return false;
      if (!before && this.#lastY < middle) return false;
    }

    return this.#host.step(this.#id, before ? "up" : "down", "list");
  }

  /** Apply steps until the list has caught up with where the pointer is. */
  #considerStep(): void {
    for (let i = 0; i < MAX_STEPS; i++) {
      if (!this.#stepOnce()) return;
      this.#moved = true;
      // The row has a new layout box now; re-glue it before measuring again.
      this.#follow();
    }
  }

  /** Drive the list past the fold when the pointer sits near an edge. */
  #autoScroll(): void {
    cancelAnimationFrame(this.#raf);
    const tick = (): void => {
      if (!this.#active) return;
      const top = this.#lastY - EDGE;
      const bottom = this.#lastY - (innerHeight - EDGE);
      let by = 0;
      if (top < 0) by = Math.max(-EDGE_SPEED, top / 5);
      else if (bottom > 0) by = Math.min(EDGE_SPEED, bottom / 5);

      if (by !== 0) {
        scrollBy(0, by);
        this.#follow();
        this.#considerStep();
      }
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  #finish(commit: boolean): void {
    const id = this.#id;
    const wasActive = this.#active;
    const moved = this.#moved;

    cancelAnimationFrame(this.#raf);
    const row = this.#row();
    row?.classList.remove("dragging");
    row?.style.removeProperty("--drag-y");
    document.body.classList.remove("dragging-row");

    if (this.#list.hasPointerCapture(this.#pointer)) {
      this.#list.releasePointerCapture(this.#pointer);
    }

    this.#id = null;
    this.#active = false;
    this.#moved = false;
    this.#translate = 0;

    if (!wasActive || id === null) return;
    if (commit) this.#host.onEnd(id, moved);
    else this.#host.onCancel();
  }
}
