const SVG = "http://www.w3.org/2000/svg";

/**
 * A row's progress encoded as hue as well as fill: indigo at nothing done,
 * green at finished, sweeping through blue and teal on the way.
 *
 * Green at the end is not decoration — it is the same hue as the finished
 * frame, so a completed row's ring and its outline agree. The day's own ring
 * runs a different, wider sweep; see `dayHue` in progress.ts.
 */
export const hueAt = (progress: number): number => 268 - 118 * Math.min(1, Math.max(0, progress));

/**
 * How far into the warm band a hue sits, 0 to 1, peaking at yellow.
 *
 * The warm half of a rainbow is inherently light. Held at the ring's fixed
 * lightness an OKLCH yellow renders olive, and the day's red→green stretch
 * reads as mud; lifting that band is what makes it read as a rainbow. The
 * amount is a token, so each theme sets its own.
 */
const warmth = (hue: number): number => Math.exp(-Math.pow((hue - 95) / 55, 2));

/**
 * The day ring's colour: a rainbow hue, with the warm band lifted.
 *
 * `alpha` is for the track behind the arc, which the day ring tints rather than
 * leaving grey — otherwise "the day starts red" is a claim nobody can see,
 * since at nothing-done there is no arc to paint.
 */
export const dayStroke = (hue: number, alpha?: number): string => {
  const lightness = `calc(var(--ring-l) + var(--ring-lift) * ${warmth(hue).toFixed(3)})`;
  const fade = alpha === undefined ? "" : ` / ${String(Math.round(alpha * 100))}%`;
  return `oklch(${lightness} var(--ring-c) ${hue.toFixed(1)}${fade})`;
};

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

/**
 * `count` may be fractional for meter rings (group and overall progress).
 *
 * `colour` overrides the row sweep, which is how the day's ring wears the
 * rainbow while every row keeps the indigo→green one that matches its frame.
 */
export function paintRing(ring: Ring, count: number, target: number, colour?: string): void {
  const progress = Math.min(1, count / target);
  const stroke = colour ?? strokeAt(progress);

  if (ring.continuous) {
    const [arc] = ring.segments;
    if (arc) {
      arc.style.stroke = count > 0 ? stroke : "transparent";
      arc.setAttribute(
        "stroke-dasharray",
        `${String(ring.circumference)} ${String(ring.circumference)}`,
      );
      arc.setAttribute("stroke-dashoffset", String(ring.circumference * (1 - progress)));
    }
  } else {
    ring.segments.forEach((segment, index) => {
      segment.style.stroke = index < count ? stroke : "transparent";
    });
  }

  ring.check.style.stroke = stroke;
}
