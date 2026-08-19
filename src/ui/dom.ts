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
