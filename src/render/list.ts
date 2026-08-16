/**
 * The keyed patch.
 *
 * This file exists so that updating a row never destroys its DOM node. Rebuild
 * the container with innerHTML and you lose focus mid-edit, cancel every
 * in-flight transition, and reset the caret — which on a page whose whole point
 * is how the ticking feels is not a small bug. Nodes are matched by id, moved
 * with insertBefore, and only genuinely absent ones are removed.
 */

export interface Keyed<T> {
  /** Stable identity — the id of the task or group this element renders. */
  key: string;
  element: HTMLElement;
  update: (data: T) => void;
}

export class KeyedList<T extends { id: string }> {
  #container: HTMLElement;
  #create: (data: T) => Keyed<T>;
  #entries = new Map<string, Keyed<T>>();

  constructor(container: HTMLElement, create: (data: T) => Keyed<T>) {
    this.#container = container;
    this.#create = create;
  }

  get(key: string): Keyed<T> | undefined {
    return this.#entries.get(key);
  }

  /** Drop an entry without touching the DOM — used when an exit animation owns the node. */
  forget(key: string): void {
    this.#entries.delete(key);
  }

  patch(data: T[]): void {
    let index = 0;

    for (const item of data) {
      let entry = this.#entries.get(item.id);
      if (!entry) {
        entry = this.#create(item);
        this.#entries.set(item.id, entry);
      }
      entry.update(item);

      if (this.#container.children[index] !== entry.element) {
        this.#container.insertBefore(entry.element, this.#container.children[index] ?? null);
      }
      index++;
    }

    while (this.#container.children.length > index) {
      const stale = this.#container.lastElementChild;
      if (!stale) break;
      const key = stale.getAttribute("data-id");
      if (key !== null) this.#entries.delete(key);
      stale.remove();
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#container.replaceChildren();
  }
}
