const SVG = "http://www.w3.org/2000/svg";

/**
 * Progress is encoded as hue as well as fill: indigo at nothing done, green at
 * finished, sweeping through blue and teal on the way. Read before the number.
 */
export const hueAt = (progress: number): number => 268 - 118 * Math.min(1, Math.max(0, progress));

const strokeAt = (progress: number): string =>
  `oklch(var(--ring-l) var(--ring-c) ${hueAt(progress).toFixed(1)})`;

export interface Ring extends SVGSVGElement {
  segments: SVGCircleElement[];
  continuous: boolean;
  circumference: number;
  check: SVGPathElement;
  target: number;
}

/**
 * A ring with one arc per unit of `target`.
 *
 * Above eight the arcs get too thin to read, so it falls back to a single
 * sweeping arc with a numeric label beside it. A plain checkbox (`target: 1`)
 * is also a single sweep, which sells the tick better than a snap.
 */
export function makeRing(size: number, width: number, target: number): Ring {
  const radius = size / 2 - width / 2 - 0.5;
  const circumference = 2 * Math.PI * radius;

  const svg = document.createElementNS(SVG, "svg") as Ring;
  svg.setAttribute("viewBox", `0 0 ${String(size)} ${String(size)}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.classList.add("ring");

  const group = document.createElementNS(SVG, "g");
  group.setAttribute("transform", `rotate(-90 ${String(size / 2)} ${String(size / 2)})`);
  group.setAttribute("stroke-width", String(width));
  svg.append(group);

  const count = target > 1 && target <= 8 ? target : 1;
  const gap = count > 1 ? (count > 5 ? 3.2 : 4.2) : 0;
  const arc = (circumference - count * gap) / count;

  const circle = (className: string, index: number): SVGCircleElement => {
    const el = document.createElementNS(SVG, "circle");
    el.setAttribute("cx", String(size / 2));
    el.setAttribute("cy", String(size / 2));
    el.setAttribute("r", String(radius));
    el.setAttribute("stroke-dasharray", `${String(arc)} ${String(circumference - arc)}`);
    el.setAttribute("stroke-dashoffset", String(-(index * (arc + gap))));
    el.classList.add(className);
    group.append(el);
    return el;
  };

  for (let i = 0; i < count; i++) circle("trk", i);
  const segments = Array.from({ length: count }, (_, i) => {
    const el = circle("seg", i);
    el.style.stroke = "transparent";
    return el;
  });

  const scale = size / 28;
  const check = document.createElementNS(SVG, "path");
  check.setAttribute(
    "d",
    `M${String(9 * scale)} ${String(14.4 * scale)} L${String(12.6 * scale)} ${String(18 * scale)} L${String(19 * scale)} ${String(10.6 * scale)}`,
  );
  check.setAttribute("stroke-width", String(width * 0.95));
  check.classList.add("chk");
  svg.append(check);

  svg.segments = segments;
  svg.continuous = count === 1;
  svg.circumference = circumference;
  svg.check = check;
  svg.target = target;
  return svg;
}

/** `count` may be fractional for meter rings (group and overall progress). */
export function paintRing(ring: Ring, count: number, target: number): void {
  const progress = Math.min(1, count / target);
  const colour = strokeAt(progress);

  if (ring.continuous) {
    const [arc] = ring.segments;
    if (arc) {
      arc.style.stroke = count > 0 ? colour : "transparent";
      arc.setAttribute(
        "stroke-dasharray",
        `${String(ring.circumference)} ${String(ring.circumference)}`,
      );
      arc.setAttribute("stroke-dashoffset", String(ring.circumference * (1 - progress)));
    }
  } else {
    ring.segments.forEach((segment, index) => {
      segment.style.stroke = index < count ? colour : "transparent";
    });
  }

  ring.check.style.stroke = colour;
}
