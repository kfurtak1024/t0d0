/**
 * Fetch an element the markup is required to contain, failing loudly if it is
 * not there.
 *
 * Three versions of this had grown: `el()` in app.ts, `#need()` in the drawer,
 * and bare `as HTMLElement` casts in the sheet and the toast. The casts are why
 * it is worth having one — they turn a markup typo into a null dereference at
 * first interaction, instead of a named error at boot with the selector in it.
 */
export function need(root: ParentNode, selector: string): HTMLElement {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`missing element: ${selector}`);
  return node;
}

/**
 * Make a scroller reachable by keyboard, but only while it actually scrolls.
 *
 * A box with its own overflow is a trap for anyone driving by keyboard: there
 * is nothing focusable inside a day card's summary — the buttons sit outside
 * it, which is the whole point — so without a tab stop the content that
 * overflowed could be seen by a mouse and by nobody else. Axe calls this
 * `scrollable-region-focusable`, and it caught it the day the scroller
 * appeared.
 *
 * Conditional rather than always-on, because the card usually does not scroll
 * and a permanent tab stop in front of the buttons would be a stop that leads
 * nowhere on almost every day. Measured on open: `scrollHeight` is layout, so
 * unlike a bounding box it is not disturbed by the card's entry animation.
 */
export function keyboardScrollable(el: HTMLElement): void {
  const scrolls = el.scrollHeight > el.clientHeight;
  if (scrolls) {
    el.tabIndex = 0;
    el.setAttribute("role", "group");
  } else {
    el.removeAttribute("tabindex");
    el.removeAttribute("role");
  }
}
