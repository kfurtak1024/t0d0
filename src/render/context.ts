/** What a rendered row is allowed to ask the app to do. */
export interface RowActions {
  bump(id: string, delta: number): void;
  remove(id: string): void;
  beginEdit(element: HTMLElement, id: string, isGroup: boolean): void;
  toggleCollapse(id: string): void;
  aim(id: string): void;
  isAimed(id: string): boolean;
  isEditing(id: string): boolean;
}

const SVG = "http://www.w3.org/2000/svg";

export function icon(kind: "chev" | "x"): SVGSVGElement {
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
  path.setAttribute("d", kind === "chev" ? "M4 6 L8 10 L12 6" : "M4 4 L12 12 M12 4 L4 12");
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
