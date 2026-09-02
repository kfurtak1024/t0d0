const EDGE = 8;

export interface MenuItem {
  label: string;
  /** The keyboard equivalent, shown greyed to the right. */
  hint?: string;
  disabled?: boolean;
  /** Stay open afterwards, for actions worth repeating (move up, move down). */
  keepOpen?: boolean;
  /**
   * Reads as destructive. The row's ✕ used to carry this on its own, in its own
   * colour; moved in here it would otherwise sit in a list of benign commands
   * looking like one of them.
   */
  danger?: boolean;
  onSelect: () => void;
}

/**
 * The row menu behind `⋯`.
 *
 * Reordering has to work with a thumb, and drag-and-drop is out — so moves are
 * commands here rather than a gesture. Actions that repeat keep the menu open
 * and stay in place even once they are spent, disabled rather than removed: a
 * menu that reflows under a finger mid-tap is worse than one with a dead row.
 *
 * Rendered into <body> rather than into the row, so no ancestor's overflow or
 * stacking context can clip it.
 */
export class RowMenu {
  #element: HTMLElement;
  #anchor: HTMLElement | null = null;
  #build: (() => MenuItem[]) | null = null;
  #reanchor: (() => HTMLElement | null) | null = null;
  #open = false;
  /** Repainting tears out the focused button; that is not the user leaving. */
  #painting = false;

  constructor() {
    this.#element = document.createElement("div");
    this.#element.className = "rowmenu";
    this.#element.setAttribute("role", "menu");
    this.#element.tabIndex = -1;
    this.#element.hidden = true;
    document.body.append(this.#element);

    this.#element.addEventListener("keydown", (event) => {
      this.#onKeyDown(event);
    });
    // Leaving by any route — Tab, a click elsewhere — closes it.
    this.#element.addEventListener("focusout", (event) => {
      if (this.#painting) return;
      const next = event.relatedTarget;
      if (next instanceof Node && this.#element.contains(next)) return;
      this.close(false);
    });
    addEventListener(
      "pointerdown",
      (event) => {
        if (!this.#open) return;
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (this.#element.contains(target)) return;
        // A second press on the same ⋯ is a toggle, so let its click see an
        // open menu rather than closing it out from under itself here.
        if (this.#anchor?.contains(target)) return;
        this.close(false);
      },
      true,
    );
    /*
     * Follow the row rather than close on it. Moving an item can scroll it back
     * into view, and a menu that dismissed itself on that would make "move up"
     * usable exactly once per opening.
     */
    addEventListener("scroll", () => {
      if (this.#open) this.#place();
    });
    addEventListener("resize", () => {
      this.close(false);
    });
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /**
   * `reanchor` re-finds the ⋯ button after a refresh, because a move that
   * changes a row's nesting rebuilds it: the element this opened against is by
   * then detached, and positioning off a detached node puts the menu at 0,0.
   */
  open(anchor: HTMLElement, build: () => MenuItem[], reanchor?: () => HTMLElement | null): void {
    if (this.#open && this.#anchor === anchor) {
      this.close();
      return;
    }
    this.#anchor = anchor;
    this.#build = build;
    this.#reanchor = reanchor ?? null;
    this.#open = true;
    this.#element.hidden = false;
    anchor.setAttribute("aria-expanded", "true");

    this.#paint();
    this.#place();
    this.#element.querySelector<HTMLElement>("button:not([disabled])")?.focus();
  }

  close(restoreFocus = true): void {
    if (!this.#open) return;
    this.#open = false;
    this.#element.hidden = true;
    const anchor = this.#anchor;
    this.#anchor = null;
    this.#build = null;
    this.#reanchor = null;
    anchor?.setAttribute("aria-expanded", "false");
    // Only when the menu still holds focus: a click elsewhere is already a
    // deliberate move away, and yanking it back would fight the user.
    if (restoreFocus && anchor) anchor.focus();
  }

  /** Re-read the menu after the list moved under it, keeping focus where it is. */
  refresh(): void {
    if (!this.#open) return;
    const at = this.#items().indexOf(document.activeElement as HTMLButtonElement);

    if (this.#anchor && !this.#anchor.isConnected) {
      const fresh = this.#reanchor?.();
      if (!fresh) {
        this.close(false);
        return;
      }
      this.#anchor.setAttribute("aria-expanded", "false");
      this.#anchor = fresh;
      fresh.setAttribute("aria-expanded", "true");
    }

    this.#paint();
    this.#place();

    // The row the user was on may have just become unavailable — a move up from
    // the very top spends itself. Stay as close to it as the menu allows.
    const buttons = this.#items();
    const held = buttons[at];
    const target = held?.disabled === false ? held : buttons.find((item) => !item.disabled);
    (target ?? this.#element).focus();
  }

  #items(): HTMLButtonElement[] {
    return [...this.#element.querySelectorAll("button")];
  }

  #paint(): void {
    const items = this.#build?.() ?? [];
    this.#painting = true;
    this.#element.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.disabled = item.disabled ?? false;
        if (item.danger) button.classList.add("danger");

        const label = document.createElement("span");
        label.textContent = item.label;
        button.append(label);

        if (item.hint) {
          const hint = document.createElement("kbd");
          hint.textContent = item.hint;
          button.append(hint);
        }

        button.addEventListener("click", () => {
          item.onSelect();
          if (item.keepOpen) this.refresh();
          else this.close();
        });
        return button;
      }),
    );
    this.#painting = false;
  }

  #place(): void {
    if (!this.#anchor) return;
    const anchor = this.#anchor.getBoundingClientRect();
    const menu = this.#element.getBoundingClientRect();

    // Below the button by default, flipped above when the bottom is closer.
    const below = anchor.bottom + 6;
    const top = below + menu.height > innerHeight - EDGE ? anchor.top - menu.height - 6 : below;
    const left = anchor.right - menu.width;

    this.#element.style.top = `${String(Math.max(EDGE, Math.min(top, innerHeight - menu.height - EDGE)))}px`;
    this.#element.style.left = `${String(Math.max(EDGE, Math.min(left, innerWidth - menu.width - EDGE)))}px`;
  }

  #onKeyDown(event: KeyboardEvent): void {
    const items = this.#items().filter((item) => !item.disabled);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      /*
       * `at` is -1 when the menu itself holds the focus rather than one of its
       * entries, which `refresh` can leave behind. Wrapping arithmetic reads
       * that as "before the first" and sends Up to the *second* to last; from
       * nowhere in particular, either arrow should land on the end it points at.
       */
      const next =
        at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
      items[next]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items[items.length - 1])?.focus();
    }
  }
}
