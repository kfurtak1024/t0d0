/**
 * The keyed patch.
 *
 * This file exists so that updating a row never destroys its DOM node. Rebuild
 * the container with innerHTML and you lose focus mid-edit, cancel every
 * in-flight transition, and reset the caret — which on a page whose whole point
 * is how the ticking feels is not a small bug. Nodes are matched by id, moved
 * with insertBefore, and only genuinely absent ones are removed.
 */

/**
 * The marker that says a row is genuinely arriving, not merely changing places.
 *
 * `@starting-style` in the stylesheet keys the entry off this rather than off
 * the insertion itself — see the note beside it. The patch sets it on the rows
 * it creates and takes it off again on the next patch, by which time the row
 * has been rendered once and the starting style can no longer apply to it.
 */
const ENTERING = "entering";

export interface Keyed<T> {
  /** Stable identity — the id of the task or group this element renders. */
  key: string;
  element: HTMLElement;
  update: (data: T) => void;
}

export class KeyedList<T extends { id: string }> {
  #containers: HTMLElement[];
  #create: (data: T) => Keyed<T>;
  #entries = new Map<string, Keyed<T>>();
  /** Rows the last patch created, still wearing {@link ENTERING}. */
  #entering: HTMLElement[] = [];

  /**
   * One list may be drawn across more than one container — the day's work above
   * the ending, the pile of finished rows below it. The entry map is shared, so
   * a row crossing between them is `insertBefore`d rather than rebuilt: a node
   * keeps its identity when it changes parent, which is what lets FLIP carry it
   * over and what stops an in-flight transition being cancelled on the way.
   */
  constructor(containers: HTMLElement | HTMLElement[], create: (data: T) => Keyed<T>) {
    this.#containers = Array.isArray(containers) ? containers : [containers];
    this.#create = create;
  }

  get(key: string): Keyed<T> | undefined {
    return this.#entries.get(key);
  }

  /**
   * `splitAt` is the first index drawn into the second container. Left out, or
   * equal to the length, everything goes into the first — which is the single
   * container case and the shape this had before.
   */
  patch(data: T[], splitAt = data.length): void {
    /*
     * Last patch's arrivals are established now — they have been through a
     * style resolution, so the starting style can no longer apply to them and
     * the marker has done its job. Cleared here rather than on a timer or a
     * frame: this is the first moment it is safe, and it is also the moment it
     * matters, since a row this patch is about to *move* must not still be
     * claiming to be arriving.
     */
    for (const element of this.#entering) element.classList.remove(ENTERING);
    this.#entering.length = 0;

    const filled = this.#containers.map(() => 0);

    for (const [at, item] of data.entries()) {
      const which = at < splitAt ? 0 : Math.min(1, this.#containers.length - 1);
      const container = this.#containers[which] as HTMLElement;
      const index = filled[which] as number;

      let entry = this.#entries.get(item.id);
      if (!entry) {
        entry = this.#create(item);
        // Before it is inserted: the starting style is read at the row's first
        // style resolution, which the insertion below is what triggers.
        entry.element.classList.add(ENTERING);
        this.#entering.push(entry.element);
        this.#entries.set(item.id, entry);
      }
      entry.update(item);

      if (container.children[index] !== entry.element) {
        container.insertBefore(entry.element, container.children[index] ?? null);
      }
      filled[which] = index + 1;
    }

    /*
     * Pruned after every insert, never during: a row that moved to the other
     * container has already left this one — a node cannot have two parents — so
     * whatever is still here beyond the fill mark is genuinely gone from the
     * list rather than merely somewhere else in it.
     */
    this.#containers.forEach((container, which) => {
      while (container.children.length > (filled[which] as number)) {
        const stale = container.lastElementChild;
        if (!stale) break;
        const key = stale.getAttribute("data-id");
        if (key !== null) this.#entries.delete(key);
        stale.remove();
      }
    });
  }

  clear(): void {
    this.#entries.clear();
    this.#entering.length = 0;
    for (const container of this.#containers) container.replaceChildren();
  }
}
