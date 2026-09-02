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

/**
 * The three tokens a ring's colour is built from, resolved to numbers.
 *
 * Percentages arrive here as fractions. They differ per theme — dark starts
 * lighter and needs much less of a warm-band lift — so anything painting a
 * ring's colour outside CSS has to read them rather than assume light.
 */
export interface RingTokens {
  /** `--ring-l`. */
  l: number;
  /** `--ring-c`. */
  c: number;
  /** `--ring-lift`. */
  lift: number;
}

/**
 * Where a hue actually lands in OKLCH, warm-band lift included.
 *
 * The seam. {@link dayStroke} spells this out as a `calc()` for CSS to work
 * out, and the confetti has to arrive at the same three numbers without CSS —
 * so both are this one formula rather than two that agree today.
 */
export const ringOklch = (hue: number, tokens: RingTokens): [number, number, number] => [
  tokens.l + tokens.lift * warmth(hue),
  tokens.c,
  hue,
];

/** One linear-light channel, gamma-encoded and clipped into 0-255. */
const channel = (value: number): number => {
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(255 * Math.min(1, Math.max(0, encoded)));
};

/**
 * OKLCH to an sRGB `rgb()` string, so a canvas can paint the colour CSS would.
 *
 * Canvas2D takes a CSS colour, but its parser lagged CSS by years in Safari and
 * `oklch()` is exactly the kind of thing it dropped — silently, leaving the
 * shower black. Converting here means the burst is the ring's own colour on
 * every engine instead of an approximation that happened to be close.
 *
 * The naive spelling was `hsl()` fed the ring's OKLCH hue number. Those are
 * different colour spaces: the blue milestone showered `rgb(124, 75, 221)`, a
 * purple, while the ring beside it turned `rgb(60, 114, 203)` — and neither
 * the theme's lightness nor its chroma reached the canvas at all.
 *
 * Out-of-gamut colours are clipped per channel, which is what a browser does
 * displaying an `oklch()` it cannot reach — so the clip is the ring's own clip
 * rather than a second approximation on top of it.
 */
export function oklchToRgb(l: number, c: number, h: number): string {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  // OKLab to cone responses, then cubed — the inverse of the space's own step.
  const long = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const medium = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const short = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3);

  const red = channel(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short);
  const green = channel(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short);
  const blue = channel(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short);
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
}

/** A ring hue as the canvas wants it: the theme's own tokens, in sRGB. */
export const ringRgb = (hue: number, tokens: RingTokens): string =>
  oklchToRgb(...ringOklch(hue, tokens));

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
