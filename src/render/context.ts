/** What a rendered row is allowed to ask the app to do. */
export interface RowActions {
  bump(id: string, delta: number): void;
  remove(id: string): void;
  beginEdit(element: HTMLElement, id: string, isGroup: boolean): void;
  toggleCollapse(id: string): void;
  /** Open the row's ⋯ menu; the app fills it, since only it knows the list. */
  openMenu(anchor: HTMLElement, id: string): void;
  aim(id: string): void;
  isAimed(id: string): boolean;
  isEditing(id: string): boolean;
}

const SVG = "http://www.w3.org/2000/svg";

const PATHS = {
  chev: "M4 6 L8 10 L12 6",
  x: "M4 4 L12 12 M12 4 L4 12",
  download: "M8 2 V10.5 M4.5 7 L8 10.5 L11.5 7 M3 13.5 H13",
  upload: "M8 10.5 V2 M4.5 5.5 L8 2 L11.5 5.5 M3 13.5 H13",
  trash: "M3 4.5 H13 M6.5 4.5 V3 H9.5 V4.5 M4.8 4.5 L5.4 13.5 H10.6 L11.2 4.5",
} as const;

export type IconName = keyof typeof PATHS;

export function icon(kind: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", PATHS[kind]);
  svg.append(path);
  return svg;
}

export function button(className: string, label: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.setAttribute("aria-label", label);
  return el;
}

/**
 * The drag handle.
 *
 * Deliberately not a button and not in the accessibility tree: it does nothing a
 * keyboard could invoke, and a focus stop that only responds to dragging is
 * worse than no focus stop. The keyboard and screen-reader route to the same
 * outcome is Alt+Arrow and the ⋯ menu, which is also what satisfies WCAG's
 * requirement that a dragging movement have a single-pointer alternative.
 */
export function grip(): HTMLElement {
  const el = document.createElement("span");
  el.className = "grip";
  el.setAttribute("aria-hidden", "true");
  return el;
}

/** The ⋯ handle that opens a row's menu. */
export function menuButton(label: string): HTMLButtonElement {
  const el = button("dots", label);
  el.textContent = "⋯";
  el.setAttribute("aria-haspopup", "menu");
  el.setAttribute("aria-expanded", "false");
  return el;
}
